"""Milestone and submission models."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.money import MoneyColumn
from app.database.base import Base
from app.database.mixins import TimestampMixin, UUIDPrimaryKeyMixin
from app.milestones.constants import DEFAULT_REVISION_LIMIT, MilestoneStatus


def _pg_enum(enum_cls: type, name: str) -> Enum:
    return Enum(
        enum_cls,
        name=name,
        native_enum=True,
        values_callable=lambda e: [member.value for member in e],
        validate_strings=True,
    )


class Milestone(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "milestones"

    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    #: 1-based position, shown as "01", "02" in the timeline.
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)

    title: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)

    #: What "done" means. The spec insists this is measurable, and the AI
    #: agreement analyser flags milestones whose criteria are vague.
    completion_criteria: Mapped[str] = mapped_column(Text, nullable=False)

    amount: Mapped[Decimal] = mapped_column(MoneyColumn, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)

    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    status: Mapped[MilestoneStatus] = mapped_column(
        _pg_enum(MilestoneStatus, "milestone_status"),
        nullable=False,
        default=MilestoneStatus.DRAFT,
        server_default=MilestoneStatus.DRAFT.value,
        index=True,
    )

    revision_limit: Mapped[int] = mapped_column(
        Integer, nullable=False, default=DEFAULT_REVISION_LIMIT
    )
    revisions_used: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    funded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    submitted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    released_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    #: The ledger transaction that protected the funds, and the one that paid
    #: them out. Their presence is what makes double-release detectable.
    funding_transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ledger_transactions.id", ondelete="RESTRICT"),
        nullable=True,
    )
    release_transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ledger_transactions.id", ondelete="RESTRICT"),
        nullable=True,
        unique=True,  # one milestone can never be paid out twice
    )

    project: Mapped["Project"] = relationship(back_populates="milestones")  # noqa: F821
    submissions: Mapped[list["MilestoneSubmission"]] = relationship(
        back_populates="milestone",
        cascade="all, delete-orphan",
        order_by="MilestoneSubmission.created_at",
    )

    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_is_positive"),
        CheckConstraint("sequence > 0", name="sequence_is_positive"),
        CheckConstraint("revisions_used >= 0", name="revisions_used_non_negative"),
        UniqueConstraint(
            "project_id", "sequence", name="uq_milestones_project_id_sequence"
        ),
    )

    @property
    def is_funded(self) -> bool:
        return self.funding_transaction_id is not None

    @property
    def is_released(self) -> bool:
        return self.release_transaction_id is not None


class MilestoneSubmission(Base, UUIDPrimaryKeyMixin):
    """Proof of work (spec section 42).

    Each submission is a new row rather than an update, so a resubmission after
    "changes requested" keeps the earlier attempt. A dispute is decided on what
    was actually submitted and when.
    """

    __tablename__ = "milestone_submissions"

    milestone_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("milestones.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    submitted_by_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    #: 1-based; a resubmission is attempt 2.
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    note: Mapped[str] = mapped_column(Text, nullable=False)
    completion_percentage: Mapped[int] = mapped_column(
        Integer, nullable=False, default=100
    )

    #: Links and file references. Stored as JSONB so evidence can gain fields
    #: without a migration; file *uploads* land in a later phase.
    evidence: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )

    #: What the client said when asking for changes, kept against the attempt
    #: it refers to.
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    milestone: Mapped[Milestone] = relationship(back_populates="submissions")

    __table_args__ = (
        CheckConstraint(
            "completion_percentage BETWEEN 0 AND 100",
            name="completion_percentage_in_range",
        ),
        UniqueConstraint(
            "milestone_id", "attempt", name="uq_milestone_submissions_milestone_id_attempt"
        ),
    )
