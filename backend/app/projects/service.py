"""Project business logic."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy.orm import Session

from app.audit import service as audit
from app.config.settings import settings
from app.core.context import RequestContext
from app.core.money import ZERO, to_money
from app.milestones.constants import PROTECTED_STATUSES, MilestoneStatus
from app.milestones.model import Milestone
from app.notifications import service as notifications
from app.notifications.constants import NotificationSeverity, NotificationType
from app.projects import repository as projects_repo
from app.projects.constants import (
    EDITABLE_STATUSES,
    MemberStatus,
    ProjectRole,
    ProjectStatus,
)
from app.projects.exceptions import (
    CannotInviteSelfError,
    MilestoneAmountMismatchError,
    NotAProjectMemberError,
    NotProjectClientError,
    NotProjectReceiverError,
    ProjectNotEditableError,
    ProjectNotFoundError,
    ReceiverRequiredError,
)
from app.projects.model import Project, ProjectMember
from app.projects.schema import ProjectCreate
from app.users import repository as users_repo
from app.users.exceptions import UserNotFoundError
from app.users.model import User


def _now() -> datetime:
    return datetime.now(UTC)


# ------------------------------------------------------------------- creation


def create_project(
    db: Session,
    client: User,
    payload: ProjectCreate,
    context: RequestContext | None = None,
) -> Project:
    """Create a project and its milestones in one transaction.

    A project whose milestones failed to save would be a project with no terms —
    fundable, but with nothing defining what funding buys.
    """
    context = context or RequestContext()
    currency = (payload.currency or settings.DEFAULT_CURRENCY).upper()

    # Re-checked here even though the schema already validated it: a service
    # must not depend on having been called through one particular schema.
    milestone_total = sum(
        (to_money(item.amount) for item in payload.milestones), ZERO
    )
    if milestone_total != to_money(payload.total_amount):
        raise MilestoneAmountMismatchError(
            f"Milestone amounts add up to {milestone_total:.2f}, "
            f"but the project total is {to_money(payload.total_amount):.2f}.",
            details={
                "milestone_total": str(milestone_total),
                "project_total": str(to_money(payload.total_amount)),
            },
        )

    # An invited email may belong to someone who has not joined TrustPay yet.
    # Refusing that would mean you could only ever hire an existing user, which
    # makes the product unusable for a first project. The invitation is held
    # against the email and claimed when that person registers.
    receiver: User | None = None
    invited_email: str | None = None

    if payload.receiver_email:
        if payload.receiver_email == client.email:
            raise CannotInviteSelfError()
        receiver = users_repo.get_by_email(db, payload.receiver_email)
        if receiver is None:
            invited_email = payload.receiver_email
        elif receiver.id == client.id:
            raise CannotInviteSelfError()

    project = projects_repo.add(
        db,
        Project(
            title=payload.title.strip(),
            description=payload.description.strip(),
            client_id=client.id,
            receiver_id=receiver.id if receiver else None,
            invited_receiver_email=invited_email,
            total_amount=to_money(payload.total_amount),
            currency=currency,
            status=(
                ProjectStatus.AWAITING_ACCEPTANCE
                if (receiver or invited_email)
                else ProjectStatus.DRAFT
            ),
            start_date=payload.start_date,
            end_date=payload.end_date,
            agreement_text=payload.agreement_text,
        ),
    )

    for index, item in enumerate(payload.milestones, start=1):
        db.add(
            Milestone(
                project_id=project.id,
                sequence=index,
                title=item.title.strip(),
                description=item.description.strip(),
                completion_criteria=item.completion_criteria.strip(),
                amount=to_money(item.amount),
                currency=currency,
                due_date=item.due_date,
                revision_limit=item.revision_limit,
                status=MilestoneStatus.DRAFT,
            )
        )

    projects_repo.add_member(
        db,
        ProjectMember(
            project_id=project.id,
            user_id=client.id,
            role=ProjectRole.CLIENT,
            status=MemberStatus.ACCEPTED,
            responded_at=_now(),
        ),
    )

    if receiver or invited_email:
        projects_repo.add_member(
            db,
            ProjectMember(
                project_id=project.id,
                user_id=receiver.id if receiver else None,
                invited_email=invited_email,
                role=ProjectRole.RECEIVER,
                status=MemberStatus.PENDING,
                invited_by_id=client.id,
            ),
        )
        # Someone without an account cannot be notified in-app; they see the
        # invitation the moment they register.
        notifications.create(
            db,
            user_id=receiver.id if receiver else None,
            notification_type=NotificationType.PROJECT_INVITATION,
            title="New project invitation",
            body=f"{client.full_name} invited you to “{project.title}”.",
            target={"screen": "project", "id": str(project.id)},
            project_id=project.id,
        )

    audit.record(
        db,
        action="PROJECT_CREATED",
        actor_user_id=client.id,
        entity_type="project",
        entity_id=project.id,
        context={
            "total_amount": str(project.total_amount),
            "milestones": len(payload.milestones),
            "receiver_invited": bool(receiver or invited_email),
            "invite_pending_signup": bool(invited_email),
        },
        ip_address=context.ip_address,
        user_agent=context.user_agent,
    )

    db.commit()
    db.refresh(project)
    return project


def invite_receiver(
    db: Session,
    project: Project,
    client: User,
    receiver_email: str,
    context: RequestContext | None = None,
) -> Project:
    context = context or RequestContext()

    if project.client_id != client.id:
        raise NotProjectClientError()
    if project.status not in EDITABLE_STATUSES:
        raise ProjectNotEditableError()

    receiver_email = receiver_email.strip().lower()
    if receiver_email == client.email:
        raise CannotInviteSelfError()

    receiver = users_repo.get_by_email(db, receiver_email)
    if receiver is not None and receiver.id == client.id:
        raise CannotInviteSelfError()

    project.receiver_id = receiver.id if receiver else None
    project.invited_receiver_email = None if receiver else receiver_email
    project.status = ProjectStatus.AWAITING_ACCEPTANCE

    existing = (
        projects_repo.get_member(db, project.id, receiver.id) if receiver else None
    )
    if existing is None:
        projects_repo.add_member(
            db,
            ProjectMember(
                project_id=project.id,
                user_id=receiver.id if receiver else None,
                invited_email=None if receiver else receiver_email,
                role=ProjectRole.RECEIVER,
                status=MemberStatus.PENDING,
                invited_by_id=client.id,
            ),
        )
    else:
        existing.status = MemberStatus.PENDING
        existing.responded_at = None

    notifications.create(
        db,
        user_id=receiver.id if receiver else None,
        notification_type=NotificationType.PROJECT_INVITATION,
        title="New project invitation",
        body=f"{client.full_name} invited you to “{project.title}”.",
        target={"screen": "project", "id": str(project.id)},
        project_id=project.id,
    )

    audit.record(
        db,
        action="PROJECT_RECEIVER_INVITED",
        actor_user_id=client.id,
        entity_type="project",
        entity_id=project.id,
        context={
            "receiver_id": str(receiver.id) if receiver else None,
            "invited_email": None if receiver else receiver_email,
        },
        ip_address=context.ip_address,
        user_agent=context.user_agent,
    )
    db.commit()
    return project


# ----------------------------------------------------------------- acceptance


def respond_to_invitation(
    db: Session,
    project: Project,
    receiver: User,
    *,
    accept: bool,
    context: RequestContext | None = None,
) -> Project:
    """Accept or decline. Accepting is what freezes the agreement.

    From this point the title, total and milestone amounts are immutable — the
    receiver agreed to specific terms, and terms that can change afterwards are
    not an agreement.
    """
    context = context or RequestContext()

    if project.receiver_id != receiver.id:
        raise NotProjectReceiverError()
    if project.status != ProjectStatus.AWAITING_ACCEPTANCE:
        raise ProjectNotEditableError("This invitation is no longer open.")

    member = projects_repo.get_member(db, project.id, receiver.id)
    now = _now()

    if accept:
        project.status = ProjectStatus.ACTIVE
        project.accepted_at = now
        if project.start_date is None:
            project.start_date = now.date()

        for milestone in project.milestones:
            if milestone.status == MilestoneStatus.DRAFT:
                milestone.status = MilestoneStatus.PENDING_FUNDING

        if member:
            member.status = MemberStatus.ACCEPTED
            member.responded_at = now

        notification_type = NotificationType.PROJECT_ACCEPTED
        title = "Project accepted"
        body = f"{receiver.full_name} accepted “{project.title}”. You can now fund the first milestone."
    else:
        project.status = ProjectStatus.DECLINED
        if member:
            member.status = MemberStatus.DECLINED
            member.responded_at = now

        notification_type = NotificationType.PROJECT_DECLINED
        title = "Project declined"
        body = f"{receiver.full_name} declined “{project.title}”."

    notifications.create(
        db,
        user_id=project.client_id,
        notification_type=notification_type,
        title=title,
        body=body,
        target={"screen": "project", "id": str(project.id)},
        project_id=project.id,
        severity=(
            NotificationSeverity.SUCCESS if accept else NotificationSeverity.WARNING
        ),
    )

    audit.record(
        db,
        action="PROJECT_INVITATION_ACCEPTED" if accept else "PROJECT_INVITATION_DECLINED",
        actor_user_id=receiver.id,
        entity_type="project",
        entity_id=project.id,
        ip_address=context.ip_address,
        user_agent=context.user_agent,
    )
    db.commit()
    return project


# -------------------------------------------------------------------- reading


def get_project_for_user(db: Session, project_id: uuid.UUID, user: User) -> Project:
    project = projects_repo.get(db, project_id)
    if project is None:
        # Same error whether it does not exist or is not theirs, so project ids
        # cannot be probed for existence.
        raise NotAProjectMemberError()
    if not project.involves(user.id) and not user.is_admin:
        raise NotAProjectMemberError()
    return project


def list_projects(
    db: Session, user: User, *, limit: int = 20, offset: int = 0
) -> tuple[list[Project], int]:
    return (
        projects_repo.list_for_user(db, user.id, limit=limit, offset=offset),
        projects_repo.count_for_user(db, user.id),
    )


def protected_amount(project: Project) -> Decimal:
    """Money currently held against this project's milestones."""
    return sum(
        (
            to_money(milestone.amount)
            for milestone in project.milestones
            if milestone.status in PROTECTED_STATUSES
        ),
        ZERO,
    )


def released_amount(project: Project) -> Decimal:
    return sum(
        (
            to_money(milestone.amount)
            for milestone in project.milestones
            if milestone.status == MilestoneStatus.PAYMENT_RELEASED
        ),
        ZERO,
    )


def refresh_project_completion(db: Session, project: Project) -> Project:
    """Mark a project complete once every milestone has finished.

    Called after each release and cancellation rather than on a schedule, so the
    status is correct the moment the last milestone resolves.
    """
    statuses = {milestone.status for milestone in project.milestones}
    if statuses and statuses <= {
        MilestoneStatus.PAYMENT_RELEASED,
        MilestoneStatus.CANCELLED,
    }:
        project.status = (
            ProjectStatus.COMPLETED
            if MilestoneStatus.PAYMENT_RELEASED in statuses
            else ProjectStatus.CANCELLED
        )
        project.completed_at = _now()
    return project


def assert_has_receiver(project: Project) -> None:
    if project.receiver_id is None:
        raise ReceiverRequiredError()
