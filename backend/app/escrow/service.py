"""Escrow: fund, submit, review, release.

This is the heart of TrustPay. Section 13 sets out what a release must do, and
every step of it happens inside one database transaction:

    authenticate → authorise ownership → validate milestone state →
    verify funded → verify not already released → lock rows →
    write ledger postings → update milestone → commit → notify

If any step raises, the whole thing rolls back. There is no path that leaves a
milestone marked paid without postings, or postings without a milestone update.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import service as audit
from app.core.context import RequestContext
from app.core.money import to_money
from app.ledger import repository as ledger_repo
from app.ledger import service as ledger
from app.ledger.constants import AccountType, PostingDirection, TransactionType
from app.ledger.model import LedgerTransaction
from app.milestones import service as milestones
from app.milestones.constants import MilestoneStatus
from app.milestones.model import Milestone, MilestoneSubmission
from app.notifications import service as notifications
from app.notifications.constants import NotificationSeverity, NotificationType
from app.projects import service as projects
from app.projects.constants import ProjectStatus
from app.projects.exceptions import (
    MilestoneAlreadyFundedError,
    MilestoneInDisputeError,
    MilestoneNotFundedError,
    PaymentAlreadyReleasedError,
    ProjectNotActiveError,
    RevisionLimitReachedError,
)
from app.projects.model import Project
from app.users.model import User


def _now() -> datetime:
    return datetime.now(UTC)


def _assert_project_active(project: Project) -> None:
    if project.status not in (ProjectStatus.ACTIVE, ProjectStatus.UNDER_DISPUTE):
        raise ProjectNotActiveError()


def _assert_not_disputed(milestone: Milestone) -> None:
    """Refuse any party-initiated move on a milestone that is in dispute.

    The state machine permits DISPUTED → APPROVED because that is how an admin
    resolves in the receiver's favour. Without this guard the same edge is
    reachable from the client's own approve endpoint, letting a party settle a
    live dispute unilaterally — which is precisely what a dispute exists to
    prevent. Disputed money moves only through disputes/service.resolve().
    """
    if milestone.status == MilestoneStatus.DISPUTED:
        raise MilestoneInDisputeError()


# --------------------------------------------------------------------- fund


def fund_milestone(
    db: Session,
    milestone_id: uuid.UUID,
    client: User,
    *,
    idempotency_key: str | None = None,
    context: RequestContext | None = None,
) -> Milestone:
    """Move the milestone amount from the client's available balance into
    protected funds.

    The money stays the client's — it moves between two of their own accounts —
    but it is no longer spendable, which is exactly what "protected" means.
    """
    context = context or RequestContext()

    milestone = milestones.get_milestone(db, milestone_id)
    project = milestone.project

    milestones.assert_client(project, client)
    _assert_project_active(project)
    projects.assert_has_receiver(project)

    # Lock before checking funded state: two taps on "Fund" must serialise, or
    # both could pass the check and protect the money twice.
    locked = milestones.get_milestone_for_update(db, milestone_id)
    _assert_not_disputed(locked)
    if locked.is_funded:
        raise MilestoneAlreadyFundedError()

    milestones.assert_transition(locked.status, MilestoneStatus.FUNDED)

    available = ledger.get_or_create_account(
        db,
        owner_user_id=client.id,
        account_type=AccountType.USER_AVAILABLE,
        currency=milestone.currency,
    )
    protected = ledger.get_or_create_account(
        db,
        owner_user_id=client.id,
        account_type=AccountType.USER_PROTECTED,
        currency=milestone.currency,
    )

    amount = to_money(locked.amount)

    try:
        transaction = ledger.post(
            db,
            transaction_type=TransactionType.MILESTONE_FUNDING,
            postings=[
                ledger.PostingRequest(
                    account_id=available.id,
                    direction=PostingDirection.DEBIT,
                    amount=amount,
                ),
                ledger.PostingRequest(
                    account_id=protected.id,
                    direction=PostingDirection.CREDIT,
                    amount=amount,
                ),
            ],
            description=f"Funds protected for “{locked.title}”",
            currency=milestone.currency,
            initiated_by_user_id=client.id,
            sender_user_id=client.id,
            receiver_user_id=project.receiver_id,
            project_id=project.id,
            milestone_id=locked.id,
            idempotency_key=idempotency_key,
        )

        milestones.transition(locked, MilestoneStatus.FUNDED)
        locked.funding_transaction_id = transaction.id

        notifications.create(
            db,
            user_id=project.receiver_id,
            notification_type=NotificationType.MILESTONE_FUNDED,
            title="Funds protected",
            body=(
                f"{client.full_name} protected {milestone.currency} {amount:,.2f} "
                f"for “{locked.title}”. You can start work."
            ),
            target={"screen": "milestone", "id": str(locked.id)},
            project_id=project.id,
            milestone_id=locked.id,
            severity=NotificationSeverity.SUCCESS,
        )

        audit.record(
            db,
            action="MILESTONE_FUNDED",
            actor_user_id=client.id,
            entity_type="milestone",
            entity_id=locked.id,
            context={"amount": str(amount), "transaction_id": str(transaction.id)},
            ip_address=context.ip_address,
            user_agent=context.user_agent,
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        if idempotency_key:
            existing = ledger_repo.get_by_idempotency_key(db, idempotency_key)
            if existing is not None:
                return milestones.get_milestone(db, milestone_id)
        raise

    db.refresh(locked)
    return locked


# ------------------------------------------------------------------- submit


def submit_milestone(
    db: Session,
    milestone_id: uuid.UUID,
    receiver: User,
    *,
    note: str,
    completion_percentage: int = 100,
    evidence: list | None = None,
    context: RequestContext | None = None,
) -> Milestone:
    """Receiver submits proof of work for review."""
    context = context or RequestContext()

    milestone = milestones.get_milestone(db, milestone_id)
    project = milestone.project

    milestones.assert_receiver(project, receiver)
    _assert_project_active(project)

    locked = milestones.get_milestone_for_update(db, milestone_id)
    _assert_not_disputed(locked)

    if not locked.is_funded:
        # Submitting against unfunded work is how receivers end up unpaid; the
        # protection only exists once the money is actually held.
        raise MilestoneNotFundedError(
            "This milestone has not been funded yet, so there is nothing protecting your work."
        )

    if locked.status == MilestoneStatus.CHANGES_REQUESTED:
        if locked.revisions_used >= locked.revision_limit:
            raise RevisionLimitReachedError()
        locked.revisions_used += 1

    milestones.assert_transition(locked.status, MilestoneStatus.SUBMITTED)

    attempt = len(locked.submissions) + 1
    db.add(
        MilestoneSubmission(
            milestone_id=locked.id,
            submitted_by_id=receiver.id,
            attempt=attempt,
            note=note.strip(),
            completion_percentage=completion_percentage,
            evidence=evidence or [],
        )
    )

    milestones.transition(locked, MilestoneStatus.SUBMITTED)

    notifications.create(
        db,
        user_id=project.client_id,
        notification_type=NotificationType.MILESTONE_SUBMITTED,
        title="Work submitted for review",
        body=f"{receiver.full_name} submitted “{locked.title}” for your review.",
        target={"screen": "milestone", "id": str(locked.id)},
        project_id=project.id,
        milestone_id=locked.id,
    )

    audit.record(
        db,
        action="MILESTONE_SUBMITTED",
        actor_user_id=receiver.id,
        entity_type="milestone",
        entity_id=locked.id,
        context={"attempt": attempt, "completion": completion_percentage},
        ip_address=context.ip_address,
        user_agent=context.user_agent,
    )
    db.commit()
    db.refresh(locked)
    return locked


def request_changes(
    db: Session,
    milestone_id: uuid.UUID,
    client: User,
    *,
    note: str,
    context: RequestContext | None = None,
) -> Milestone:
    context = context or RequestContext()

    milestone = milestones.get_milestone(db, milestone_id)
    project = milestone.project

    milestones.assert_client(project, client)
    _assert_project_active(project)

    locked = milestones.get_milestone_for_update(db, milestone_id)
    _assert_not_disputed(locked)
    milestones.assert_transition(locked.status, MilestoneStatus.CHANGES_REQUESTED)

    latest = max(locked.submissions, key=lambda item: item.attempt, default=None)
    if latest is not None:
        latest.review_note = note.strip()
        latest.reviewed_at = _now()

    milestones.transition(locked, MilestoneStatus.CHANGES_REQUESTED)

    notifications.create(
        db,
        user_id=project.receiver_id,
        notification_type=NotificationType.CHANGES_REQUESTED,
        title="Changes requested",
        body=f"{client.full_name} asked for changes on “{locked.title}”.",
        target={"screen": "milestone", "id": str(locked.id)},
        project_id=project.id,
        milestone_id=locked.id,
        severity=NotificationSeverity.WARNING,
    )

    audit.record(
        db,
        action="MILESTONE_CHANGES_REQUESTED",
        actor_user_id=client.id,
        entity_type="milestone",
        entity_id=locked.id,
        ip_address=context.ip_address,
        user_agent=context.user_agent,
    )
    db.commit()
    db.refresh(locked)
    return locked


# ------------------------------------------------------------------ release


def approve_and_release(
    db: Session,
    milestone_id: uuid.UUID,
    client: User,
    *,
    idempotency_key: str | None = None,
    context: RequestContext | None = None,
) -> tuple[Milestone, LedgerTransaction]:
    """Approve the work and pay the receiver, atomically.

    Approval and payment are deliberately not two operations. A milestone that
    could sit APPROVED-but-unpaid would be exactly the failure mode escrow is
    supposed to eliminate — the receiver has done the work, the client has
    agreed, and the money is still not theirs.
    """
    context = context or RequestContext()

    milestone = milestones.get_milestone(db, milestone_id)
    project = milestone.project

    milestones.assert_client(project, client)
    _assert_project_active(project)

    locked = milestones.get_milestone_for_update(db, milestone_id)
    _assert_not_disputed(locked)

    if locked.is_released:
        raise PaymentAlreadyReleasedError()
    if not locked.is_funded:
        raise MilestoneNotFundedError()

    milestones.assert_transition(locked.status, MilestoneStatus.APPROVED)

    client_protected = ledger.get_or_create_account(
        db,
        owner_user_id=project.client_id,
        account_type=AccountType.USER_PROTECTED,
        currency=locked.currency,
    )
    receiver_available = ledger.get_or_create_account(
        db,
        owner_user_id=project.receiver_id,
        account_type=AccountType.USER_AVAILABLE,
        currency=locked.currency,
    )

    amount = to_money(locked.amount)

    try:
        transaction = ledger.post(
            db,
            transaction_type=TransactionType.PAYMENT_RELEASE,
            postings=[
                ledger.PostingRequest(
                    account_id=client_protected.id,
                    direction=PostingDirection.DEBIT,
                    amount=amount,
                ),
                ledger.PostingRequest(
                    account_id=receiver_available.id,
                    direction=PostingDirection.CREDIT,
                    amount=amount,
                ),
            ],
            description=f"Payment released for “{locked.title}”",
            currency=locked.currency,
            initiated_by_user_id=client.id,
            sender_user_id=project.client_id,
            receiver_user_id=project.receiver_id,
            project_id=project.id,
            milestone_id=locked.id,
            idempotency_key=idempotency_key,
        )

        milestones.transition(locked, MilestoneStatus.APPROVED)
        milestones.transition(locked, MilestoneStatus.PAYMENT_RELEASED)
        # The unique index on this column is the last line of defence against a
        # double release, even if every check above were somehow bypassed.
        locked.release_transaction_id = transaction.id

        projects.refresh_project_completion(db, project)

        notifications.create(
            db,
            user_id=project.receiver_id,
            notification_type=NotificationType.PAYMENT_RELEASED,
            title="Payment released",
            body=(
                f"{locked.currency} {amount:,.2f} for “{locked.title}” "
                "is now in your available balance."
            ),
            target={"screen": "milestone", "id": str(locked.id)},
            project_id=project.id,
            milestone_id=locked.id,
            severity=NotificationSeverity.SUCCESS,
        )

        audit.record(
            db,
            action="MILESTONE_PAYMENT_RELEASED",
            actor_user_id=client.id,
            entity_type="milestone",
            entity_id=locked.id,
            context={"amount": str(amount), "transaction_id": str(transaction.id)},
            ip_address=context.ip_address,
            user_agent=context.user_agent,
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        if idempotency_key:
            existing = ledger_repo.get_by_idempotency_key(db, idempotency_key)
            if existing is not None:
                return milestones.get_milestone(db, milestone_id), existing
        raise

    db.refresh(locked)
    return locked, transaction


def start_work(
    db: Session,
    milestone_id: uuid.UUID,
    receiver: User,
    context: RequestContext | None = None,
) -> Milestone:
    """Optional acknowledgement that work has begun, so the client can see
    movement between funding and submission."""
    context = context or RequestContext()

    milestone = milestones.get_milestone(db, milestone_id)
    milestones.assert_receiver(milestone.project, receiver)

    locked = milestones.get_milestone_for_update(db, milestone_id)
    if not locked.is_funded:
        raise MilestoneNotFundedError()

    milestones.transition(locked, MilestoneStatus.IN_PROGRESS)
    db.commit()
    db.refresh(locked)
    return locked
