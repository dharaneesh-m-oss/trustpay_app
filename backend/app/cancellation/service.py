"""Cancellation with receiver verification (spec sections 15 and 16).

The property this module exists to guarantee:

    **The sender can never verify their own cancellation OTP.**

A client who funded a milestone cannot unilaterally pull the money back. They
raise a request; the receiver is notified and sent a code; only the
authenticated receiver can submit that code; and only a verified code releases
the refund. Every one of those steps is enforced server-side.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.audit import service as audit
from app.cancellation.constants import (
    OTP_MAX_ATTEMPTS,
    OTP_MAX_SENDS_PER_WINDOW,
    OTP_SEND_WINDOW_MINUTES,
    OTP_TTL_MINUTES,
    CancellationStatus,
    OtpPurpose,
    OtpStatus,
)
from app.cancellation.exceptions import (
    CancellationNotFoundError,
    CancellationNotPendingError,
    NotTheVerifierError,
    OtpExpiredError,
    OtpInvalidError,
    OtpRateLimitedError,
    OtpTooManyAttemptsError,
)
from app.cancellation.model import CancellationRequest, OtpVerification
from app.config.settings import settings
from app.core.context import RequestContext
from app.core.money import to_money
from app.ledger import service as ledger
from app.ledger.constants import AccountType, PostingDirection, TransactionType
from app.milestones import service as milestones
from app.milestones.constants import MilestoneStatus
from app.milestones.model import Milestone
from app.notifications import service as notifications
from app.notifications.constants import NotificationSeverity, NotificationType
from app.projects import service as projects
from app.security import otp as otp_security
from app.users.model import User


def _now() -> datetime:
    return datetime.now(UTC)


# ------------------------------------------------------------------- request


def request_cancellation(
    db: Session,
    milestone_id: uuid.UUID,
    requester: User,
    *,
    reason: str,
    context: RequestContext | None = None,
) -> tuple[CancellationRequest, str | None]:
    """Open a cancellation request and issue the receiver's code.

    Returns the request and — only while DEMO_MODE is on — the plaintext code,
    so a demo can be driven without an SMS gateway. In production this second
    value is None and the code exists solely inside the delivery channel.
    """
    context = context or RequestContext()

    milestone = milestones.get_milestone(db, milestone_id)
    project = milestone.project

    milestones.assert_client(project, requester)

    locked = milestones.get_milestone_for_update(db, milestone_id)
    milestones.assert_transition(locked.status, MilestoneStatus.CANCELLATION_REQUESTED)

    counterparty_id = project.receiver_id
    if counterparty_id is None:
        raise CancellationNotPendingError(
            "This milestone has no receiver to confirm a cancellation."
        )

    _assert_send_rate_limit(db, counterparty_id)

    request = CancellationRequest(
        milestone_id=locked.id,
        project_id=project.id,
        requested_by_id=requester.id,
        counterparty_id=counterparty_id,
        reason=reason.strip(),
        status=CancellationStatus.AWAITING_RECEIVER,
    )
    db.add(request)
    db.flush()

    # The funds stay protected while this is open — they are neither released
    # nor refunded until the receiver decides.
    milestones.transition(locked, MilestoneStatus.CANCELLATION_REQUESTED)

    receiver = db.get(User, counterparty_id)
    generated = otp_security.generate(OTP_TTL_MINUTES)

    db.add(
        OtpVerification(
            cancellation_request_id=request.id,
            user_id=counterparty_id,
            purpose=OtpPurpose.CANCELLATION,
            code_hash=generated.code_hash,
            delivered_to=otp_security.mask_destination(
                receiver.phone or receiver.email if receiver else None
            ),
            expires_at=generated.expires_at,
            max_attempts=OTP_MAX_ATTEMPTS,
        )
    )

    notifications.create(
        db,
        user_id=counterparty_id,
        notification_type=NotificationType.CANCELLATION_REQUESTED,
        title="Cancellation requested",
        body=(
            f"{requester.full_name} asked to cancel “{locked.title}”. "
            "Your verification is required."
        ),
        target={"screen": "cancellation", "id": str(request.id)},
        project_id=project.id,
        milestone_id=locked.id,
        severity=NotificationSeverity.CRITICAL,
    )

    _deliver_code(db, counterparty_id, request.id, generated.code)

    audit.record(
        db,
        action="CANCELLATION_REQUESTED",
        actor_user_id=requester.id,
        entity_type="cancellation_request",
        entity_id=request.id,
        # The code itself is never recorded, here or anywhere else.
        context={"milestone_id": str(locked.id), "amount": str(locked.amount)},
        ip_address=context.ip_address,
        user_agent=context.user_agent,
    )
    db.commit()
    db.refresh(request)

    return request, (generated.code if settings.DEMO_MODE else None)


def _deliver_code(
    db: Session, user_id: uuid.UUID, request_id: uuid.UUID, code: str
) -> None:
    """Send the code to the receiver.

    This is the seam where a real SMS or email gateway plugs in. Until one
    exists, DEMO_MODE delivers the code through the receiver's own notification
    feed — which keeps the security property intact: the code reaches the
    *receiver* and nobody else, and the client never sees it.

    In production this writes a notification telling the receiver a code was
    sent, and the code itself goes out through the gateway instead.
    """
    if settings.DEMO_MODE:
        body = (
            f"Your verification code is {code}. "
            "It expires in 10 minutes and can be used once. "
            "(Demo delivery — in production this arrives by SMS.)"
        )
    else:  # pragma: no cover - requires a configured gateway
        body = "A verification code has been sent to your registered contact."

    notifications.create(
        db,
        user_id=user_id,
        notification_type=NotificationType.OTP_SENT,
        title="Verification code",
        body=body,
        target={"screen": "cancellation", "id": str(request_id)},
        severity=NotificationSeverity.CRITICAL,
    )


def _assert_send_rate_limit(db: Session, user_id: uuid.UUID) -> None:
    """Cap how many codes one account can be sent in a window.

    Without this, a client could cancel and re-cancel to keep generating codes,
    widening the guessing surface and burying the receiver in messages.
    """
    since = _now() - timedelta(minutes=OTP_SEND_WINDOW_MINUTES)
    recent = int(
        db.scalar(
            select(func.count())
            .select_from(OtpVerification)
            .where(
                OtpVerification.user_id == user_id,
                OtpVerification.purpose == OtpPurpose.CANCELLATION,
                OtpVerification.created_at >= since,
            )
        )
        or 0
    )
    if recent >= OTP_MAX_SENDS_PER_WINDOW:
        raise OtpRateLimitedError()


# -------------------------------------------------------------------- verify


def get_request(db: Session, request_id: uuid.UUID) -> CancellationRequest:
    request = db.scalar(
        select(CancellationRequest)
        .where(CancellationRequest.id == request_id)
        .options(selectinload(CancellationRequest.verifications))
    )
    if request is None:
        raise CancellationNotFoundError()
    return request


def verify_cancellation(
    db: Session,
    request_id: uuid.UUID,
    verifier: User,
    code: str,
    *,
    context: RequestContext | None = None,
) -> CancellationRequest:
    """Confirm a cancellation and refund the protected funds.

    The authorisation check below is the single most important line in this
    module: only `counterparty_id` may verify. The client who requested the
    cancellation is refused even with the correct code — and they never receive
    it in the first place.
    """
    context = context or RequestContext()

    request = get_request(db, request_id)

    if request.counterparty_id != verifier.id:
        audit.record(
            db,
            action="CANCELLATION_OTP_UNAUTHORISED_ATTEMPT",
            actor_user_id=verifier.id,
            entity_type="cancellation_request",
            entity_id=request.id,
            ip_address=context.ip_address,
            user_agent=context.user_agent,
        )
        db.commit()
        raise NotTheVerifierError()

    if request.status != CancellationStatus.AWAITING_RECEIVER:
        raise CancellationNotPendingError()

    verification = _active_verification(db, request)
    now = _now()

    if verification is None:
        raise OtpExpiredError()

    if verification.attempts >= verification.max_attempts:
        verification.status = OtpStatus.INVALIDATED
        db.commit()
        raise OtpTooManyAttemptsError()

    if verification.expires_at <= now:
        verification.status = OtpStatus.EXPIRED
        db.commit()
        raise OtpExpiredError()

    # Count the attempt before checking, so a crash mid-verification cannot be
    # used to get a free guess.
    verification.attempts += 1

    if not otp_security.verify_code(code, verification.code_hash):
        remaining = max(verification.max_attempts - verification.attempts, 0)
        if remaining == 0:
            verification.status = OtpStatus.INVALIDATED
        audit.record(
            db,
            action="CANCELLATION_OTP_FAILED",
            actor_user_id=verifier.id,
            entity_type="cancellation_request",
            entity_id=request.id,
            context={"attempts_remaining": remaining},
            ip_address=context.ip_address,
            user_agent=context.user_agent,
        )
        db.commit()
        raise OtpInvalidError(
            f"That code is not correct. {remaining} attempt(s) remaining."
            if remaining
            else "That code is not correct, and no attempts remain."
        )

    # Single use: consumed the moment it succeeds.
    verification.status = OtpStatus.CONSUMED
    verification.consumed_at = now

    refund = _refund_milestone(db, request, verifier, context)

    request.status = CancellationStatus.CONFIRMED
    request.resolved_at = now
    request.refund_transaction_id = refund.id

    db.commit()
    db.refresh(request)
    return request


def _active_verification(
    db: Session, request: CancellationRequest
) -> OtpVerification | None:
    return db.scalar(
        select(OtpVerification)
        .where(
            OtpVerification.cancellation_request_id == request.id,
            OtpVerification.status == OtpStatus.ACTIVE,
        )
        .order_by(OtpVerification.created_at.desc())
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def _refund_milestone(
    db: Session,
    request: CancellationRequest,
    verifier: User,
    context: RequestContext,
):
    """Return protected funds to the client's available balance."""
    milestone = milestones.get_milestone_for_update(db, request.milestone_id)
    project = milestone.project

    protected = ledger.get_or_create_account(
        db,
        owner_user_id=project.client_id,
        account_type=AccountType.USER_PROTECTED,
        currency=milestone.currency,
    )
    available = ledger.get_or_create_account(
        db,
        owner_user_id=project.client_id,
        account_type=AccountType.USER_AVAILABLE,
        currency=milestone.currency,
    )

    amount = to_money(milestone.amount)

    transaction = ledger.post(
        db,
        transaction_type=TransactionType.REFUND,
        postings=[
            ledger.PostingRequest(
                account_id=protected.id,
                direction=PostingDirection.DEBIT,
                amount=amount,
            ),
            ledger.PostingRequest(
                account_id=available.id,
                direction=PostingDirection.CREDIT,
                amount=amount,
            ),
        ],
        description=f"Refund for cancelled milestone “{milestone.title}”",
        currency=milestone.currency,
        initiated_by_user_id=verifier.id,
        sender_user_id=project.client_id,
        receiver_user_id=project.client_id,
        project_id=project.id,
        milestone_id=milestone.id,
    )

    milestones.transition(milestone, MilestoneStatus.CANCELLED)
    projects.refresh_project_completion(db, project)

    notifications.create(
        db,
        user_id=project.client_id,
        notification_type=NotificationType.REFUND_ISSUED,
        title="Cancellation confirmed",
        body=(
            f"{verifier.full_name} confirmed the cancellation of “{milestone.title}”. "
            f"{milestone.currency} {amount:,.2f} is back in your available balance."
        ),
        target={"screen": "milestone", "id": str(milestone.id)},
        project_id=project.id,
        milestone_id=milestone.id,
        severity=NotificationSeverity.SUCCESS,
    )

    audit.record(
        db,
        action="CANCELLATION_CONFIRMED",
        actor_user_id=verifier.id,
        entity_type="cancellation_request",
        entity_id=request.id,
        context={"amount": str(amount), "transaction_id": str(transaction.id)},
        ip_address=context.ip_address,
        user_agent=context.user_agent,
    )
    return transaction


