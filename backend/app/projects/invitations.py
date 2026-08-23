"""Claiming invitations that were addressed to an email, not an account.

A client can invite someone who is not on TrustPay yet. That invitation waits
against the email address until the person registers; this module is what hands
it to them at that moment, inside the same transaction that creates their
account.

Without this the invite would sit unclaimed forever and the project could never
leave AWAITING_ACCEPTANCE — which is exactly the dead end that made a
first-time user unable to create a usable project at all.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.notifications import service as notifications
from app.notifications.constants import NotificationType
from app.projects.constants import MemberStatus, ProjectRole
from app.projects.model import Project, ProjectMember
from app.users.model import User


def claim_pending_invitations(db: Session, user: User) -> int:
    """Attach every invitation addressed to this user's email. Stages; no commit.

    Returns how many were claimed, so the caller can log it.
    """
    email = user.email.strip().lower()

    pending = list(
        db.scalars(
            select(ProjectMember).where(
                ProjectMember.invited_email == email,
                ProjectMember.user_id.is_(None),
                ProjectMember.status == MemberStatus.PENDING,
            )
        ).all()
    )
    if not pending:
        return 0

    for member in pending:
        member.user_id = user.id
        member.invited_email = None

        project = db.get(Project, member.project_id)
        if project is None:
            continue

        if member.role == ProjectRole.RECEIVER and project.receiver_id is None:
            # A client cannot have been invited as their own receiver, but check
            # rather than trust: the constraint exists for a reason.
            if project.client_id != user.id:
                project.receiver_id = user.id
                project.invited_receiver_email = None

        client = db.get(User, project.client_id)
        notifications.create(
            db,
            user_id=user.id,
            notification_type=NotificationType.PROJECT_INVITATION,
            title="You have a project invitation",
            body=(
                f"{client.full_name if client else 'A client'} invited you to "
                f"“{project.title}” before you joined. Review and accept it."
            ),
            target={"screen": "project", "id": str(project.id)},
            project_id=project.id,
        )

    db.flush()
    return len(pending)
