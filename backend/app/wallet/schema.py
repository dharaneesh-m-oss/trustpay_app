"""Wallet contracts.

Amounts cross the wire as strings. JSON numbers are IEEE 754 doubles in most
clients, and 15000.10 does not survive that round trip exactly — which is fine
for a like count and unacceptable for money.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

from app.core.money import as_field_error
from app.ledger.constants import TransactionStatus, TransactionType


class MoneyModel(BaseModel):
    """Base for responses that carry Decimal money fields."""

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("*", when_used="json")
    def _serialise_decimals(self, value: object) -> object:
        return f"{value:.2f}" if isinstance(value, Decimal) else value


class WalletBalanceResponse(MoneyModel):
    """The four figures the home screen shows (spec section 39)."""

    wallet_id: uuid.UUID
    currency: str

    available: Decimal
    protected: Decimal
    pending_settlement: Decimal

    #: available + protected + pending_settlement. Everything the user owns,
    #: whatever state it is in.
    total: Decimal

    is_frozen: bool
    kyc_verified: bool
    demo_mode: bool


class AmountRequest(BaseModel):
    """Accepts a string or a number, always lands on an exact Decimal."""

    amount: Decimal = Field(gt=0)
    idempotency_key: str | None = Field(default=None, min_length=8, max_length=128)
    description: str | None = Field(default=None, max_length=255)

    @field_validator("amount", mode="before")
    @classmethod
    def _reject_float(cls, value: object) -> object:
        if isinstance(value, float):
            # A float has already lost precision by the time it reaches here.
            return str(value)
        return value

    @field_validator("amount")
    @classmethod
    def _normalise(cls, value: Decimal) -> Decimal:
        return as_field_error(value, "Amount")


class TopUpRequest(AmountRequest):
    pass


class WithdrawRequest(AmountRequest):
    pass


class PostingResponse(MoneyModel):
    account_type: str
    direction: str
    amount: Decimal
    balance_after: Decimal


class TransactionResponse(MoneyModel):
    id: uuid.UUID
    transaction_type: TransactionType
    status: TransactionStatus
    amount: Decimal
    currency: str
    description: str
    created_at: datetime

    project_id: uuid.UUID | None = None
    milestone_id: uuid.UUID | None = None
    sender_user_id: uuid.UUID | None = None
    receiver_user_id: uuid.UUID | None = None

    is_simulated: bool

    #: Signed effect on this user's available balance, so a client can render
    #: "+₹500" or "−₹500" without knowing double-entry rules.
    direction_for_user: str
    net_effect: Decimal


class TransactionPage(BaseModel):
    items: list[TransactionResponse]
    total: int
    limit: int
    offset: int


class ReconciliationResponse(MoneyModel):
    """Admin-facing proof that the books balance."""

    is_balanced: bool
    total_debits: Decimal
    total_credits: Decimal
    accounts_checked: int
    discrepancies: list[dict]
