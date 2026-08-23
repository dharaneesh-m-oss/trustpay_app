"""Project vocabulary."""

from __future__ import annotations

from enum import StrEnum


class ProjectStatus(StrEnum):
    DRAFT = "DRAFT"
    AWAITING_ACCEPTANCE = "AWAITING_ACCEPTANCE"
    ACTIVE = "ACTIVE"
    ON_HOLD = "ON_HOLD"
    UNDER_DISPUTE = "UNDER_DISPUTE"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    DECLINED = "DECLINED"


class ProjectRole(StrEnum):
    """Role *within one project*.

    This is where client/receiver belongs — not on the user. The same person is
    a client on the project they commissioned and a receiver on the one they
    were hired for.
    """

    CLIENT = "CLIENT"
    RECEIVER = "RECEIVER"


class MemberStatus(StrEnum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    DECLINED = "DECLINED"
    REMOVED = "REMOVED"


#: Statuses in which the project's terms can still be edited. Once the receiver
#: accepts, the agreement is fixed — changing the amount or the milestones after
#: someone agreed to them is the exact behaviour escrow exists to prevent.
EDITABLE_STATUSES = frozenset({ProjectStatus.DRAFT, ProjectStatus.AWAITING_ACCEPTANCE})

#: Statuses in which money can move.
FUNDABLE_STATUSES = frozenset({ProjectStatus.ACTIVE})

MAX_MILESTONES = 20
MIN_MILESTONES = 1
