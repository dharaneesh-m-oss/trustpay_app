"""Dispute lifecycle.

Section 17 and section 23 together: either party may raise a dispute, the AI may
summarise it, and an authorised human resolves it. Resolution is the only path
in this module that moves money, and it goes through the same ledger primitive
as every other movement.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.ai import analysis as ai_analysis
from app.ai import review as ai_review
from app.ai.constants import AnalysisType
from app.audit import service as audit
from app.core.context import RequestContext
from app.core.exceptions import BusinessRuleViolation, NotFoundError
from app.core.money import ZERO, to_money
from app.disputes.constants import (
    OPEN_STATUSES,
    DisputeOutcome,
    DisputeReason,
    DisputeStatus,
)
from app.disputes.model import Dispute, DisputeMessage
from app.ledger import service as ledger
from app.ledger.constants import AccountType, PostingDirection, TransactionType
from app.milestones import service as milestones
from app.milestones.constants import PROTECTED_STATUSES, MilestoneStatus
from app.notifications import service as notifications
from app.notifications.constants import NotificationSeverity, NotificationType
from app.projects import service as projects
from app.projects.constants import ProjectStatus
from app.projects.exceptions import NotAProjectMemberError
from app.users.model import User


class DisputeNotFoundError(NotFoundError):
    code = "DISPUTE_NOT_FOUND"
    message = "We could not find that dispute."


class DisputeAlreadyOpenError(BusinessRuleViolation):
    code = "DISPUTE_ALREADY_OPEN"
    message = "There is already an open dispute on this milestone."


class DisputeNotOpenError(BusinessRuleViolation):
    code = "DISPUTE_NOT_OPEN"
    message = "This dispute has already been resolved."


def _now() -> datetime:
    return datetime.now(UTC)


def get_dispute(db: Session, dispute_id: uuid.UUID) -> Dispute:
    dispute = db.scalar(
        select(Dispute)
        .where(Dispute.id == dispute_id)
        .options(selectinload(Dispute.messages))
    )
    if dispute is None:
        raise DisputeNotFoundError()
    return dispute


def raise_dispute(
    db: Session,
    milestone_id: uuid.UUID,
    raiser: User,
    *,
    reason: DisputeReason,
    description: str,
    evidence: list | None = None,
    context: RequestContext | None = None,
) -> Dispute:
    context = context or RequestContext()

    milestone = milestones.get_milestone(db, milestone_id)
    project = milestone.project

    role = milestones.assert_member(project, raiser)

    existing = db.scalar(
        select(Dispute).where(
            Dispute.milestone_id == milestone_id,
            Dispute.status.in_(list(OPEN_STATUSES)),
        )
    )
    if existing is not None:
        raise DisputeAlreadyOpenError()

    locked = milestones.get_milestone_for_update(db, milestone_id)
    if locked.status not in PROTECTED_STATUSES:
        raise BusinessRuleViolation(
            "There are no protected funds on this milestone to dispute."
        )

    against_id = (
        project.receiver_id if raiser.id == project.client_id else project.client_id
    )

    dispute = Dispute(
        milestone_id=locked.id,
        project_id=project.id,
        raised_by_id=raiser.id,
        against_id=against_id,
        reason=reason,
        description=description.strip(),
        status=DisputeStatus.OPEN,
    )
    db.add(dispute)
    db.flush()

    db.add(
        DisputeMessage(
            dispute_id=dispute.id,
            author_id=raiser.id,
            body=description.strip(),
            evidence=evidence or [],
            author_role=str(role),
        )
    )

    # The milestone freezes: no release, no cancellation, until this resolves.
    if locked.status != MilestoneStatus.DISPUTED:
        milestones.transition(locked, MilestoneStatus.DISPUTED)
    project.status = ProjectStatus.UNDER_DISPUTE

    notifications.create(
        db,
        user_id=against_id,
        notification_type=NotificationType.DISPUTE_RAISED,
        title="A dispute was raised",
        body=f"{raiser.full_name} raised a dispute on “{locked.title}”.",
        target={"screen": "dispute", "id": str(dispute.id)},
        project_id=project.id,
        milestone_id=locked.id,
        severity=NotificationSeverity.CRITICAL,
    )

    audit.record(
        db,
        action="DISPUTE_RAISED",
        actor_user_id=raiser.id,
        entity_type="dispute",
        entity_id=dispute.id,
        context={"reason": str(reason), "milestone_id": str(locked.id)},
        ip_address=context.ip_address,
        user_agent=context.user_agent,
    )
    db.commit()
    db.refresh(dispute)
    return dispute


def add_message(
    db: Session,
    dispute_id: uuid.UUID,
    author: User,
    *,
    body: str,
    evidence: list | None = None,
    context: RequestContext | None = None,
) -> Dispute:
    context = context or RequestContext()

    dispute = get_dispute(db, dispute_id)
    if dispute.status not in OPEN_STATUSES:
        raise DisputeNotOpenError()

    project = projects.get_project_for_user(db, dispute.project_id, author)
    role = "ADMIN" if author.is_admin else str(project.role_of(author.id))

    if not author.is_admin and project.role_of(author.id) is None:
        raise NotAProjectMemberError()

    db.add(
        DisputeMessage(
            dispute_id=dispute.id,
            author_id=author.id,
            body=body.strip(),
            evidence=evidence or [],
            author_role=role,
        )
    )

    if dispute.status == DisputeStatus.OPEN and not author.is_admin:
        dispute.status = DisputeStatus.AWAITING_RESPONSE

    other_party = (
        dispute.against_id if author.id == dispute.raised_by_id else dispute.raised_by_id
    )
    notifications.create(
        db,
        user_id=other_party,
        notification_type=NotificationType.DISPUTE_RAISED,
        title="New message on your dispute",
        body=f"{author.full_name} added a statement.",
        target={"screen": "dispute", "id": str(dispute.id)},
        project_id=dispute.project_id,
        milestone_id=dispute.milestone_id,
    )

    db.commit()
    db.refresh(dispute)
    return dispute


def generate_ai_summary(db: Session, dispute: Dispute) -> dict:
    """Summarise both sides. Advisory only — stored so it is auditable."""
    milestone = milestones.get_milestone(db, dispute.milestone_id)
    payload = ai_review.review_dispute(dispute, milestone, milestone.project)

    dispute.ai_summary = payload
    dispute.ai_summary_generated_at = _now()

    ai_analysis.store(
        db,
        analysis_type=AnalysisType.DISPUTE,
        result=payload,
        project_id=dispute.project_id,
        milestone_id=dispute.milestone_id,
        dispute_id=dispute.id,
    )
    db.commit()
    return payload


def resolve(
    db: Session,
    dispute_id: uuid.UUID,
    admin: User,
    *,
    outcome: DisputeOutcome,
    note: str,
    split_to_receiver: str | None = None,
    context: RequestContext | None = None,
) -> Dispute:
    """Admin decision. The only place a dispute moves money.

    The AI's summary may inform this, but the outcome recorded here is the
    admin's — the model has no authority to release or refund anything.
    """
    context = context or RequestContext()

    dispute = get_dispute(db, dispute_id)
    if dispute.status not in OPEN_STATUSES:
        raise DisputeNotOpenError()

    milestone = milestones.get_milestone_for_update(db, dispute.milestone_id)
    project = milestone.project

    protected = ledger.get_or_create_account(
        db,
        owner_user_id=project.client_id,
        account_type=AccountType.USER_PROTECTED,
        currency=milestone.currency,
    )
    client_available = ledger.get_or_create_account(
        db,
        owner_user_id=project.client_id,
        account_type=AccountType.USER_AVAILABLE,
        currency=milestone.currency,
    )
    receiver_available = ledger.get_or_create_account(
        db,
        owner_user_id=project.receiver_id,
        account_type=AccountType.USER_AVAILABLE,
        currency=milestone.currency,
    )

    amount = to_money(milestone.amount)

    if outcome == DisputeOutcome.RELEASE_TO_RECEIVER:
        ledger.post(
            db,
            transaction_type=TransactionType.PAYMENT_RELEASE,
            postings=[
                ledger.PostingRequest(
                    account_id=protected.id,
                    direction=PostingDirection.DEBIT,
                    amount=amount,
                ),
                ledger.PostingRequest(
                    account_id=receiver_available.id,
                    direction=PostingDirection.CREDIT,
                    amount=amount,
                ),
            ],
            description=f"Dispute resolved — payment released for “{milestone.title}”",
            currency=milestone.currency,
            initiated_by_user_id=admin.id,
            sender_user_id=project.client_id,
            receiver_user_id=project.receiver_id,
            project_id=project.id,
            milestone_id=milestone.id,
        )
        milestones.transition(milestone, MilestoneStatus.APPROVED)
        milestones.transition(milestone, MilestoneStatus.PAYMENT_RELEASED)

    elif outcome == DisputeOutcome.REFUND_TO_CLIENT:
        ledger.post(
            db,
            transaction_type=TransactionType.REFUND,
            postings=[
                ledger.PostingRequest(
                    account_id=protected.id,
                    direction=PostingDirection.DEBIT,
                    amount=amount,
                ),
                ledger.PostingRequest(
                    account_id=client_available.id,
                    direction=PostingDirection.CREDIT,
                    amount=amount,
                ),
            ],
            description=f"Dispute resolved — refund for “{milestone.title}”",
            currency=milestone.currency,
            initiated_by_user_id=admin.id,
            sender_user_id=project.client_id,
            receiver_user_id=project.client_id,
            project_id=project.id,
            milestone_id=milestone.id,
        )
        milestones.transition(milestone, MilestoneStatus.CANCELLED)

    elif outcome == DisputeOutcome.SPLIT:
        receiver_share = to_money(split_to_receiver or ZERO)
        if receiver_share <= ZERO or receiver_share >= amount:
            raise BusinessRuleViolation(
                "A split must give the receiver more than nothing and less than the full amount."
            )
        client_share = amount - receiver_share

        # One transaction, three postings: the protected balance is debited once
        # and the two shares credited, so the entry still balances exactly.
        ledger.post(
            db,
            transaction_type=TransactionType.ADJUSTMENT,
            postings=[
                ledger.PostingRequest(
                    account_id=protected.id,
                    direction=PostingDirection.DEBIT,
                    amount=amount,
                ),
                ledger.PostingRequest(
                    account_id=receiver_available.id,
                    direction=PostingDirection.CREDIT,
                    amount=receiver_share,
                ),
                ledger.PostingRequest(
                    account_id=client_available.id,
                    direction=PostingDirection.CREDIT,
                    amount=client_share,
                ),
            ],
            description=f"Dispute resolved — split settlement for “{milestone.title}”",
            currency=milestone.currency,
            initiated_by_user_id=admin.id,
            sender_user_id=project.client_id,
            receiver_user_id=project.receiver_id,
            project_id=project.id,
            milestone_id=milestone.id,
        )
        milestones.transition(milestone, MilestoneStatus.CANCELLED)

    else:  # NO_ACTION — funds stay protected, milestone returns to funded
        milestones.transition(milestone, MilestoneStatus.FUNDED)

    dispute.status = DisputeStatus.RESOLVED
    dispute.outcome = outcome
    dispute.resolution_note = note.strip()
    dispute.resolved_by_id = admin.id
    dispute.resolved_at = _now()

    if project.status == ProjectStatus.UNDER_DISPUTE:
        project.status = ProjectStatus.ACTIVE
    projects.refresh_project_completion(db, project)

    for user_id in (dispute.raised_by_id, dispute.against_id):
        notifications.create(
            db,
            user_id=user_id,
            notification_type=NotificationType.DISPUTE_RESOLVED,
            title="Dispute resolved",
            body=f"A TrustPay reviewer resolved the dispute on “{milestone.title}”.",
            target={"screen": "dispute", "id": str(dispute.id)},
            project_id=project.id,
            milestone_id=milestone.id,
            severity=NotificationSeverity.INFO,
        )

    audit.record(
        db,
        action="DISPUTE_RESOLVED",
        actor_user_id=admin.id,
        entity_type="dispute",
        entity_id=dispute.id,
        context={"outcome": str(outcome), "amount": str(amount)},
        ip_address=context.ip_address,
        user_agent=context.user_agent,
    )
    db.commit()
    db.refresh(dispute)
    return dispute


def list_for_user(db: Session, user: User, *, limit: int = 20) -> list[Dispute]:
    return list(
        db.scalars(
            select(Dispute)
            .where((Dispute.raised_by_id == user.id) | (Dispute.against_id == user.id))
            .options(selectinload(Dispute.messages))
            .order_by(Dispute.created_at.desc())
            .limit(limit)
        ).all()
    )


def count_open(db: Session) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(Dispute)
            .where(Dispute.status.in_(list(OPEN_STATUSES)))
        )
        or 0
    )
