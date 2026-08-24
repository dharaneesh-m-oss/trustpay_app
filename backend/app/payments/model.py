"""Payment tables: bank accounts, incoming intents, outgoing payouts.

Two invariants shape these:

  - **A full account number is never stored in a readable column.** Only the
    last four digits and a hash are kept. The hash exists so the same account
    can be recognised across users (one bank account, many "owners", is the
    oldest payout fraud there is) without the database becoming a list of
    account numbers worth stealing.
  - **Money-in and money-out both have a pending state that is not a balance.**
    An intent is not a credit and a payout is not a debit until the provider
    says so. The ledger is only touched at confirmation.
"""

from __future__ import annotations

import enum
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

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


class BankAccountStatus(str, enum.Enum):
    PENDING = "PENDING"
    """Format and IFSC check passed; ownership not yet proven."""

    VERIFIED = "VERIFIED"
    """A penny drop confirmed the account exists and the name matches."""

    REJECTED = "REJECTED"
    FAILED = "FAILED"


class PaymentIntentStatus(str, enum.Enum):
    CREATED = "CREATED"
    PENDING = "PENDING"
    """Handed to a UPI app. Nothing has been credited."""

    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    EXPIRED = "EXPIRED"


class PayoutStatus(str, enum.Enum):
    REQUESTED = "REQUESTED"
    PROCESSING = "PROCESSING"
    PROCESSED = "PROCESSED"
    REVERSED = "REVERSED"
    FAILED = "FAILED"


class BankAccount(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "bank_accounts"
    __table_args__ = (
        # One person cannot add the same account twice.
        UniqueConstraint("user_id", "account_hash", name="uq_bank_account_per_user"),
        # Finding every user who added a given account is the query that catches
        # a shared mule account, so it needs to be cheap.
        Index("ix_bank_accounts_hash", "account_hash"),
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    holder_name: Mapped[str] = mapped_column(String(120), nullable=False)
    ifsc: Mapped[str] = mapped_column(String(11), nullable=False)
    bank_name: Mapped[str] = mapped_column(String(120), nullable=False)
    branch: Mapped[str] = mapped_column(String(160), nullable=False)

    account_last4: Mapped[str] = mapped_column(String(4), nullable=False)
    """The only part of the number ever shown."""

    account_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    """SHA-256 of ifsc + account number, salted with the app secret."""

    account_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    """The number itself, encrypted. Needed to actually send a payout."""

    status: Mapped[BankAccountStatus] = mapped_column(
        _pg_enum(BankAccountStatus, "bank_account_status"),
        nullable=False,
        default=BankAccountStatus.PENDING,
    )

    name_match_score: Mapped[Decimal | None] = mapped_column(
        Numeric(4, 3), nullable=True
    )
    verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    failure_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_fund_account_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )
    is_default: Mapped[bool] = mapped_column(default=False, nullable=False)


class UpiAccount(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A saved UPI ID — BHIM, GPay, PhonePe, a bank's own app.

    A second kind of payout destination beside a bank account, and for most
    people the one they actually know: a VPA is memorable where an account
    number and IFSC are copied off a passbook.

    The same honesty rule applies as for bank accounts. A well-formed VPA is not
    a VPA that exists, and a VPA that exists is not one that belongs to this
    person. Only a provider-side validation establishes either, so an account
    added without one stays PENDING.
    """

    __tablename__ = "upi_accounts"
    __table_args__ = (
        UniqueConstraint("user_id", "vpa", name="uq_upi_account_per_user"),
        Index("ix_upi_accounts_vpa", "vpa"),
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    vpa: Mapped[str] = mapped_column(String(120), nullable=False)
    """Stored whole. Unlike an account number, a VPA is a public handle - it is
    what people put on a QR code in a shop window - so masking it would be
    ceremony without benefit."""

    holder_name: Mapped[str] = mapped_column(String(120), nullable=False)

    status: Mapped[BankAccountStatus] = mapped_column(
        _pg_enum(BankAccountStatus, "bank_account_status"),
        nullable=False,
        default=BankAccountStatus.PENDING,
    )
    """Shares the bank-account status enum: the states and their meanings are
    identical, and a second enum saying the same thing would drift."""

    name_match_score: Mapped[Decimal | None] = mapped_column(
        Numeric(4, 3), nullable=True
    )
    verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    failure_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_fund_account_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )
    is_default: Mapped[bool] = mapped_column(default=False, nullable=False)


class PaymentIntent(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """An attempt to put money in. Not a balance until the provider confirms."""

    __tablename__ = "payment_intents"
    __table_args__ = (
        UniqueConstraint("provider_order_id", name="uq_payment_intent_order"),
        # The webhook arrives keyed by payment id and must find its intent once.
        Index("ix_payment_intents_provider_payment", "provider_payment_id"),
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")

    status: Mapped[PaymentIntentStatus] = mapped_column(
        _pg_enum(PaymentIntentStatus, "payment_intent_status"),
        nullable=False,
        default=PaymentIntentStatus.CREATED,
    )

    reference: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False, default="razorpay")
    provider_order_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    provider_payment_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    ledger_transaction_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("ledger_transactions.id"), nullable=True
    )
    """Set exactly once, when the credit is posted. The guard against double credit."""

    failure_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class PayoutRequest(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """An attempt to take money out, to a verified bank account."""

    __tablename__ = "payout_requests"
    __table_args__ = (
        UniqueConstraint("reference", name="uq_payout_reference"),
        Index("ix_payout_requests_provider", "provider_payout_id"),
        # Exactly one destination. Neither would be a payout to nowhere; both
        # would be a payout whose destination depends on which column the code
        # happened to read.
        CheckConstraint(
            "(bank_account_id IS NULL) <> (upi_account_id IS NULL)",
            name="ck_payout_one_destination",
        ),
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bank_account_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("bank_accounts.id", ondelete="RESTRICT"), nullable=True
    )
    upi_account_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("upi_accounts.id", ondelete="RESTRICT"), nullable=True
    )

    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")

    status: Mapped[PayoutStatus] = mapped_column(
        _pg_enum(PayoutStatus, "payout_status"),
        nullable=False,
        default=PayoutStatus.REQUESTED,
    )

    reference: Mapped[str] = mapped_column(String(40), nullable=False)
    provider_payout_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    ledger_transaction_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("ledger_transactions.id"), nullable=True
    )
    """The debit, posted when the request is accepted and reversed if it fails."""

    failure_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