def decline_cancellation(
    db: Session,
    request_id: uuid.UUID,
    verifier: User,
    *,
    reason: str | None = None,
    context: RequestContext | None = None,
) -> CancellationRequest:
    """Receiver refuses. The funds stay protected and work continues."""
    context = context or RequestContext()

    request = get_request(db, request_id)

    if request.counterparty_id != verifier.id:
        raise NotTheVerifierError()
    if request.status != CancellationStatus.AWAITING_RECEIVER:
        raise CancellationNotPendingError()

    now = _now()
    request.status = CancellationStatus.DECLINED
    request.resolved_at = now
    request.decline_reason = (reason or "").strip() or None

    for verification in request.verifications:
        if verification.status == OtpStatus.ACTIVE:
            verification.status = OtpStatus.INVALIDATED

    milestone = milestones.get_milestone_for_update(db, request.milestone_id)
    milestones.transition(milestone, MilestoneStatus.FUNDED)

    notifications.create(
        db,
        user_id=request.requested_by_id,
        notification_type=NotificationType.CANCELLATION_DECLINED,
        title="Cancellation declined",
        body=(
            f"{verifier.full_name} declined the cancellation. "
            "The funds remain protected."
        ),
        target={"screen": "milestone", "id": str(milestone.id)},
        project_id=request.project_id,
        milestone_id=milestone.id,
        severity=NotificationSeverity.WARNING,
    )

    audit.record(
        db,
        action="CANCELLATION_DECLINED",
        actor_user_id=verifier.id,
        entity_type="cancellation_request",
        entity_id=request.id,
        ip_address=context.ip_address,
        user_agent=context.user_agent,
    )
    db.commit()
    db.refresh(request)
    return request


