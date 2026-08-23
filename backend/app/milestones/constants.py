"""Milestone state machine (spec section 11).

Statuses are not free-form strings that any handler can assign. Every change
goes through `assert_transition()`, so an invalid jump — say, releasing payment
on a milestone that was never funded — is refused at the domain layer rather
than depending on each caller remembering the rules.
"""

from __future__ import annotations

from enum import StrEnum


class MilestoneStatus(StrEnum):
    DRAFT = "DRAFT"
    PENDING_FUNDING = "PENDING_FUNDING"
    FUNDED = "FUNDED"
    IN_PROGRESS = "IN_PROGRESS"
    SUBMITTED = "SUBMITTED"
    CHANGES_REQUESTED = "CHANGES_REQUESTED"
    APPROVED = "APPROVED"
    PAYMENT_RELEASED = "PAYMENT_RELEASED"
    DISPUTED = "DISPUTED"
    CANCELLATION_REQUESTED = "CANCELLATION_REQUESTED"
    CANCELLED = "CANCELLED"


#: The only permitted moves. Anything absent here is refused.
ALLOWED_TRANSITIONS: dict[MilestoneStatus, frozenset[MilestoneStatus]] = {
    MilestoneStatus.DRAFT: frozenset(
        {MilestoneStatus.PENDING_FUNDING, MilestoneStatus.CANCELLED}
    ),
    MilestoneStatus.PENDING_FUNDING: frozenset(
        {MilestoneStatus.FUNDED, MilestoneStatus.CANCELLED}
    ),
    MilestoneStatus.FUNDED: frozenset(
        {
            MilestoneStatus.IN_PROGRESS,
            MilestoneStatus.SUBMITTED,
            MilestoneStatus.DISPUTED,
            MilestoneStatus.CANCELLATION_REQUESTED,
        }
    ),
    MilestoneStatus.IN_PROGRESS: frozenset(
        {
            MilestoneStatus.SUBMITTED,
            MilestoneStatus.DISPUTED,
            MilestoneStatus.CANCELLATION_REQUESTED,
        }
    ),
    MilestoneStatus.SUBMITTED: frozenset(
        {
            MilestoneStatus.APPROVED,
            MilestoneStatus.CHANGES_REQUESTED,
            MilestoneStatus.DISPUTED,
        }
    ),
    MilestoneStatus.CHANGES_REQUESTED: frozenset(
        {
            MilestoneStatus.SUBMITTED,
            MilestoneStatus.DISPUTED,
            MilestoneStatus.CANCELLATION_REQUESTED,
        }
    ),
    # Approval and release are one atomic operation, so APPROVED is a moment,
    # not a resting state.
    MilestoneStatus.APPROVED: frozenset({MilestoneStatus.PAYMENT_RELEASED}),
    MilestoneStatus.DISPUTED: frozenset(
        {
            MilestoneStatus.APPROVED,
            MilestoneStatus.CANCELLED,
            MilestoneStatus.FUNDED,
        }
    ),
    MilestoneStatus.CANCELLATION_REQUESTED: frozenset(
        {
            MilestoneStatus.CANCELLED,
            MilestoneStatus.FUNDED,  # receiver declined the request
            MilestoneStatus.DISPUTED,
        }
    ),
    # Terminal.
    MilestoneStatus.PAYMENT_RELEASED: frozenset(),
    MilestoneStatus.CANCELLED: frozenset(),
}

#: Money is held against the milestone in these states.
PROTECTED_STATUSES = frozenset(
    {
        MilestoneStatus.FUNDED,
        MilestoneStatus.IN_PROGRESS,
        MilestoneStatus.SUBMITTED,
        MilestoneStatus.CHANGES_REQUESTED,
        MilestoneStatus.APPROVED,
        MilestoneStatus.DISPUTED,
        MilestoneStatus.CANCELLATION_REQUESTED,
    }
)

#: Nothing further will happen to these.
TERMINAL_STATUSES = frozenset(
    {MilestoneStatus.PAYMENT_RELEASED, MilestoneStatus.CANCELLED}
)

#: Human-readable, for notifications and the mobile client.
STATUS_LABELS: dict[MilestoneStatus, str] = {
    MilestoneStatus.DRAFT: "Draft",
    MilestoneStatus.PENDING_FUNDING: "Awaiting funding",
    MilestoneStatus.FUNDED: "Funds protected",
    MilestoneStatus.IN_PROGRESS: "In progress",
    MilestoneStatus.SUBMITTED: "Awaiting your review",
    MilestoneStatus.CHANGES_REQUESTED: "Changes requested",
    MilestoneStatus.APPROVED: "Approved",
    MilestoneStatus.PAYMENT_RELEASED: "Payment released",
    MilestoneStatus.DISPUTED: "In dispute",
    MilestoneStatus.CANCELLATION_REQUESTED: "Cancellation requested",
    MilestoneStatus.CANCELLED: "Cancelled",
}

DEFAULT_REVISION_LIMIT = 2
