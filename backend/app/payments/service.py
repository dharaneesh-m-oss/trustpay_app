"""Payments: money in by UPI, money out to a bank account.

The rules that matter, and why each exists:

  - **A wallet is credited only by a provider-confirmed webhook.** Never by the
    app reporting success, never by a user returning from a UPI app. The paying
    app tells *itself* the payment worked; anyone can come back and claim it did.
  - **A credit posts at most once.** `PaymentIntent.ledger_transaction_id` is set
    inside the same transaction that posts the credit, and a webhook that finds
    it already set does nothing. Providers retry webhooks; without this, a retry
    is free money.
  - **A payout debits immediately and refunds on failure.** Holding the balance
    until the bank confirms would let someone withdraw the same money twice
    while the first payout is in flight.
  - **Payouts go only to a verified account whose name matches.** The name check
    is what stops a payout being routed to somebody else's bank account.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import service as audit
from app.config.settings import settings
from app.core.constants import AuditAction
from app.core.context import RequestContext
from app.core.logging import get_logger
from app.payments import provider, upi, verification
from app.payments.exceptions import (
    AccountNotVerifiedError,
    BankAccountNotFoundError,
    DuplicateBankAccountError,
    PaymentIntentNotFoundError,
    PaymentsNotEnabledError,
    PayoutLimitError,
    PayoutTooSmallError,
)
from app.payments.model import (
    BankAccount,
    BankAccountStatus,
    PaymentIntent,
    PaymentIntentStatus,
    PayoutRequest,
    PayoutStatus,
)
from app.users.model import User
from app.wallet import service as wallet_service

logger = get_logger(__name__)


def _now() -> datetime:
    return datetime.now(UTC)


# --------------------------------------------------------------- encryption

def _key() -> bytes:
    """A stable 32-byte key derived from the app secret.

    Deriving rather than adding another secret to configure: the account number
    is only encrypted so a database dump is not a list of bank accounts. It is
    not protecting against someone who already has the application's secret,
    because such a person can issue tokens for any user anyway.
    """
    return hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()


def _encrypt_account(account_number: str) -> str:
    """XOR-with-keystream plus an HMAC tag.

    Deliberately not rolling a cipher: the keystream is HMAC-SHA256 in counter
    mode, which is a standard construction, and the tag makes tampering
    detectable. If this project ever holds real account numbers at scale, this
    should be replaced with a KMS-backed envelope encryption - noted here rather
    than left for someone to discover.
    """
    key = _key()
    data = account_number.encode("utf-8")
    stream = b""
    counter = 0
    while len(stream) < len(data):
        stream += hmac.new(key, counter.to_bytes(4, "big"), hashlib.sha256).digest()
        counter += 1
    cipher = bytes(a ^ b for a, b in zip(data, stream))
    tag = hmac.new(key, cipher, hashlib.sha256).digest()[:16]
    return base64.b64encode(tag + cipher).decode("ascii")


def _decrypt_account(blob: str) -> str:
    key = _key()
    raw = base64.b64decode(blob)
    tag, cipher = raw[:16], raw[16:]
    expected = hmac.new(key, cipher, hashlib.sha256).digest()[:16]
    if not hmac.compare_digest(tag, expected):
        raise ValueError("Stored account number failed its integrity check.")
    stream = b""
    counter = 0
    while len(stream) < len(cipher):
        stream += hmac.new(key, counter.to_bytes(4, "big"), hashlib.sha256).digest()
        counter += 1
    return bytes(a ^ b for a, b in zip(cipher, stream)).decode("utf-8")


def _account_fingerprint(ifsc: str, account_number: str) -> str:
    return hashlib.sha256(
        (settings.SECRET_KEY + "|" + ifsc + "|" + account_number).encode("utf-8")
    ).hexdigest()


# ------------------------------------------------------------ bank accounts

async def add_bank_account(
    db: Session,
    user: User,
    *,
    account_number: str,
    ifsc: str,
    holder_name: str,
    context: RequestContext | None = None,
) -> BankAccount:
    """Validate, verify against the bank registry, and store."""
    context = context or RequestContext()

    number = verification.normalise_account_number(account_number)
    code = verification.normalise_ifsc(ifsc)

    # Real lookup: turns eleven plausible characters into a named branch.
    details = await verification.lookup_ifsc(code)

    match = verification.match_names(user.full_name, holder_name)
    if not match.matched:
        raise AccountNotVerifiedError(match.reason)

    fingerprint = _account_fingerprint(code, number)

    existing = db.scalar(
        select(BankAccount).where(
            BankAccount.user_id == user.id,
            BankAccount.account_hash == fingerprint,
        )
    )
    if existing is not None:
        raise DuplicateBankAccountError()

    account = BankAccount(
        user_id=user.id,
        holder_name=holder_name.strip(),
        ifsc=code,
        bank_name=details.bank,
        branch=details.branch,
        account_last4=number[-4:],
        account_hash=fingerprint,
        account_encrypted=_encrypt_account(number),
        name_match_score=Decimal(str(match.score)),
        status=BankAccountStatus.PENDING,
    )

    # Ownership is only ever established by a penny drop. Without a payout
    # provider the account stays PENDING, and `request_payout` refuses it - the
    # alternative is calling an unverified account "verified", which is the one
    # lie that would actually cost someone money.
    if provider.payouts_configured():
        try:
            result = await provider.penny_drop(
                account_number=number, ifsc=code, name=holder_name
            )
            registered = (
                result.get("results", {}).get("registered_name")
                or result.get("bank_account", {}).get("name")
                or ""
            )
            bank_match = verification.match_names(user.full_name, registered)
            if bank_match.matched:
                account.status = BankAccountStatus.VERIFIED
                account.verified_at = _now()
                account.name_match_score = Decimal(str(bank_match.score))
                account.provider_fund_account_id = result.get("fund_account", {}).get("id")
            else:
                account.status = BankAccountStatus.REJECTED
                account.failure_reason = (
                    "The bank has this account in the name "
                    f"'{registered}', which is not yours."
                )
        except provider.ProviderError as exc:
            account.status = BankAccountStatus.PENDING
            account.failure_reason = exc.message

    if not db.scalar(
        select(BankAccount).where(
            BankAccount.user_id == user.id, BankAccount.is_default.is_(True)
        )
    ):
        account.is_default = True

    db.add(account)

    audit.record(
        db,
        action=(
            AuditAction.BANK_ACCOUNT_VERIFIED
            if account.status is BankAccountStatus.VERIFIED
            else AuditAction.BANK_ACCOUNT_ADDED
        ),
        actor_user_id=user.id,
        entity_type="bank_account",
        entity_id=account.id,
        context={
            "bank": details.bank,
            "ifsc": code,
            "last4": number[-4:],
            "status": account.status.value,
        },
        ip_address=context.ip_address,
        user_agent=context.user_agent,
    )
    db.commit()
    db.refresh(account)
    return account


def list_bank_accounts(db: Session, user: User) -> list[BankAccount]:
    return list(
        db.scalars(
            select(BankAccount)
            .where(BankAccount.user_id == user.id)
            .order_by(BankAccount.is_default.desc(), BankAccount.created_at.desc())
        )
    )


# ------------------------------------------------------------- money coming in

async def start_top_up(
    db: Session,
    user: User,
    amount: Decimal,
    *,
    context: RequestContext | None = None,
) -> tuple[PaymentIntent, list[upi.UpiTarget]]:
    """Create an intent and the UPI links that pay it.

    Returns links, not a balance. Nothing is credited here.
    """
    context = context or RequestContext()

    if not provider.configured():
        raise PaymentsNotEnabledError()
    if amount <= 0:
        raise PayoutTooSmallError("Enter an amount greater than zero.")

    intent = PaymentIntent(
        user_id=user.id,
        amount=amount,
        currency=settings.DEFAULT_CURRENCY,
        status=PaymentIntentStatus.CREATED,
        reference="",
    )
    db.add(intent)
    db.flush()

    intent.reference = upi.transaction_reference(str(intent.id))

    order = await provider.create_order(
        amount=amount,
        reference=intent.reference,
        notes={"user_id": str(user.id), "intent_id": str(intent.id)},
    )
    intent.provider_order_id = order.order_id
    intent.status = PaymentIntentStatus.PENDING

    targets = upi.build_intent_urls(
        payee_vpa=settings.MERCHANT_VPA or "",
        payee_name=settings.MERCHANT_NAME,
        amount=amount,
        reference=intent.reference,
        note=f"TrustPay wallet {intent.reference}",
    )

    db.commit()
    db.refresh(intent)
    return intent, targets


def confirm_top_up(
    db: Session,
    *,
    provider_order_id: str,
    provider_payment_id: str,
    amount_paise: int,
    payload: dict | None = None,
) -> PaymentIntent | None:
    """Credit a wallet, once, on a verified provider confirmation.

    Called only from the webhook handler, after the signature has been checked.
    Returns None when there is nothing to do, which is the normal outcome of a
    provider retry.
    """
    intent = db.scalar(
        select(PaymentIntent)
        .where(PaymentIntent.provider_order_id == provider_order_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if intent is None:
        logger.warning("webhook_for_unknown_order order=%s", provider_order_id)
        return None

    if intent.ledger_transaction_id is not None:
        # Already credited. Providers retry; this is the guard that makes the
        # retry harmless rather than lucrative.
        return intent

    paid = provider.from_paise(amount_paise)
    if paid != intent.amount:
        # Never credit an amount we did not ask for. A UPI payer can edit the
        # amount in some apps, and crediting whatever arrived would let someone
        # pay 1 rupee against a 10,000 rupee intent.
        intent.status = PaymentIntentStatus.FAILED
        intent.failure_reason = (
            f"Paid {paid} against an intent for {intent.amount}."
        )
        intent.provider_payload = payload
        db.commit()
        logger.error(
            "payment_amount_mismatch intent=%s expected=%s paid=%s",
            intent.id, intent.amount, paid,
        )
        return intent

    user = db.get(User, intent.user_id)
    if user is None:
        return None

    transaction = wallet_service.top_up(
        db,
        user,
        intent.amount,
        idempotency_key=f"topup-{intent.id}",
        description="Added by UPI",
    )

    intent.ledger_transaction_id = transaction.id
    intent.provider_payment_id = provider_payment_id
    intent.status = PaymentIntentStatus.SUCCEEDED
    intent.completed_at = _now()
    intent.provider_payload = payload
    db.commit()

    logger.info(
        "top_up_confirmed intent=%s user=%s amount=%s",
        intent.id, user.id, intent.amount,
    )
    return intent


def fail_top_up(
    db: Session, *, provider_order_id: str, reason: str, payload: dict | None = None
) -> None:
    intent = db.scalar(
        select(PaymentIntent).where(
            PaymentIntent.provider_order_id == provider_order_id
        )
    )
    if intent is None or intent.ledger_transaction_id is not None:
        return
    intent.status = PaymentIntentStatus.FAILED
    intent.failure_reason = reason[:255]
    intent.provider_payload = payload
    db.commit()


# -------------------------------------------------------------- money going out

async def request_payout(
    db: Session,
    user: User,
    amount: Decimal,
    bank_account_id,
    *,
    context: RequestContext | None = None,
) -> PayoutRequest:
    """Withdraw to a verified bank account.

    The debit is posted before the provider is called. If the payout is rejected
    the debit is reversed. The other order - call first, debit after - leaves a
    window where the balance still looks spendable while the money is already
    leaving, and that window is long enough to spend it twice.
    """
    context = context or RequestContext()

    if not provider.payouts_configured():
        raise PaymentsNotEnabledError()

    if amount < settings.MIN_PAYOUT_AMOUNT:
        raise PayoutTooSmallError(
            f"The smallest withdrawal is {settings.MIN_PAYOUT_AMOUNT}."
        )

    account = db.scalar(
        select(BankAccount).where(
            BankAccount.id == bank_account_id, BankAccount.user_id == user.id
        )
    )
    if account is None:
        raise BankAccountNotFoundError()
    if account.status is not BankAccountStatus.VERIFIED:
        raise AccountNotVerifiedError(
            account.failure_reason
            or "This account has not been verified yet, so it cannot receive a payout."
        )

    today = _now().date()
    spent_today = sum(
        (row.amount for row in db.scalars(
            select(PayoutRequest).where(
                PayoutRequest.user_id == user.id,
                PayoutRequest.status != PayoutStatus.FAILED,
            )
        ) if row.created_at.date() == today),
        Decimal("0"),
    )
    if spent_today + amount > settings.PAYOUT_DAILY_LIMIT:
        raise PayoutLimitError(
            f"That would pass your daily withdrawal limit of "
            f"{settings.PAYOUT_DAILY_LIMIT}."
        )

    request = PayoutRequest(
        user_id=user.id,
        bank_account_id=account.id,
        amount=amount,
        currency=settings.DEFAULT_CURRENCY,
        status=PayoutStatus.REQUESTED,
        reference="",
    )
    db.add(request)
    db.flush()
    request.reference = upi.transaction_reference(str(request.id))

    # The ledger's own guard refuses this if available funds cannot cover it.
    transaction = wallet_service.withdraw(
        db,
        user,
        amount,
        idempotency_key=f"payout-{request.id}",
        description=f"Withdrawal to {account.bank_name} {account.account_last4}",
    )
    request.ledger_transaction_id = transaction.id
    db.commit()

    try:
        result = await provider.create_payout(
            amount=amount,
            account_number=_decrypt_account(account.account_encrypted),
            ifsc=account.ifsc,
            beneficiary_name=account.holder_name,
            reference=request.reference,
        )
        request.provider_payout_id = result.payout_id
        request.status = PayoutStatus.PROCESSING
        request.provider_payload = result.raw
        db.commit()
    except provider.ProviderError as exc:
        reverse_payout(db, request, reason=exc.message)
        raise

    db.refresh(request)
    return request


def reverse_payout(db: Session, request: PayoutRequest, *, reason: str) -> None:
    """Put the money back after a failed or reversed payout."""
    if request.status in (PayoutStatus.FAILED, PayoutStatus.REVERSED):
        return

    user = db.get(User, request.user_id)
    if user is not None and request.ledger_transaction_id is not None:
        wallet_service.top_up(
            db,
            user,
            request.amount,
            idempotency_key=f"payout-reversal-{request.id}",
            description="Withdrawal returned",
        )

    request.status = PayoutStatus.FAILED
    request.failure_reason = reason[:255]
    request.completed_at = _now()
    db.commit()
    logger.warning("payout_reversed request=%s reason=%s", request.id, reason)


def settle_payout(db: Session, *, provider_payout_id: str, payload: dict) -> None:
    request = db.scalar(
        select(PayoutRequest).where(
            PayoutRequest.provider_payout_id == provider_payout_id
        )
    )
    if request is None or request.status is PayoutStatus.PROCESSED:
        return
    request.status = PayoutStatus.PROCESSED
    request.completed_at = _now()
    request.provider_payload = payload
    db.commit()


def get_intent(db: Session, user: User, intent_id) -> PaymentIntent:
    """One user's own intent. Scoped by user so an id cannot be guessed into."""
    intent = db.scalar(
        select(PaymentIntent).where(
            PaymentIntent.id == intent_id, PaymentIntent.user_id == user.id
        )
    )
    if intent is None:
        raise PaymentIntentNotFoundError()
    return intent


def list_payouts(db: Session, user: User) -> list[PayoutRequest]:
    return list(
        db.scalars(
            select(PayoutRequest)
            .where(PayoutRequest.user_id == user.id)
            .order_by(PayoutRequest.created_at.desc())
        )
    )
