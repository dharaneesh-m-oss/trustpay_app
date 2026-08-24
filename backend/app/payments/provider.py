"""The payment provider.

Razorpay, because it is the usual choice for UPI collection and IMPS payouts in
India, and because its webhook and payout APIs are plain HTTP - no SDK needed.

Everything here is real code against the real API. What it needs is credentials,
and those cannot be generated: a payment aggregator account requires a
registered business, PAN, GST where applicable, and KYC against a settlement
bank account. Until `RAZORPAY_KEY_ID` and friends are set, `configured()` is
False and the service layer refuses to move real money rather than pretending.

The one piece worth reading closely is `verify_webhook_signature`. It is the
only thing standing between "a payment was confirmed" and "somebody posted JSON
to our webhook URL". Everything else is bookkeeping.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import httpx

from app.config.settings import settings

logger = logging.getLogger(__name__)

API_BASE = "https://api.razorpay.com/v1"


class ProviderError(Exception):
    """The provider refused, or could not be reached."""

    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.message = message
        self.retryable = retryable


class ProviderNotConfigured(ProviderError):
    def __init__(self) -> None:
        super().__init__(
            "Live payments are not switched on for this deployment. "
            "Add the payment provider credentials to enable them."
        )


def configured() -> bool:
    """Whether real money can move at all."""
    return bool(settings.RAZORPAY_KEY_ID and settings.RAZORPAY_KEY_SECRET)


def payouts_configured() -> bool:
    """Payouts need a funding account on top of the collection credentials."""
    return configured() and bool(settings.RAZORPAY_PAYOUT_ACCOUNT)


def _auth() -> tuple[str, str]:
    return (settings.RAZORPAY_KEY_ID or "", settings.RAZORPAY_KEY_SECRET or "")


def to_paise(amount: Decimal) -> int:
    """Providers speak in the smallest unit. Rounding here, once, on purpose."""
    return int((amount * 100).to_integral_value())


def from_paise(paise: int) -> Decimal:
    return (Decimal(paise) / Decimal(100)).quantize(Decimal("0.01"))


@dataclass(frozen=True)
class ProviderOrder:
    order_id: str
    amount: Decimal
    currency: str
    raw: dict[str, Any]


async def create_order(
    *,
    amount: Decimal,
    reference: str,
    notes: dict[str, str] | None = None,
    timeout: float = 15.0,
) -> ProviderOrder:
    """Ask the provider for an order the app can pay against."""
    if not configured():
        raise ProviderNotConfigured()

    payload = {
        "amount": to_paise(amount),
        "currency": "INR",
        "receipt": reference,
        "notes": notes or {},
        # Without this the order can be paid more than once, which turns a
        # double-tap into a double credit.
        "payment_capture": 1,
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                f"{API_BASE}/orders", json=payload, auth=_auth()
            )
    except httpx.HTTPError as exc:
        raise ProviderError(
            "Could not reach the payment provider.", retryable=True
        ) from exc

    if response.status_code >= 500:
        raise ProviderError("The payment provider is having trouble.", retryable=True)
    if response.status_code >= 400:
        detail = _error_detail(response)
        logger.warning("razorpay_order_rejected status=%s detail=%s", response.status_code, detail)
        raise ProviderError(detail)

    body = response.json()
    return ProviderOrder(
        order_id=body["id"],
        amount=from_paise(body["amount"]),
        currency=body.get("currency", "INR"),
        raw=body,
    )


def verify_webhook_signature(raw_body: bytes, signature: str) -> bool:
    """Is this webhook actually from the provider?

    HMAC-SHA256 over the *raw* request body with the webhook secret. Two details
    matter and are easy to get wrong:

      - It must be the exact bytes received. Re-serialising the parsed JSON
        changes whitespace and key order, and the signature stops matching.
      - The comparison must be constant time. A byte-by-byte early exit leaks
        how much of a forged signature was correct, which is enough to forge one
        given patience.

    Without this check, anyone who learns the webhook URL can credit themselves
    any balance they like.
    """
    secret = settings.RAZORPAY_WEBHOOK_SECRET
    if not secret:
        logger.error("razorpay_webhook_secret_missing")
        return False

    expected = hmac.new(
        secret.encode("utf-8"), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, (signature or "").strip())


def verify_payment_signature(
    *, order_id: str, payment_id: str, signature: str
) -> bool:
    """The checkout callback's own signature, over order|payment."""
    secret = settings.RAZORPAY_KEY_SECRET
    if not secret:
        return False
    expected = hmac.new(
        secret.encode("utf-8"),
        f"{order_id}|{payment_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, (signature or "").strip())


@dataclass(frozen=True)
class ProviderPayout:
    payout_id: str
    status: str
    raw: dict[str, Any]


async def create_upi_payout(
    *,
    amount: Decimal,
    vpa: str,
    beneficiary_name: str,
    reference: str,
    timeout: float = 20.0,
) -> ProviderPayout:
    """Send money to a UPI ID.

    Same two-step shape as a bank payout: queued here, terminal state by
    webhook. UPI settles in seconds rather than minutes, which changes how long
    the wait feels and not what the code may assume.
    """
    if not payouts_configured():
        raise ProviderNotConfigured()

    payload = {
        "account_number": settings.RAZORPAY_PAYOUT_ACCOUNT,
        "amount": to_paise(amount),
        "currency": "INR",
        "mode": "UPI",
        "purpose": "payout",
        "queue_if_low_balance": True,
        "reference_id": reference,
        "narration": "TrustPay withdrawal",
        "fund_account": {
            "account_type": "vpa",
            "vpa": {"address": vpa},
            "contact": {"name": beneficiary_name, "type": "customer"},
        },
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                "https://api.razorpay.com/v1/payouts",
                json=payload,
                auth=_auth(),
                headers={"X-Payout-Idempotency": reference},
            )
    except httpx.HTTPError as exc:
        raise ProviderError(
            "Could not reach the payout provider.", retryable=True
        ) from exc

    if response.status_code >= 500:
        raise ProviderError("The payout provider is having trouble.", retryable=True)
    if response.status_code >= 400:
        raise ProviderError(_error_detail(response))

    body = response.json()
    return ProviderPayout(
        payout_id=body["id"], status=body.get("status", "processing"), raw=body
    )


async def create_payout(
    *,
    amount: Decimal,
    account_number: str,
    ifsc: str,
    beneficiary_name: str,
    reference: str,
    mode: str = "IMPS",
    timeout: float = 20.0,
) -> ProviderPayout:
    """Send money to a bank account.

    Deliberately a two-step create-then-confirm at the provider: the payout is
    queued and its terminal state arrives by webhook. A payout that returns
    "processing" is not a payout that has landed, and the ledger only settles
    when the provider says `processed`.
    """
    if not payouts_configured():
        raise ProviderNotConfigured()

    payload = {
        "account_number": settings.RAZORPAY_PAYOUT_ACCOUNT,
        "amount": to_paise(amount),
        "currency": "INR",
        "mode": mode,
        "purpose": "payout",
        "queue_if_low_balance": True,
        "reference_id": reference,
        "narration": "TrustPay withdrawal",
        "fund_account": {
            "account_type": "bank_account",
            "bank_account": {
                "name": beneficiary_name,
                "ifsc": ifsc,
                "account_number": account_number,
            },
        },
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                "https://api.razorpay.com/v1/payouts",
                json=payload,
                auth=_auth(),
                headers={"X-Payout-Idempotency": reference},
            )
    except httpx.HTTPError as exc:
        raise ProviderError(
            "Could not reach the payout provider.", retryable=True
        ) from exc

    if response.status_code >= 500:
        raise ProviderError("The payout provider is having trouble.", retryable=True)
    if response.status_code >= 400:
        raise ProviderError(_error_detail(response))

    body = response.json()
    return ProviderPayout(
        payout_id=body["id"], status=body.get("status", "processing"), raw=body
    )


async def validate_vpa(
    *, vpa: str, name: str, timeout: float = 20.0
) -> dict[str, Any]:
    """Check a UPI ID exists and learn the name registered against it.

    The UPI equivalent of a penny drop, and cheaper: the provider queries the
    UPI directory rather than moving a rupee, so this costs a fraction and
    returns the registered name directly.
    """
    if not payouts_configured():
        raise ProviderNotConfigured()

    payload = {
        "account_number": settings.RAZORPAY_PAYOUT_ACCOUNT,
        "fund_account": {
            "account_type": "vpa",
            "vpa": {"address": vpa},
            "contact": {"name": name, "type": "customer"},
        },
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                "https://api.razorpay.com/v1/fund_accounts/validations",
                json=payload,
                auth=_auth(),
            )
    except httpx.HTTPError as exc:
        raise ProviderError("Could not reach the provider.", retryable=True) from exc

    if response.status_code >= 400:
        raise ProviderError(_error_detail(response))

    return response.json()


async def penny_drop(
    *, account_number: str, ifsc: str, name: str, timeout: float = 20.0
) -> dict[str, Any]:
    """Prove the account exists and learn whose name is on it.

    A one-rupee validated transfer: the provider returns the registered account
    holder, which is the only way to establish ownership rather than plausibility.
    Costs a small fee per call, which is why it runs once when an account is
    added and not on every withdrawal.
    """
    if not payouts_configured():
        raise ProviderNotConfigured()

    payload = {
        "account_number": settings.RAZORPAY_PAYOUT_ACCOUNT,
        "fund_account": {
            "account_type": "bank_account",
            "bank_account": {
                "name": name,
                "ifsc": ifsc,
                "account_number": account_number,
            },
        },
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                "https://api.razorpay.com/v1/fund_accounts/validations",
                json=payload,
                auth=_auth(),
            )
    except httpx.HTTPError as exc:
        raise ProviderError("Could not reach the provider.", retryable=True) from exc

    if response.status_code >= 400:
        raise ProviderError(_error_detail(response))

    return response.json()


def _error_detail(response: httpx.Response) -> str:
    try:
        body = response.json()
        return (
            body.get("error", {}).get("description")
            or body.get("message")
            or "The payment provider rejected that request."
        )
    except (ValueError, json.JSONDecodeError):
        return "The payment provider rejected that request."
