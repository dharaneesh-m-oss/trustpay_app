"""Payment endpoints.

The webhook is the security-critical one. It is unauthenticated by necessity -
the provider cannot hold a user session - so its only defence is the signature
over the raw body. Everything it can do (credit a wallet, settle a payout) is
gated behind that check passing.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, Header, Request, status
from sqlalchemy.orm import Session

from app.config.settings import settings
from app.core.context import RequestContext
from app.core.logging import get_logger
from app.auth.dependencies import get_current_user, get_request_context
from app.dependencies.database import get_db
from app.payments import provider, service, verification
from app.payments.exceptions import VerificationFailedError
from app.payments.schema import (
    BankAccountCreateRequest,
    BankAccountResponse,
    IfscLookupResponse,
    PaymentIntentResponse,
    PaymentIntentStatusResponse,
    PaymentsStatusResponse,
    PayoutRequestBody,
    PayoutResponse,
    TopUpStartRequest,
    UpiTargetResponse,
)
from app.users.model import User

logger = get_logger(__name__)

router = APIRouter(prefix="/payments", tags=["Payments"])


@router.get(
    "/status",
    response_model=PaymentsStatusResponse,
    summary="What this deployment can actually do",
)
def payments_status() -> PaymentsStatusResponse:
    """Let the app show the truth rather than a button that cannot work."""
    return PaymentsStatusResponse(
        collections_enabled=provider.configured(),
        payouts_enabled=provider.payouts_configured(),
        google_sign_in_enabled=settings.google_configured,
        merchant_vpa=settings.MERCHANT_VPA,
        minimum_payout=settings.MIN_PAYOUT_AMOUNT,
        daily_payout_limit=settings.PAYOUT_DAILY_LIMIT,
        note=(
            "Live payments are active."
            if provider.configured()
            else "This deployment has no payment provider credentials, so real "
            "money cannot move. Everything else works."
        ),
    )


@router.get(
    "/ifsc/{ifsc}",
    response_model=IfscLookupResponse,
    summary="Look up a bank branch by IFSC",
)
async def lookup_ifsc(ifsc: str) -> IfscLookupResponse:
    """Real lookup against the public registry, so a typo is caught in the form."""
    try:
        details = await verification.lookup_ifsc(ifsc)
    except verification.VerificationError as exc:
        raise VerificationFailedError(exc.message) from exc

    return IfscLookupResponse(
        ifsc=details.ifsc,
        bank=details.bank,
        branch=details.branch,
        city=details.city,
        state=details.state,
        supports_imps=details.supports_imps,
        supports_neft=details.supports_neft,
    )


@router.get(
    "/bank-accounts",
    response_model=list[BankAccountResponse],
    summary="Bank accounts on this profile",
)
def list_bank_accounts(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[BankAccountResponse]:
    return [
        BankAccountResponse.from_model(account)
        for account in service.list_bank_accounts(db, user)
    ]


@router.post(
    "/bank-accounts",
    response_model=BankAccountResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a bank account for withdrawals",
)
async def add_bank_account(
    payload: BankAccountCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    context: RequestContext = Depends(get_request_context),
) -> BankAccountResponse:
    try:
        account = await service.add_bank_account(
            db,
            user,
            account_number=payload.account_number,
            ifsc=payload.ifsc,
            holder_name=payload.holder_name,
            context=context,
        )
    except verification.VerificationError as exc:
        raise VerificationFailedError(exc.message) from exc

    return BankAccountResponse.from_model(account)


@router.post(
    "/top-up",
    response_model=PaymentIntentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Start adding money by UPI",
)
async def start_top_up(
    payload: TopUpStartRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    context: RequestContext = Depends(get_request_context),
) -> PaymentIntentResponse:
    """Returns UPI links to open. Nothing is credited until the provider says so."""
    intent, targets = await service.start_top_up(
        db, user, payload.amount, context=context
    )

    return PaymentIntentResponse(
        id=intent.id,
        amount=intent.amount,
        currency=intent.currency,
        status=intent.status.value,
        reference=intent.reference,
        provider_order_id=intent.provider_order_id,
        razorpay_key_id=settings.RAZORPAY_KEY_ID,
        upi_targets=[
            UpiTargetResponse(
                key=target.key,
                label=target.label,
                package=target.package,
                url=target.url,
            )
            for target in targets
        ],
        note=(
            "Your wallet updates when the payment is confirmed by the bank, "
            "usually within a few seconds."
        ),
    )


@router.get(
    "/top-up/{intent_id}",
    response_model=PaymentIntentStatusResponse,
    summary="Whether a UPI payment has been confirmed",
)
def top_up_status(
    intent_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PaymentIntentStatusResponse:
    """The app polls this after opening a UPI app.

    It has to: Android tells the app the user came back, never whether they
    paid. Only the provider's signed webhook can move this to SUCCEEDED, so this
    is the one honest way for a screen to learn the outcome.
    """
    intent = service.get_intent(db, user, intent_id)
    return PaymentIntentStatusResponse(
        id=intent.id,
        status=intent.status.value,
        amount=intent.amount,
        reference=intent.reference,
        failure_reason=intent.failure_reason,
        credited=intent.ledger_transaction_id is not None,
    )


@router.post(
    "/payouts",
    response_model=PayoutResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Withdraw to a verified bank account",
)
async def create_payout(
    payload: PayoutRequestBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    context: RequestContext = Depends(get_request_context),
) -> PayoutResponse:
    request = await service.request_payout(
        db, user, payload.amount, payload.bank_account_id, context=context
    )
    return PayoutResponse.from_model(request)


@router.get(
    "/payouts",
    response_model=list[PayoutResponse],
    summary="Withdrawal history",
)
def list_payouts(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[PayoutResponse]:
    return [PayoutResponse.from_model(row) for row in service.list_payouts(db, user)]


@router.post(
    "/webhook",
    status_code=status.HTTP_200_OK,
    summary="Provider callback",
    include_in_schema=False,
)
async def webhook(
    request: Request,
    db: Session = Depends(get_db),
    x_razorpay_signature: str = Header(default=""),
) -> dict[str, str]:
    """The only path that credits a wallet.

    Returns 200 even for events we ignore: a provider that receives a non-2xx
    retries, and retrying an event we deliberately skipped is noise. Anything
    that fails the signature check gets a 200 too - telling an attacker their
    forgery was detected is not useful to them, and an error would only teach
    them the endpoint is real.
    """
    raw = await request.body()

    if not provider.verify_webhook_signature(raw, x_razorpay_signature):
        logger.warning("webhook_signature_rejected bytes=%d", len(raw))
        return {"status": "ignored"}

    payload = await request.json()
    event = payload.get("event", "")
    entities = payload.get("payload", {})

    if event in ("payment.captured", "order.paid"):
        payment = entities.get("payment", {}).get("entity", {})
        order_id = payment.get("order_id")
        if order_id:
            service.confirm_top_up(
                db,
                provider_order_id=order_id,
                provider_payment_id=payment.get("id", ""),
                amount_paise=int(payment.get("amount", 0)),
                payload=payment,
            )

    elif event == "payment.failed":
        payment = entities.get("payment", {}).get("entity", {})
        order_id = payment.get("order_id")
        if order_id:
            service.fail_top_up(
                db,
                provider_order_id=order_id,
                reason=payment.get("error_description") or "The payment failed.",
                payload=payment,
            )

    elif event == "payout.processed":
        payout = entities.get("payout", {}).get("entity", {})
        service.settle_payout(
            db, provider_payout_id=payout.get("id", ""), payload=payout
        )

    elif event in ("payout.failed", "payout.reversed"):
        payout = entities.get("payout", {}).get("entity", {})
        from sqlalchemy import select

        from app.payments.model import PayoutRequest

        found = db.scalar(
            select(PayoutRequest).where(
                PayoutRequest.provider_payout_id == payout.get("id", "")
            )
        )
        if found is not None:
            service.reverse_payout(
                db,
                found,
                reason=payout.get("failure_reason") or "The bank returned this payout.",
            )

    return {"status": "ok"}
