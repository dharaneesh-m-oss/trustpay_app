"""Rule-based risk detection (spec section 24).

Deliberately separate from the ML model. Rules are deterministic and defensible
on their own terms — "this transfer is forty times your usual" is a fact, not a
prediction — and a person can argue with them. The model handles patterns that
resist being written down; the rules handle the ones that do not need to be.

Rules raise *signals*. They never block a transaction and never move money.
"""

from __future__ import annotations

import statistics
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai.constants import RULE_MESSAGES, RiskRule
from app.ai.model import RiskSignal
from app.cancellation.model import CancellationRequest
from app.disputes.model import Dispute
from app.ledger.model import LedgerTransaction
from app.projects.model import Project
from app.users.model import User

#: A transaction this many times the user's usual size is worth a look.
LARGE_MULTIPLE = 8.0
#: Below this, "8x your usual" is meaningless — everyone's first few
#: transactions are outliers relative to an empty history.
MIN_HISTORY_FOR_OUTLIER = 4

RAPID_WINDOW_MINUTES = 10
RAPID_COUNT = 5

CANCELLATION_RATE_THRESHOLD = 0.4
MIN_MILESTONES_FOR_RATE = 3

DISPUTE_RATE_THRESHOLD = 0.5
MIN_PROJECTS_FOR_RATE = 2

NEW_ACCOUNT_DAYS = 7
NEW_ACCOUNT_LARGE_AMOUNT = Decimal("100000.00")


@dataclass(frozen=True, slots=True)
class Signal:
    rule: RiskRule
    severity: str
    message: str
    context: dict


def evaluate(
    db: Session,
    user: User,
    *,
    amount: Decimal | None = None,
    transaction_id: uuid.UUID | None = None,
) -> list[Signal]:
    """Run every rule and return the signals that fired."""
    now = datetime.now(UTC)
    signals: list[Signal] = []

    history = list(
        db.scalars(
            select(LedgerTransaction.amount).where(
                (LedgerTransaction.sender_user_id == user.id)
                | (LedgerTransaction.receiver_user_id == user.id)
            )
        ).all()
    )
    amounts = [float(Decimal(str(value))) for value in history]

    # --- unusually large ---
    if amount is not None and len(amounts) >= MIN_HISTORY_FOR_OUTLIER:
        median = statistics.median(amounts)
        if median > 0 and float(amount) > median * LARGE_MULTIPLE:
            signals.append(
                Signal(
                    rule=RiskRule.UNUSUALLY_LARGE_TRANSACTION,
                    severity="MEDIUM",
                    message=RULE_MESSAGES[RiskRule.UNUSUALLY_LARGE_TRANSACTION],
                    context={
                        "amount": str(amount),
                        "usual_amount": f"{median:.2f}",
                        "multiple": round(float(amount) / median, 1),
                    },
                )
            )

    # --- rapid repetition ---
    recent = int(
        db.scalar(
            select(func.count())
            .select_from(LedgerTransaction)
            .where(
                (LedgerTransaction.initiated_by_user_id == user.id),
                LedgerTransaction.created_at
                >= now - timedelta(minutes=RAPID_WINDOW_MINUTES),
            )
        )
        or 0
    )
    if recent >= RAPID_COUNT:
        signals.append(
            Signal(
                rule=RiskRule.RAPID_REPEATED_TRANSACTIONS,
                severity="LOW",
                message=RULE_MESSAGES[RiskRule.RAPID_REPEATED_TRANSACTIONS],
                context={"count": recent, "window_minutes": RAPID_WINDOW_MINUTES},
            )
        )

    # --- new account moving a lot ---
    created_at = user.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=UTC)
    account_age_days = (now - created_at).days

    if (
        amount is not None
        and account_age_days < NEW_ACCOUNT_DAYS
        and Decimal(str(amount)) >= NEW_ACCOUNT_LARGE_AMOUNT
    ):
        signals.append(
            Signal(
                rule=RiskRule.NEW_ACCOUNT_LARGE_VALUE,
                severity="MEDIUM",
                message=RULE_MESSAGES[RiskRule.NEW_ACCOUNT_LARGE_VALUE],
                context={
                    "account_age_days": account_age_days,
                    "amount": str(amount),
                },
            )
        )

    # --- repeated cancellations ---
    cancellations = int(
        db.scalar(
            select(func.count())
            .select_from(CancellationRequest)
            .where(CancellationRequest.requested_by_id == user.id)
        )
        or 0
    )
    if cancellations >= MIN_MILESTONES_FOR_RATE:
        signals.append(
            Signal(
                rule=RiskRule.REPEATED_CANCELLATIONS,
                severity="HIGH",
                message=RULE_MESSAGES[RiskRule.REPEATED_CANCELLATIONS],
                context={"cancellations": cancellations},
            )
        )

    # --- dispute rate ---
    projects = int(
        db.scalar(
            select(func.count())
            .select_from(Project)
            .where((Project.client_id == user.id) | (Project.receiver_id == user.id))
        )
        or 0
    )
    disputes = int(
        db.scalar(
            select(func.count())
            .select_from(Dispute)
            .where((Dispute.raised_by_id == user.id) | (Dispute.against_id == user.id))
        )
        or 0
    )
    if projects >= MIN_PROJECTS_FOR_RATE and disputes / projects >= DISPUTE_RATE_THRESHOLD:
        signals.append(
            Signal(
                rule=RiskRule.HIGH_DISPUTE_RATE,
                severity="HIGH",
                message=RULE_MESSAGES[RiskRule.HIGH_DISPUTE_RATE],
                context={"disputes": disputes, "projects": projects},
            )
        )

    return signals


def record(
    db: Session,
    user: User,
    signals: list[Signal],
    transaction_id: uuid.UUID | None = None,
) -> list[RiskSignal]:
    """Persist signals for admin review. Stages; the caller commits."""
    rows = []
    for signal in signals:
        row = RiskSignal(
            user_id=user.id,
            rule=str(signal.rule),
            severity=signal.severity,
            message=signal.message,
            context=signal.context,
            transaction_id=transaction_id,
        )
        db.add(row)
        rows.append(row)
    return rows
