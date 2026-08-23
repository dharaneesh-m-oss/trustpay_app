"""Disputes (spec section 17).

Either party can raise one. The AI may summarise it; only an authorised human
resolves it, and the resolution is what moves money.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    String,
    Text,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.database.mixins import TimestampMixin, UUIDPrimaryKeyMixin
from app.disputes.constants import DisputeOutcome, DisputeReason, DisputeStatus


def _pg_enum(enum_cls: type, name: str) -> Enum:
    return Enum(
        enum_cls,
        name=name,
        native_enum=True,
        values_callable=lambda e: [member.value for member in e],
        validate_strings=True,
    )


class Dispute(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "disputes"

    milestone_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("milestones.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    raised_by_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    against_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    reason: Mapped[DisputeReason] = mapped_column(
        _pg_enum(DisputeReason, "dispute_reason"), nullable=False
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)

    status: Mapped[DisputeStatus] = mapped_column(
        _pg_enum(DisputeStatus, "dispute_status"),
        nullable=False,
        default=DisputeStatus.OPEN,
        server_default=DisputeStatus.OPEN.value,
        index=True,
    )

    #: Written by an admin at resolution, and the reason money moved.
    outcome: Mapped[DisputeOutcome | None] = mapped_column(
        _pg_enum(DisputeOutcome, "dispute_outcome"), nullable=True
    )
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    #: The AI's summary of both sides. Advisory only — stored so the admin can
    #: see what the assistant said, and so its reasoning is auditable.
    ai_summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ai_summary_generated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    messages: Mapped[list["DisputeMessage"]] = relationship(
        back_populates="dispute",
        cascade="all, delete-orphan",
        order_by="DisputeMessage.created_at",
    )


class DisputeMessage(Base, UUIDPrimaryKeyMixin):
    """One statement from one party, with its evidence.

    Append-only: neither party can edit what they said after the other has
    responded to it.
    """

    __tablename__ = "dispute_messages"

    dispute_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("disputes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    body: Mapped[str] = mapped_column(Text, nullable=False)
    evidence: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )

    #: Set when an admin writes on the thread, so their words are distinguishable
    #: from a party's.
    author_role: Mapped[str] = mapped_column(String(16), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    dispute: Mapped[Dispute] = relationship(back_populates="messages")
