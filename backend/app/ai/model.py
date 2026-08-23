"""Trust Score and AI analysis storage.

Scores are persisted rather than computed on every read for two reasons: the
mobile client needs a stable number between recalculations, and section 50
requires notifying a user when their score *changes*, which is only possible if
the previous value was kept.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.ai.constants import AnalysisType, ConfidenceLevel, RiskBand
from app.database.base import Base
from app.database.mixins import TimestampMixin, UUIDPrimaryKeyMixin


def _pg_enum(enum_cls: type, name: str) -> Enum:
    return Enum(
        enum_cls,
        name=name,
        native_enum=True,
        values_callable=lambda e: [member.value for member in e],
        validate_strings=True,
    )


class TrustScore(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One scoring of one user at one point in time.

    Rows accumulate; the newest is current. That history is what makes
    "your score moved from 91 to 84, here is why" answerable.
    """

    __tablename__ = "trust_scores"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    score: Mapped[int] = mapped_column(Integer, nullable=False)
    risk_band: Mapped[RiskBand] = mapped_column(
        _pg_enum(RiskBand, "risk_band"), nullable=False
    )

    #: The model's raw output before it was mapped onto 0-100.
    risk_probability: Mapped[float] = mapped_column(Float, nullable=False)

    confidence: Mapped[ConfidenceLevel] = mapped_column(
        _pg_enum(ConfidenceLevel, "confidence_level"), nullable=False
    )

    #: The engineered features the score was computed from, kept verbatim so a
    #: past score can be explained — or audited — long after the fact.
    features: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")

    #: Per-feature contributions, positive and negative, in plain language.
    explanation: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )

    #: Version of the scoring model, so scores from different models are never
    #: silently compared.
    model_version: Mapped[str] = mapped_column(String(32), nullable=False)

    previous_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    change_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    __table_args__ = (
        CheckConstraint("score BETWEEN 0 AND 100", name="score_in_range"),
        CheckConstraint(
            "risk_probability BETWEEN 0 AND 1", name="risk_probability_in_range"
        ),
        Index("ix_trust_scores_user_id_created_at", "user_id", "created_at"),
    )


class AIAnalysis(Base, UUIDPrimaryKeyMixin):
    """Stored output of an AI analysis (agreement, dispute, payment risk).

    Persisted because these outputs influence decisions people make about money.
    An advisory opinion that cannot be reviewed afterwards is not auditable.
    """

    __tablename__ = "ai_analyses"

    analysis_type: Mapped[AnalysisType] = mapped_column(
        _pg_enum(AnalysisType, "ai_analysis_type"), nullable=False, index=True
    )

    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=True
    )
    milestone_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("milestones.id", ondelete="CASCADE"), nullable=True
    )
    dispute_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("disputes.id", ondelete="CASCADE"), nullable=True
    )

    result: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    model_version: Mapped[str] = mapped_column(String(32), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )


class RiskSignal(Base, UUIDPrimaryKeyMixin):
    """A rule-based flag (spec section 24).

    Deliberately separate from the ML score. Rules are deterministic and
    explainable on their own terms — "this transfer is 40x your usual" is a fact,
    not a prediction — and they feed the model as features rather than being
    replaced by it.
    """

    __tablename__ = "risk_signals"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    rule: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    message: Mapped[str] = mapped_column(String(255), nullable=False)
    context: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")

    transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ledger_transactions.id", ondelete="SET NULL"),
        nullable=True,
    )

    #: An admin has looked at this and decided what, if anything, to do.
    acknowledged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
