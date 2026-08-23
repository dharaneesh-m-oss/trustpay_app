"""Feature engineering — layer 1 of the Trust Score (spec section 19).

Raw activity is converted into a fixed, ordered vector of behavioural signals.
Every feature is computed from data TrustPay actually holds; none of them are
placeholders, and none of them are invented at request time.

The order of FEATURE_NAMES is part of the model contract: the trained
coefficients are positional, so changing the order without retraining would
silently score people against the wrong weights.
"""

from __future__ import annotations

import statistics
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.cancellation.model import CancellationRequest
from app.disputes.model import Dispute
from app.ledger.constants import TransactionType
from app.ledger.model import LedgerTransaction
from app.milestones.constants import MilestoneStatus
from app.milestones.model import Milestone
from app.projects.model import Project
from app.users.model import User

#: Positional. Do not reorder without retraining the model.
FEATURE_NAMES: tuple[str, ...] = (
    "account_age_days",
    "transaction_count",
    "transaction_frequency_per_week",
    "avg_transaction_amount",
    "amount_deviation",
    "cancellation_rate",
    "dispute_rate",
    "successful_project_rate",
    "milestone_clarity",
    "payment_consistency",
)

#: Plain-language names for the explanation shown to users. Section 22 is
#: explicit that raw model internals must not reach an ordinary user.
FEATURE_LABELS: dict[str, str] = {
    "account_age_days": "Account history",
    "transaction_count": "Transaction volume",
    "transaction_frequency_per_week": "Activity pattern",
    "avg_transaction_amount": "Typical transaction size",
    "amount_deviation": "Consistency of amounts",
    "cancellation_rate": "Cancellation behaviour",
    "dispute_rate": "Dispute history",
    "successful_project_rate": "Completed projects",
    "milestone_clarity": "Clarity of milestone terms",
    "payment_consistency": "Payment behaviour",
}

#: How to phrase each feature when it is helping or hurting the score.
FEATURE_PHRASING: dict[str, tuple[str, str]] = {
    "account_age_days": ("Established account history", "Very new account"),
    "transaction_count": ("Consistent transaction record", "Little transaction history"),
    "transaction_frequency_per_week": (
        "Normal activity pattern",
        "Unusually rapid activity",
    ),
    "avg_transaction_amount": ("Typical transaction sizes", "Unusually large transactions"),
    "amount_deviation": ("Consistent transaction amounts", "Erratic transaction amounts"),
    "cancellation_rate": ("No cancellation problems", "Repeated cancellations"),
    "dispute_rate": ("No previous disputes", "Previous disputes on record"),
    "successful_project_rate": (
        "Strong record of completed projects",
        "Few projects completed successfully",
    ),
    "milestone_clarity": (
        "Clear, measurable milestone terms",
        "Vague milestone completion criteria",
    ),
    "payment_consistency": ("Consistent payment behaviour", "Inconsistent payment behaviour"),
}


@dataclass(frozen=True, slots=True)
class FeatureSet:
    values: dict[str, float]
    #: How many observable events this user has. Confidence is derived from it,
    #: because a score built on three data points is not the same claim as one
    #: built on three hundred (section 20).
    evidence_count: int

    def vector(self) -> list[float]:
        return [self.values[name] for name in FEATURE_NAMES]


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _safe_ratio(numerator: float, denominator: float, default: float = 0.0) -> float:
    return numerator / denominator if denominator else default


