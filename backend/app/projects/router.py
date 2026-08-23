"""Project, milestone and escrow endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.ai import analysis as ai_analysis
from app.ai import review as ai_review
from app.ai.constants import AnalysisType
from app.auth.dependencies import get_current_active_user, get_request_context
from app.core.context import RequestContext
from app.dependencies.database import get_db
from app.escrow import service as escrow
from app.milestones import service as milestones_service
from app.milestones.constants import STATUS_LABELS
from app.milestones.model import Milestone
from app.projects import service as projects_service
from app.projects.schema import (
    FundMilestoneRequest,
    MilestoneResponse,
    PartySummary,
    ProjectCreate,
    ProjectDetailResponse,
    ProjectInviteRequest,
    ProjectListResponse,
    ProjectResponse,
    RequestChangesRequest,
    ReviewMilestoneRequest,
    SubmissionResponse,
    SubmitMilestoneRequest,
)
from app.projects.model import Project
from app.users.model import User

router = APIRouter(prefix="/projects", tags=["Projects"])
milestone_router = APIRouter(prefix="/milestones", tags=["Milestones"])


def _milestone_response(milestone: Milestone) -> MilestoneResponse:
    return MilestoneResponse(
        id=milestone.id,
        project_id=milestone.project_id,
        sequence=milestone.sequence,
        title=milestone.title,
        description=milestone.description,
        completion_criteria=milestone.completion_criteria,
        amount=milestone.amount,
        currency=milestone.currency,
        due_date=milestone.due_date,
        status=milestone.status,
        status_label=STATUS_LABELS.get(milestone.status, milestone.status.value),
        revision_limit=milestone.revision_limit,
        revisions_used=milestone.revisions_used,
        funded_at=milestone.funded_at,
        submitted_at=milestone.submitted_at,
        released_at=milestone.released_at,
        is_funded=milestone.is_funded,
        is_released=milestone.is_released,
    )


def _project_response(
    db: Session, project: Project, user: User, *, detail: bool = False
):
    from app.milestones.constants import MilestoneStatus

    client = db.get(User, project.client_id)
    receiver = db.get(User, project.receiver_id) if project.receiver_id else None
    role = project.role_of(user.id)

    common = {
        "id": project.id,
        "title": project.title,
        "description": project.description,
        "status": project.status,
        "total_amount": project.total_amount,
        "currency": project.currency,
        "protected_amount": projects_service.protected_amount(project),
        "released_amount": projects_service.released_amount(project),
        "start_date": project.start_date,
        "end_date": project.end_date,
        "created_at": project.created_at,
        "client": PartySummary.model_validate(client),
        "receiver": PartySummary.model_validate(receiver) if receiver else None,
        "invited_receiver_email": project.invited_receiver_email,
        "your_role": str(role) if role else "ADMIN",
        "milestones_total": len(project.milestones),
        "milestones_completed": sum(
            1
            for milestone in project.milestones
            if milestone.status == MilestoneStatus.PAYMENT_RELEASED
        ),
    }

    if not detail:
        return ProjectResponse(**common)

    return ProjectDetailResponse(
        **common,
        agreement_text=project.agreement_text,
        milestones=[
            _milestone_response(milestone)
            for milestone in sorted(project.milestones, key=lambda item: item.sequence)
        ],
    )


# ------------------------------------------------------------------ projects


@router.post(
    "",
    response_model=ProjectDetailResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a project with its milestones",
)
def create_project(
    payload: ProjectCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
):
    project = projects_service.create_project(db, current_user, payload, context)
    return _project_response(db, project, current_user, detail=True)


@router.get("", response_model=ProjectListResponse, summary="Projects you are part of")
def list_projects(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    projects, total = projects_service.list_projects(
        db, current_user, limit=limit, offset=offset
    )
    return ProjectListResponse(
        items=[_project_response(db, project, current_user) for project in projects],
        total=total,
    )


@router.get(
    "/{project_id}", response_model=ProjectDetailResponse, summary="Project detail"
)
def get_project(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    project = projects_service.get_project_for_user(db, project_id, current_user)
    return _project_response(db, project, current_user, detail=True)


@router.post(
    "/{project_id}/invite",
    response_model=ProjectDetailResponse,
    summary="Invite the receiver",
)
def invite(
    project_id: uuid.UUID,
    payload: ProjectInviteRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
):
    project = projects_service.get_project_for_user(db, project_id, current_user)
    project = projects_service.invite_receiver(
        db, project, current_user, payload.receiver_email, context
    )
    return _project_response(db, project, current_user, detail=True)


@router.post(
    "/{project_id}/accept",
    response_model=ProjectDetailResponse,
    summary="Accept the project (receiver)",
)
def accept(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
):
    project = projects_service.get_project_for_user(db, project_id, current_user)
    project = projects_service.respond_to_invitation(
        db, project, current_user, accept=True, context=context
    )
    return _project_response(db, project, current_user, detail=True)


@router.post(
    "/{project_id}/decline",
    response_model=ProjectDetailResponse,
    summary="Decline the project (receiver)",
)
def decline(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
):
    project = projects_service.get_project_for_user(db, project_id, current_user)
    project = projects_service.respond_to_invitation(
        db, project, current_user, accept=False, context=context
    )
    return _project_response(db, project, current_user, detail=True)


@router.get(
    "/{project_id}/analysis",
    summary="AI analysis of the agreement",
)
def analyse(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Advisory only. Nothing here blocks funding — it tells the client what a
    careful reader would notice before they commit money."""
    project = projects_service.get_project_for_user(db, project_id, current_user)
    result = ai_review.review_project(project).to_dict()

    ai_analysis.store(
        db,
        analysis_type=AnalysisType.AGREEMENT,
        result=result,
        requested_by_id=current_user.id,
        project_id=project.id,
    )
    db.commit()
    return result


