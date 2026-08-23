"""Ledger tables.

Three tables:

* `ledger_accounts` — where money can sit, one row per (owner, type, currency).
* `ledger_transactions` — one row per financial event, carrying the user-facing
  description and the idempotency key.
* `ledger_postings` — the debits and credits. Append-only.

`ledger_accounts.balance` is a **cache**. The authoritative balance is the sum
of an account's postings; the cached column exists so reading a wallet does not
aggregate the entire posting history on every request. It is written in the same
transaction as the postings that change it, and
`ledger.service.reconcile()` recomputes from postings to prove the two agree.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.money import MoneyColumn
from app.database.base import Base
from app.database.mixins import TimestampMixin, UUIDPrimaryKeyMixin
from app.ledger.constants import (
    SYSTEM_ACCOUNT_TYPES,
    USER_ACCOUNT_TYPES,
    AccountType,
    PostingDirection,
    TransactionStatus,
    TransactionType,
)


def _pg_enum(enum_cls: type, name: str) -> Enum:
    return Enum(
        enum_cls,
        name=name,
        native_enum=True,
        values_callable=lambda e: [member.value for member in e],
        validate_strings=True,
    )


class LedgerAccount(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "ledger_accounts"

    # NULL for system accounts, which belong to the platform rather than a person.
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )

    account_type: Mapped[AccountType] = mapped_column(
        _pg_enum(AccountType, "ledger_account_type"), nullable=False
    )

    currency: Mapped[str] = mapped_column(String(3), nullable=False)

    #: Cached. Authoritative value is SUM of postings — see the module docstring.
    balance: Mapped[Decimal] = mapped_column(
        MoneyColumn, nullable=False, default=Decimal("0.00"), server_default="0"
    )

    __table_args__ = (
        # One account per purpose per currency per owner. This is what makes
        # "get or create the user's available account" safe under concurrency.
        UniqueConstraint(
            "owner_user_id",
            "account_type",
            "currency",
            name="uq_ledger_accounts_owner_user_id_account_type_currency",
        ),
        # A user account must have an owner and a system account must not.
        # Written as explicit value lists rather than a LIKE pattern: the column
        # is a native enum, and PostgreSQL has no LIKE operator for enum types.
        # Generating the lists from the constants keeps them from drifting.
        CheckConstraint(
            "(owner_user_id IS NOT NULL AND account_type IN ({user})) "
            "OR (owner_user_id IS NULL AND account_type IN ({system}))".format(
                user=", ".join(f"'{item.value}'" for item in sorted(USER_ACCOUNT_TYPES)),
                system=", ".join(
                    f"'{item.value}'" for item in sorted(SYSTEM_ACCOUNT_TYPES)
                ),
            ),
            name="owner_matches_account_type",
        ),
        CheckConstraint("char_length(currency) = 3", name="currency_is_iso_4217"),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<LedgerAccount {self.account_type} {self.currency} {self.balance}>"


class LedgerTransaction(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One financial event. Satisfies the transaction record required by
    section 9: id, type, amount, currency, timestamp, status, related project
    and milestone, and both parties."""

    __tablename__ = "ledger_transactions"

    transaction_type: Mapped[TransactionType] = mapped_column(
        _pg_enum(TransactionType, "ledger_transaction_type"), nullable=False, index=True
    )
    status: Mapped[TransactionStatus] = mapped_column(
        _pg_enum(TransactionStatus, "ledger_transaction_status"),
        nullable=False,
        default=TransactionStatus.POSTED,
        server_default=TransactionStatus.POSTED.value,
    )

    #: The headline figure shown to users. Equal to the sum of the debits (which
    #: equals the sum of the credits), stored so a statement does not have to
    #: re-derive it.
    amount: Mapped[Decimal] = mapped_column(MoneyColumn, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)

    # Who caused it and who the money concerned. Both nullable because a system
    # adjustment has no initiating user.
    initiated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    sender_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    receiver_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Foreign keys are added when the projects module lands; until those tables
    # exist a constrained column could not be created.
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), nullable=True, index=True
    )
    milestone_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), nullable=True, index=True
    )

    description: Mapped[str] = mapped_column(String(255), nullable=False)

    #: Section 14: repeating a financial request must not create a second
    #: transaction. The unique index is what actually enforces it — two
    #: simultaneous requests cannot both pass a pre-check.
    idempotency_key: Mapped[str | None] = mapped_column(
        String(128), nullable=True, unique=True
    )
    #: Fingerprint of the request that created this transaction, so replaying a
    #: key with *different* details is rejected instead of silently returning
    #: someone else's result.
    request_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)

    #: True while DEMO_MODE is on: no real money was involved.
    is_simulated: Mapped[bool] = mapped_column(
        nullable=False, default=True, server_default="true"
    )

    #: Set when a later transaction reverses this one. The original row stays.
    reversed_by_transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ledger_transactions.id", ondelete="SET NULL"),
        nullable=True,
    )

    postings: Mapped[list["LedgerPosting"]] = relationship(
        back_populates="transaction",
        cascade="all, delete-orphan",
        order_by="LedgerPosting.direction",
    )

    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_is_positive"),
        Index("ix_ledger_transactions_created_at", "created_at"),
    )


class LedgerPosting(Base, UUIDPrimaryKeyMixin):
    """A single debit or credit. Append-only: never updated, never deleted."""

    __tablename__ = "ledger_postings"

    transaction_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ledger_transactions.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ledger_accounts.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    direction: Mapped[PostingDirection] = mapped_column(
        _pg_enum(PostingDirection, "ledger_posting_direction"), nullable=False
    )
    amount: Mapped[Decimal] = mapped_column(MoneyColumn, nullable=False)

    #: The account's balance immediately after this posting, so a statement can
    #: show a running balance without replaying the whole history.
    balance_after: Mapped[Decimal] = mapped_column(MoneyColumn, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    #: Free-text context for support and dispute review.
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    transaction: Mapped[LedgerTransaction] = relationship(back_populates="postings")

    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_is_positive"),
        Index("ix_ledger_postings_account_id_created_at", "account_id", "created_at"),
    )