def compute_features(db: Session, user: User) -> FeatureSet:
    """Build the feature vector for one user from their real activity."""
    now = datetime.now(UTC)

    created_at = user.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=UTC)
    age_days = max((now - created_at).total_seconds() / 86400.0, 0.0)

    # ---- transactions ----
    transactions = list(
        db.scalars(
            select(LedgerTransaction).where(
                (LedgerTransaction.sender_user_id == user.id)
                | (LedgerTransaction.receiver_user_id == user.id)
            )
        ).all()
    )
    amounts = [float(Decimal(str(item.amount))) for item in transactions]
    transaction_count = len(transactions)

    weeks_active = max(age_days / 7.0, 1.0)
    frequency = _safe_ratio(transaction_count, weeks_active)

    mean_amount = statistics.fmean(amounts) if amounts else 0.0
    # Coefficient of variation: spread relative to size, so a user who always
    # moves large amounts is not penalised for the size alone.
    deviation = (
        _safe_ratio(statistics.pstdev(amounts), mean_amount)
        if len(amounts) > 1 and mean_amount
        else 0.0
    )

    # ---- projects and milestones ----
    projects = list(
        db.scalars(
            select(Project).where(
                (Project.client_id == user.id) | (Project.receiver_id == user.id)
            )
        ).all()
    )
    project_ids = [project.id for project in projects]

    milestones = (
        list(
            db.scalars(
                select(Milestone).where(Milestone.project_id.in_(project_ids))
            ).all()
        )
        if project_ids
        else []
    )

    resolved = [
        milestone
        for milestone in milestones
        if milestone.status
        in (MilestoneStatus.PAYMENT_RELEASED, MilestoneStatus.CANCELLED)
    ]
    released = [
        milestone
        for milestone in resolved
        if milestone.status == MilestoneStatus.PAYMENT_RELEASED
    ]

    cancellations = int(
        db.scalar(
            select(func.count())
            .select_from(CancellationRequest)
            .where(CancellationRequest.requested_by_id == user.id)
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

    total_milestones = max(len(milestones), 1)
    cancellation_rate = _clamp(_safe_ratio(cancellations, total_milestones))
    dispute_rate = _clamp(_safe_ratio(disputes, max(len(projects), 1)))
    success_rate = _clamp(_safe_ratio(len(released), max(len(resolved), 1), default=0.0))

    # ---- milestone clarity ----
    # A measurable proxy for section 25's concern: milestones whose completion
    # criteria are one vague line are the ones that end up in dispute.
    if milestones:
        clarity_scores = []
        for milestone in milestones:
            criteria = (milestone.completion_criteria or "").strip()
            length_score = _clamp(len(criteria) / 160.0)
            has_detail = 1.0 if len(criteria.split()) >= 8 else 0.0
            has_deadline = 1.0 if milestone.due_date else 0.0
            clarity_scores.append(
                0.5 * length_score + 0.3 * has_detail + 0.2 * has_deadline
            )
        milestone_clarity = _clamp(statistics.fmean(clarity_scores))
    else:
        milestone_clarity = 0.5  # nothing observed: neutral, not good or bad

    # ---- payment consistency ----
    # Of the milestones this user funded, how many did they see through to
    # release rather than abandoning or cancelling?
    funded = [milestone for milestone in milestones if milestone.funded_at is not None]
    payment_consistency = (
        _clamp(_safe_ratio(len(released), len(funded), default=0.5))
        if funded
        else 0.5
    )

    evidence_count = transaction_count + len(milestones) + len(projects)

    values = {
        # Normalised into ranges the model was trained on; raw days or rupees
        # would let one feature dominate purely by scale.
        "account_age_days": _clamp(age_days / 365.0),
        "transaction_count": _clamp(transaction_count / 50.0),
        "transaction_frequency_per_week": _clamp(frequency / 20.0),
        "avg_transaction_amount": _clamp(mean_amount / 200000.0),
        "amount_deviation": _clamp(deviation / 3.0),
        "cancellation_rate": cancellation_rate,
        "dispute_rate": dispute_rate,
        "successful_project_rate": success_rate,
        "milestone_clarity": milestone_clarity,
        "payment_consistency": payment_consistency,
    }

    return FeatureSet(values=values, evidence_count=evidence_count)


def describe_features(features: FeatureSet) -> dict[str, float]:
    """Rounded copy, safe to store as JSONB and show to an admin."""
    return {name: round(value, 4) for name, value in features.values.items()}
