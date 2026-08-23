"""Cancellation requests and OTP verification (spec sections 15 and 16).

The rule this table exists to enforce: a client who has funded a milestone
cannot simply take the money back. Cancelling protected funds requires the
*receiver* to confirm with a one-time code sent to their own contact details.

The OTP is stored only as a hash, exactly like a password. Nothing in the
system can read it back — not an admin, not a log, not an API response.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.cancellation.constants import CancellationStatus, OtpPurpose, OtpStatus
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


class CancellationRequest(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "cancellation_requests"

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

    requested_by_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    #: The person who must approve. Only this user may verify the OTP.
    counterparty_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    reason: Mapped[str] = mapped_column(Text, nullable=False)

    status: Mapped[CancellationStatus] = mapped_column(
        _pg_enum(CancellationStatus, "cancellation_status"),
        nullable=False,
        default=CancellationStatus.AWAITING_RECEIVER,
        server_default=CancellationStatus.AWAITING_RECEIVER.value,
        index=True,
    )

    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    decline_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    #: The refund posting, once the cancellation completes.
    refund_transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ledger_transactions.id", ondelete="RESTRICT"),
        nullable=True,
        unique=True,  # a cancellation can never refund twice
    )

    verifications: Mapped[list["OtpVerification"]] = relationship(
        back_populates="cancellation_request",
        cascade="all, delete-orphan",
        order_by="OtpVerification.created_at",
    )


class OtpVerification(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A single one-time code.

    Never stores the code itself. `code_hash` is a salted hash; verification
    re-hashes the submitted code and compares in constant time.
    """

    __tablename__ = "otp_verifications"

    cancellation_request_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("cancellation_requests.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    #: The only account permitted to submit this code.
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    purpose: Mapped[OtpPurpose] = mapped_column(
        _pg_enum(OtpPurpose, "otp_purpose"), nullable=False
    )
    status: Mapped[OtpStatus] = mapped_column(
        _pg_enum(OtpStatus, "otp_status"),
        nullable=False,
        default=OtpStatus.ACTIVE,
        server_default=OtpStatus.ACTIVE.value,
    )

    code_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    #: Where it was sent, masked for display ("+91 ****3210").
    delivered_to: Mapped[str | None] = mapped_column(String(64), nullable=True)

    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    consumed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=5)

    cancellation_request: Mapped[CancellationRequest | None] = relationship(
        back_populates="verifications"
    )

    __table_args__ = (
        CheckConstraint("attempts >= 0", name="attempts_non_negative"),
        CheckConstraint("max_attempts > 0", name="max_attempts_is_positive"),
    )

    def is_usable(self, now: datetime) -> bool:
        return (
            self.status == OtpStatus.ACTIVE
            and self.consumed_at is None
            and self.expires_at > now
            and self.attempts < self.max_attempts
        )
