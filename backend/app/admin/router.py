"""Admin endpoints (spec section 51).

Every route here requires the ADMIN role. Admins can see and resolve, but the
same ledger rules apply to them: there is no endpoint that edits a balance
directly, because that capability would make the audit trail meaningless.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai.constants import RISK_BANDS
from app.ai.model import RiskSignal, TrustScore
from app.audit import service as audit
from app.audit.model import AuditLog
from app.auth.dependencies import get_request_context, require_admin
from app.core.constants import UserStatus
from app.core.context import RequestContext
from app.core.money import ZERO, to_money
from app.dependencies.database import get_db
from app.disputes import service as disputes
from app.disputes.constants import OPEN_STATUSES
from app.disputes.model import Dispute
from app.ledger import service as ledger
from app.ledger.constants import AccountType
from app.ledger.model import LedgerAccount, LedgerTransaction
from app.milestones.model import Milestone
from app.projects.constants import ProjectStatus
from app.projects.model import Project
from app.users.model import User
from app.wallet.model import Wallet

router = APIRouter(prefix="/admin", tags=["Admin"], dependencies=[Depends(require_admin)])


class SuspendBody(BaseModel):
    reason: str = Field(min_length=3, max_length=255)


@router.get("/stats", summary="Platform overview")
def stats(db: Session = Depends(get_db)) -> dict:
    total_users = int(db.scalar(select(func.count()).select_from(User)) or 0)
    active_projects = int(
        db.scalar(
            select(func.count())
            .select_from(Project)
            .where(Project.status == ProjectStatus.ACTIVE)
        )
        or 0
    )
    total_protected = to_money(
        db.scalar(
            select(func.coalesce(func.sum(LedgerAccount.balance), 0)).where(
                LedgerAccount.account_type == AccountType.USER_PROTECTED
            )
        )
        or ZERO
    )
    transactions = int(
        db.scalar(select(func.count()).select_from(LedgerTransaction)) or 0
    )

    # Trust Score distribution across the most recent score per user.
    latest_scores = db.execute(
        select(TrustScore.user_id, func.max(TrustScore.created_at).label("latest"))
        .group_by(TrustScore.user_id)
        .subquery()
        .select()
    ).all()

    distribution = {str(band): 0 for _threshold, band in RISK_BANDS}
    if latest_scores:
        rows = db.scalars(
            select(TrustScore).where(
                TrustScore.created_at.in_([row.latest for row in latest_scores])
            )
        ).all()
        for row in rows:
            distribution[str(row.risk_band)] = distribution.get(str(row.risk_band), 0) + 1

    unacknowledged_signals = int(
        db.scalar(
            select(func.count())
            .select_from(RiskSignal)
            .where(RiskSignal.acknowledged_at.is_(None))
        )
        or 0
    )

    cancellations_7d = int(
        db.scalar(
            select(func.count())
            .select_from(LedgerTransaction)
            .where(
                LedgerTransaction.transaction_type == "REFUND",
                LedgerTransaction.created_at >= datetime.now(UTC) - timedelta(days=7),
            )
        )
        or 0
    )

    report = ledger.reconcile(db)

    return {
        "total_users": total_users,
        "active_projects": active_projects,
        "protected_funds": str(total_protected),
        "transactions": transactions,
        "open_disputes": disputes.count_open(db),
        "unacknowledged_risk_signals": unacknowledged_signals,
        "refunds_last_7_days": cancellations_7d,
        "trust_score_distribution": distribution,
        "ledger_balanced": report.is_balanced,
    }


@router.get("/users", summary="List users")
def list_users(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> dict:
    users = list(
        db.scalars(
            select(User).order_by(User.created_at.desc()).limit(limit).offset(offset)
        ).all()
    )
    total = int(db.scalar(select(func.count()).select_from(User)) or 0)

    return {
        "items": [
            {
                "id": str(user.id),
                "full_name": user.full_name,
                "email": user.email,
                "role": str(user.role),
                "status": str(user.status),
                "created_at": user.created_at.isoformat(),
            }
            for user in users
        ],
        "total": total,
    }


@router.post("/users/{user_id}/suspend", summary="Suspend an account")
def suspend_user(
    user_id: uuid.UUID,
    payload: SuspendBody,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
) -> dict:
    """Suspending blocks sign-in and every action.

    Note what it does *not* do: it does not touch protected funds. Money already
    committed to a milestone still belongs to the milestone, and freeing or
    seizing it requires a dispute resolution, not an account action.
    """
    user = db.get(User, user_id)
    if user is None:
        from app.users.exceptions import UserNotFoundError

        raise UserNotFoundError()

    user.status = UserStatus.SUSPENDED

    from app.auth import repository as auth_repo

    revoked = auth_repo.revoke_all_for_user(
        db, user.id, reason="account_suspended", now=datetime.now(UTC)
    )

    audit.record(
        db,
        action="ADMIN_SUSPENDED_USER",
        actor_user_id=admin.id,
        entity_type="user",
        entity_id=user.id,
        context={"reason": payload.reason, "sessions_revoked": revoked},
        ip_address=context.ip_address,
        user_agent=context.user_agent,
    )
    db.commit()
    return {"status": str(user.status), "sessions_revoked": revoked}


@router.post("/users/{user_id}/reinstate", summary="Reinstate a suspended account")
def reinstate_user(
    user_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
) -> dict:
    user = db.get(User, user_id)
    if user is None:
        from app.users.exceptions import UserNotFoundError

        raise UserNotFoundError()

    user.status = UserStatus.ACTIVE
    user.failed_login_attempts = 0
    user.locked_until = None

    audit.record(
        db,
        action="ADMIN_REINSTATED_USER",
        actor_user_id=admin.id,
        entity_type="user",
        entity_id=user.id,
        ip_address=context.ip_address,
        user_agent=context.user_agent,
    )
    db.commit()
    return {"status": str(user.status)}


@router.get("/disputes", summary="Open disputes")
def list_disputes(db: Session = Depends(get_db)) -> dict:
    rows = list(
        db.scalars(
            select(Dispute)
            .where(Dispute.status.in_(list(OPEN_STATUSES)))
            .order_by(Dispute.created_at.asc())
        ).all()
    )
    return {
        "items": [
            {
                "id": str(dispute.id),
                "milestone_id": str(dispute.milestone_id),
                "project_id": str(dispute.project_id),
                "reason": str(dispute.reason),
                "status": str(dispute.status),
                "raised_by_id": str(dispute.raised_by_id),
                "created_at": dispute.created_at.isoformat(),
                "has_ai_summary": dispute.ai_summary is not None,
            }
            for dispute in rows
        ],
        "total": len(rows),
    }


@router.get("/risk-signals", summary="Risk signals awaiting review")
def risk_signals(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> dict:
    rows = list(
        db.scalars(
            select(RiskSignal)
            .where(RiskSignal.acknowledged_at.is_(None))
            .order_by(RiskSignal.created_at.desc())
            .limit(limit)
        ).all()
    )
    return {
        "items": [
            {
                "id": str(signal.id),
                "user_id": str(signal.user_id),
                "rule": signal.rule,
                "severity": signal.severity,
                "message": signal.message,
                "context": signal.context,
                "created_at": signal.created_at.isoformat(),
            }
            for signal in rows
        ],
        "total": len(rows),
    }


@router.post("/risk-signals/{signal_id}/acknowledge", summary="Mark a signal reviewed")
def acknowledge_signal(
    signal_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    signal = db.get(RiskSignal, signal_id)
    if signal is None:
        from app.core.exceptions import NotFoundError

        raise NotFoundError()
    signal.acknowledged_at = datetime.now(UTC)
    db.commit()
    return {"acknowledged": True}


@router.get("/audit-log", summary="Recent audit entries")
def audit_log(
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> dict:
    rows = list(
        db.scalars(
            select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)
        ).all()
    )
    return {
        "items": [
            {
                "id": str(entry.id),
                "action": entry.action,
                "actor_user_id": str(entry.actor_user_id) if entry.actor_user_id else None,
                "entity_type": entry.entity_type,
                "entity_id": str(entry.entity_id) if entry.entity_id else None,
                "context": entry.context,
                "ip_address": entry.ip_address,
                "created_at": entry.created_at.isoformat(),
            }
            for entry in rows
        ],
        "total": len(rows),
    }