def resend_code(
    db: Session,
    request_id: uuid.UUID,
    verifier: User,
    context: RequestContext | None = None,
) -> str | None:
    """Issue a fresh code, invalidating the previous one.

    The old code stops working immediately — leaving both live would double an
    attacker's guessing budget.
    """
    context = context or RequestContext()
    request = get_request(db, request_id)

    if request.counterparty_id != verifier.id:
        raise NotTheVerifierError()
    if request.status != CancellationStatus.AWAITING_RECEIVER:
        raise CancellationNotPendingError()

    _assert_send_rate_limit(db, verifier.id)

    for verification in request.verifications:
        if verification.status == OtpStatus.ACTIVE:
            verification.status = OtpStatus.INVALIDATED

    generated = otp_security.generate(OTP_TTL_MINUTES)
    db.add(
        OtpVerification(
            cancellation_request_id=request.id,
            user_id=verifier.id,
            purpose=OtpPurpose.CANCELLATION,
            code_hash=generated.code_hash,
            delivered_to=otp_security.mask_destination(verifier.phone or verifier.email),
            expires_at=generated.expires_at,
            max_attempts=OTP_MAX_ATTEMPTS,
        )
    )

    _deliver_code(db, verifier.id, request.id, generated.code)

    audit.record(
        db,
        action="CANCELLATION_OTP_RESENT",
        actor_user_id=verifier.id,
        entity_type="cancellation_request",
        entity_id=request.id,
        ip_address=context.ip_address,
        user_agent=context.user_agent,
    )
    db.commit()
    return generated.code if settings.DEMO_MODE else None
