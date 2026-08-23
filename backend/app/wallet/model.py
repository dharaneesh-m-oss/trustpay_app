"""Wallet.

A wallet is a user's identity in the money system — one per person, holding
their currency and withdrawal eligibility. It deliberately holds **no balance
columns**.

docs/07_Database_Design.md sketches `available_balance` and `locked_balance` on
this table. That contradicts sections 8 and 30 of the product spec, which
require the ledger to be authoritative, and the contradiction is not academic:
two places storing the same number is exactly how a wallet ends up disagreeing
with the transaction history that produced it. Balances are therefore read from
the user's ledger accounts and assembled in wallet/service.py.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.config.settings import settings
from app.database.base import Base
from app.database.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Wallet(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "wallets"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,  # "every user has exactly one wallet"
        index=True,
    )

    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, default=settings.DEFAULT_CURRENCY
    )

    #: Withdrawals stay closed until identity checks pass. Nothing verifies this
    #: yet; the column exists so the withdrawal path can enforce it from day one
    #: rather than being retrofitted.
    kyc_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    #: Set when an admin freezes a wallet during a dispute or risk review.
    frozen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    frozen_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    @property
    def is_frozen(self) -> bool:
        return self.frozen_at is not None
