"""Dispute endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_active_user, require_admin
from app.core.context import RequestContext
from app.auth.dependencies import get_request_context
from app.dependencies.database import get_db
from app.disputes import service as disputes
from app.disputes.constants import DisputeOutcome, DisputeReason, DisputeStatus
from app.disputes.model import Dispute
from app.users.model import User

router = APIRouter(prefix="/disputes", tags=["Disputes"])


class RaiseDisputeBody(BaseModel):
    milestone_id: uuid.UUID
    reason: DisputeReason
    description: str = Field(min_length=10, max_length=4000)
    evidence: list[dict] = Field(default_factory=list, max_length=20)


class MessageBody(BaseModel):
    body: str = Field(min_length=3, max_length=4000)
    evidence: list[dict] = Field(default_factory=list, max_length=20)


class ResolveBody(BaseModel):
    outcome: DisputeOutcome
    note: str = Field(min_length=5, max_length=4000)
    #: Required for SPLIT; the receiver's share as a decimal string.
    split_to_receiver: str | None = None


class DisputeMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    author_id: uuid.UUID
    author_role: str
    body: str
    evidence: list
    created_at: datetime


class DisputeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    milestone_id: uuid.UUID
    project_id: uuid.UUID
    raised_by_id: uuid.UUID
    against_id: uuid.UUID
    reason: DisputeReason
    description: str
    status: DisputeStatus
    outcome: DisputeOutcome | None
    resolution_note: str | None
    resolved_at: datetime | None
    ai_summary: dict | None
    created_at: datetime
    messages: list[DisputeMessageResponse]


@router.post(
    "",
    response_model=DisputeResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Raise a dispute on a milestone",
)
def raise_dispute(
    payload: RaiseDisputeBody,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
) -> Dispute:
    return disputes.raise_dispute(
        db,
        payload.milestone_id,
        current_user,
        reason=payload.reason,
        description=payload.description,
        evidence=payload.evidence,
        context=context,
    )


@router.get("", response_model=list[DisputeResponse], summary="Your disputes")
def list_disputes(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> list[Dispute]:
    return disputes.list_for_user(db, current_user)


@router.get("/{dispute_id}", response_model=DisputeResponse, summary="Dispute detail")
def get_dispute(
    dispute_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> Dispute:
    dispute = disputes.get_dispute(db, dispute_id)
    if not current_user.is_admin and current_user.id not in (
        dispute.raised_by_id,
        dispute.against_id,
    ):
        from app.projects.exceptions import NotAProjectMemberError

        raise NotAProjectMemberError()
    return dispute


@router.post(
    "/{dispute_id}/messages",
    response_model=DisputeResponse,
    summary="Add your account of what happened",
)
def add_message(
    dispute_id: uuid.UUID,
    payload: MessageBody,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
) -> Dispute:
    return disputes.add_message(
        db,
        dispute_id,
        current_user,
        body=payload.body,
        evidence=payload.evidence,
        context=context,
    )


@router.post(
    "/{dispute_id}/ai-summary",
    summary="Generate an AI summary of both sides",
)
def ai_summary(
    dispute_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> dict:
    """Advisory. The summary never states an outcome — that is the admin's job."""
    dispute = disputes.get_dispute(db, dispute_id)
    if not current_user.is_admin and current_user.id not in (
        dispute.raised_by_id,
        dispute.against_id,
    ):
        from app.projects.exceptions import NotAProjectMemberError

        raise NotAProjectMemberError()
    return disputes.generate_ai_summary(db, dispute)


@router.post(
    "/{dispute_id}/resolve",
    response_model=DisputeResponse,
    summary="Resolve a dispute (admin only)",
)
def resolve(
    dispute_id: uuid.UUID,
    payload: ResolveBody,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
) -> Dispute:
    """The only endpoint that moves disputed money, and it requires a human
    with the ADMIN role. The AI has no route to this decision."""
    return disputes.resolve(
        db,
        dispute_id,
        admin,
        outcome=payload.outcome,
        note=payload.note,
        split_to_receiver=payload.split_to_receiver,
        context=context,
    )
