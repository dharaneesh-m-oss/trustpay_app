"""Cancellation endpoints.

The OTP is never returned by any of these endpoints in production. While
DEMO_MODE is on, `demo_code` is populated so a demonstration can be driven
without an SMS gateway — and it is labelled as such in the response so nobody
mistakes it for production behaviour.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_active_user, get_request_context
from app.cancellation import service as cancellation
from app.cancellation.constants import OTP_LENGTH
from app.cancellation.model import CancellationRequest
from app.config.settings import settings
from app.core.context import RequestContext
from app.dependencies.database import get_db
from app.users.model import User

router = APIRouter(prefix="/cancellations", tags=["Cancellation"])


class RequestCancellationBody(BaseModel):
    milestone_id: uuid.UUID
    reason: str = Field(min_length=3, max_length=2000)


class VerifyOtpBody(BaseModel):
    code: str = Field(min_length=OTP_LENGTH, max_length=OTP_LENGTH, pattern=r"^\d+$")


class DeclineBody(BaseModel):
    reason: str | None = Field(default=None, max_length=2000)


class CancellationResponse(BaseModel):
    id: uuid.UUID
    milestone_id: uuid.UUID
    project_id: uuid.UUID
    status: str
    reason: str
    requested_by_id: uuid.UUID
    counterparty_id: uuid.UUID
    decline_reason: str | None = None

    #: Masked, e.g. "+91******3210". Never the full destination.
    code_sent_to: str | None = None

    #: DEMO_MODE only. Always null in production.
    demo_code: str | None = None
    demo_mode: bool = False


def _to_response(
    request: CancellationRequest, *, demo_code: str | None = None
) -> CancellationResponse:
    latest = request.verifications[-1] if request.verifications else None
    return CancellationResponse(
        id=request.id,
        milestone_id=request.milestone_id,
        project_id=request.project_id,
        status=str(request.status),
        reason=request.reason,
        requested_by_id=request.requested_by_id,
        counterparty_id=request.counterparty_id,
        decline_reason=request.decline_reason,
        code_sent_to=latest.delivered_to if latest else None,
        demo_code=demo_code,
        demo_mode=settings.DEMO_MODE,
    )


@router.post(
    "",
    response_model=CancellationResponse,
    summary="Request cancellation of a funded milestone (client)",
)
def request_cancellation(
    payload: RequestCancellationBody,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
) -> CancellationResponse:
    request, code = cancellation.request_cancellation(
        db,
        payload.milestone_id,
        current_user,
        reason=payload.reason,
        context=context,
    )
    # The requester is the client. Even in DEMO_MODE they do not get the code —
    # handing it to them would defeat the entire protection.
    return _to_response(request, demo_code=None)


@router.get(
    "/{request_id}",
    response_model=CancellationResponse,
    summary="Cancellation request detail",
)
def get_request(
    request_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> CancellationResponse:
    request = cancellation.get_request(db, request_id)
    if current_user.id not in (request.requested_by_id, request.counterparty_id):
        from app.cancellation.exceptions import NotTheVerifierError

        raise NotTheVerifierError()

    # The code cannot be shown here even in DEMO_MODE: only its hash is stored,
    # so nothing in the system can read it back. The receiver gets it through
    # their notification feed, which stands in for the SMS channel.
    return _to_response(request)


@router.post(
    "/{request_id}/verify",
    response_model=CancellationResponse,
    summary="Verify the code and confirm cancellation (receiver only)",
)
def verify(
    request_id: uuid.UUID,
    payload: VerifyOtpBody,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
) -> CancellationResponse:
    request = cancellation.verify_cancellation(
        db, request_id, current_user, payload.code, context=context
    )
    return _to_response(request)


@router.post(
    "/{request_id}/decline",
    response_model=CancellationResponse,
    summary="Decline the cancellation (receiver only)",
)
def decline(
    request_id: uuid.UUID,
    payload: DeclineBody,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
) -> CancellationResponse:
    request = cancellation.decline_cancellation(
        db, request_id, current_user, reason=payload.reason, context=context
    )
    return _to_response(request)


@router.post(
    "/{request_id}/resend",
    response_model=CancellationResponse,
    summary="Send a fresh code (receiver only)",
)
def resend(
    request_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
) -> CancellationResponse:
    code = cancellation.resend_code(db, request_id, current_user, context)
    request = cancellation.get_request(db, request_id)
    return _to_response(request, demo_code=code)
