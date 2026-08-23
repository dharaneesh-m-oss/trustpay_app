"""Milestone state machine and access checks.

Every status change in TrustPay goes through `transition()`. Handlers do not
assign `milestone.status` directly, so an illegal jump — releasing payment on a
milestone that was never funded, resubmitting after cancellation — is impossible
to express rather than merely discouraged.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.milestones.constants import ALLOWED_TRANSITIONS, MilestoneStatus
from app.milestones.model import Milestone
from app.projects.constants import ProjectRole
from app.projects.exceptions import (
    InvalidMilestoneTransitionError,
    MilestoneNotFoundError,
    NotAProjectMemberError,
    NotProjectClientError,
    NotProjectReceiverError,
)
from app.projects.model import Project
from app.users.model import User


def assert_transition(current: MilestoneStatus, target: MilestoneStatus) -> None:
    if target not in ALLOWED_TRANSITIONS.get(current, frozenset()):
        raise InvalidMilestoneTransitionError(
            f"A milestone cannot move from {current.value} to {target.value}.",
            details={"from": current.value, "to": target.value},
        )


def transition(milestone: Milestone, target: MilestoneStatus) -> Milestone:
    """Move a milestone, stamping the matching timestamp.

    The timestamps are set here rather than by each caller so they cannot drift
    out of step with the status they describe.
    """
    assert_transition(milestone.status, target)

    now = datetime.now(UTC)
    milestone.status = target

    if target == MilestoneStatus.FUNDED and milestone.funded_at is None:
        milestone.funded_at = now
    elif target == MilestoneStatus.SUBMITTED:
        milestone.submitted_at = now
    elif target == MilestoneStatus.APPROVED:
        milestone.approved_at = now
    elif target == MilestoneStatus.PAYMENT_RELEASED:
        milestone.released_at = now

    return milestone


# ------------------------------------------------------------------- lookups


def get_milestone(db: Session, milestone_id: uuid.UUID) -> Milestone:
    milestone = db.scalar(
        select(Milestone)
        .where(Milestone.id == milestone_id)
        .options(selectinload(Milestone.project), selectinload(Milestone.submissions))
    )
    if milestone is None:
        raise MilestoneNotFoundError()
    return milestone


def get_milestone_for_update(db: Session, milestone_id: uuid.UUID) -> Milestone:
    """Lock the milestone row for the duration of a money operation.

    Two concurrent approvals of the same milestone must serialise here; the
    second one then sees `release_transaction_id` already set and is refused.
    `populate_existing` forces a refresh, because the row is usually already in
    the session from an earlier read.
    """
    milestone = db.scalar(
        select(Milestone)
        .where(Milestone.id == milestone_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if milestone is None:
        raise MilestoneNotFoundError()
    return milestone


# -------------------------------------------------------------- authorisation


def assert_member(project: Project, user: User) -> ProjectRole:
    role = project.role_of(user.id)
    if role is None:
        raise NotAProjectMemberError()
    return role


def assert_client(project: Project, user: User) -> None:
    if project.client_id != user.id:
        raise NotProjectClientError()


def assert_receiver(project: Project, user: User) -> None:
    if project.receiver_id != user.id:
        raise NotProjectReceiverError()