# ---------------------------------------------------------------- milestones


@milestone_router.get(
    "/{milestone_id}", response_model=MilestoneResponse, summary="Milestone detail"
)
def get_milestone(
    milestone_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    milestone = milestones_service.get_milestone(db, milestone_id)
    milestones_service.assert_member(milestone.project, current_user)
    return _milestone_response(milestone)


@milestone_router.get(
    "/{milestone_id}/submissions",
    response_model=list[SubmissionResponse],
    summary="Submission history",
)
def list_submissions(
    milestone_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    milestone = milestones_service.get_milestone(db, milestone_id)
    milestones_service.assert_member(milestone.project, current_user)
    return [
        SubmissionResponse.model_validate(submission)
        for submission in sorted(milestone.submissions, key=lambda item: item.attempt)
    ]


@milestone_router.post(
    "/{milestone_id}/fund",
    response_model=MilestoneResponse,
    summary="Protect funds for this milestone (client)",
)
def fund(
    milestone_id: uuid.UUID,
    payload: FundMilestoneRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
):
    milestone = escrow.fund_milestone(
        db,
        milestone_id,
        current_user,
        idempotency_key=payload.idempotency_key,
        context=context,
    )
    return _milestone_response(milestone)


@milestone_router.post(
    "/{milestone_id}/start",
    response_model=MilestoneResponse,
    summary="Mark work as started (receiver)",
)
def start(
    milestone_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
):
    return _milestone_response(
        escrow.start_work(db, milestone_id, current_user, context)
    )


@milestone_router.post(
    "/{milestone_id}/submit",
    response_model=MilestoneResponse,
    summary="Submit proof of work (receiver)",
)
def submit(
    milestone_id: uuid.UUID,
    payload: SubmitMilestoneRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
):
    milestone = escrow.submit_milestone(
        db,
        milestone_id,
        current_user,
        note=payload.note,
        completion_percentage=payload.completion_percentage,
        evidence=payload.evidence,
        context=context,
    )
    return _milestone_response(milestone)


@milestone_router.post(
    "/{milestone_id}/request-changes",
    response_model=MilestoneResponse,
    summary="Ask for changes (client)",
)
def request_changes(
    milestone_id: uuid.UUID,
    payload: RequestChangesRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
):
    milestone = escrow.request_changes(
        db, milestone_id, current_user, note=payload.note, context=context
    )
    return _milestone_response(milestone)


@milestone_router.post(
    "/{milestone_id}/approve",
    response_model=MilestoneResponse,
    summary="Approve and release payment (client)",
)
def approve(
    milestone_id: uuid.UUID,
    payload: ReviewMilestoneRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
):
    """Approval and payment are one atomic operation — see escrow/service.py."""
    milestone, _transaction = escrow.approve_and_release(
        db,
        milestone_id,
        current_user,
        idempotency_key=payload.idempotency_key,
        context=context,
    )
    return _milestone_response(milestone)
