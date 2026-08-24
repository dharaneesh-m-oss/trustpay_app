"""Payment request and response shapes.

The account number appears in exactly one direction: inbound, once, when an
account is added. Nothing here ever returns it.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.payments.model import BankAccount, PayoutRequest, UpiAccount


class PaymentsStatusResponse(BaseModel):
    collections_enabled: bool
    payouts_enabled: bool
    google_sign_in_enabled: bool
    merchant_vpa: str | None
    minimum_payout: Decimal
    daily_payout_limit: Decimal
    note: str


class IfscLookupResponse(BaseModel):
    ifsc: str
    bank: str
    branch: str
    city: str
    state: str
    supports_imps: bool
    supports_neft: bool


class BankAccountCreateRequest(BaseModel):
    account_number: str = Field(min_length=9, max_length=24)
    ifsc: str = Field(min_length=11, max_length=11)
    holder_name: str = Field(min_length=2, max_length=120)

    @field_validator("account_number")
    @classmethod
    def _strip_account(cls, value: str) -> str:
        return value.replace(" ", "").replace("-", "")

    @field_validator("ifsc")
    @classmethod
    def _upper_ifsc(cls, value: str) -> str:
        return value.strip().upper()


class BankAccountResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    holder_name: str
    bank_name: str
    branch: str
    ifsc: str
    account_last4: str
    status: str
    is_default: bool
    verified_at: datetime | None
    failure_reason: str | None
    name_match_score: float | None

    @classmethod
    def from_model(cls, account: BankAccount) -> BankAccountResponse:
        return cls(
            id=account.id,
            holder_name=account.holder_name,
            bank_name=account.bank_name,
            branch=account.branch,
            ifsc=account.ifsc,
            account_last4=account.account_last4,
            status=account.status.value,
            is_default=account.is_default,
            verified_at=account.verified_at,
            failure_reason=account.failure_reason,
            name_match_score=(
                float(account.name_match_score)
                if account.name_match_score is not None
                else None
            ),
        )


class UpiAccountCreateRequest(BaseModel):
    vpa: str = Field(min_length=4, max_length=120)
    holder_name: str = Field(min_length=2, max_length=120)

    @field_validator("vpa")
    @classmethod
    def _lower(cls, value: str) -> str:
        return value.strip().lower()


class UpiAccountResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    vpa: str
    holder_name: str
    status: str
    is_default: bool
    verified_at: datetime | None
    failure_reason: str | None
    name_match_score: float | None

    @classmethod
    def from_model(cls, account: UpiAccount) -> UpiAccountResponse:
        return cls(
            id=account.id,
            vpa=account.vpa,
            holder_name=account.holder_name,
            status=account.status.value,
            is_default=account.is_default,
            verified_at=account.verified_at,
            failure_reason=account.failure_reason,
            name_match_score=(
                float(account.name_match_score)
                if account.name_match_score is not None
                else None
            ),
        )


class TopUpStartRequest(BaseModel):
    amount: Decimal = Field(gt=0, le=Decimal("200000"))


class UpiTargetResponse(BaseModel):
    key: str
    label: str
    package: str
    url: str


class PaymentIntentResponse(BaseModel):
    id: uuid.UUID
    amount: Decimal
    currency: str
    status: str
    reference: str
    provider_order_id: str | None
    razorpay_key_id: str | None
    upi_targets: list[UpiTargetResponse]
    note: str


class PaymentIntentStatusResponse(BaseModel):
    id: uuid.UUID
    status: str
    amount: Decimal
    reference: str
    failure_reason: str | None
    credited: bool
    """True only once the credit has actually posted to the ledger."""


class PayoutRequestBody(BaseModel):
    """Exactly one destination, enforced here as well as in the database."""

    amount: Decimal = Field(gt=0)
    bank_account_id: uuid.UUID | None = None
    upi_account_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _one_destination(self) -> PayoutRequestBody:
        if bool(self.bank_account_id) == bool(self.upi_account_id):
            raise ValueError(
                "Choose exactly one destination: a bank account or a UPI ID."
            )
        return self


class PayoutResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    amount: Decimal
    currency: str
    status: str
    reference: str
    bank_account_id: uuid.UUID | None
    upi_account_id: uuid.UUID | None
    destination: str
    """A short human label, so history does not need a second lookup."""

    failure_reason: str | None
    created_at: datetime
    completed_at: datetime | None

    @classmethod
    def from_model(cls, request: PayoutRequest) -> PayoutResponse:
        return cls(
            id=request.id,
            amount=request.amount,
            currency=request.currency,
            status=request.status.value,
            reference=request.reference,
            bank_account_id=request.bank_account_id,
            upi_account_id=request.upi_account_id,
            destination="upi" if request.upi_account_id else "bank",
            failure_reason=request.failure_reason,
            created_at=request.created_at,
            completed_at=request.completed_at,
        )


class GoogleSignInRequest(BaseModel):
    id_token: str = Field(min_length=32)
