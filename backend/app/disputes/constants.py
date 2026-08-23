"""Dispute vocabulary."""

from __future__ import annotations

from enum import StrEnum


class DisputeStatus(StrEnum):
    OPEN = "OPEN"
    UNDER_REVIEW = "UNDER_REVIEW"
    AWAITING_RESPONSE = "AWAITING_RESPONSE"
    RESOLVED = "RESOLVED"
    CLOSED = "CLOSED"


class DisputeReason(StrEnum):
    WORK_NOT_DELIVERED = "WORK_NOT_DELIVERED"
    WORK_INCOMPLETE = "WORK_INCOMPLETE"
    QUALITY_NOT_AS_AGREED = "QUALITY_NOT_AS_AGREED"
    PAYMENT_NOT_RELEASED = "PAYMENT_NOT_RELEASED"
    SCOPE_DISAGREEMENT = "SCOPE_DISAGREEMENT"
    DEADLINE_MISSED = "DEADLINE_MISSED"
    OTHER = "OTHER"


class DisputeOutcome(StrEnum):
    """What an admin decided. Each maps to a specific movement of the protected
    funds — there is no outcome that leaves the money in limbo."""

    RELEASE_TO_RECEIVER = "RELEASE_TO_RECEIVER"
    REFUND_TO_CLIENT = "REFUND_TO_CLIENT"
    SPLIT = "SPLIT"
    NO_ACTION = "NO_ACTION"


OPEN_STATUSES = frozenset(
    {DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW, DisputeStatus.AWAITING_RESPONSE}
)

REASON_LABELS: dict[DisputeReason, str] = {
    DisputeReason.WORK_NOT_DELIVERED: "Work was not delivered",
    DisputeReason.WORK_INCOMPLETE: "Work is incomplete",
    DisputeReason.QUALITY_NOT_AS_AGREED: "Quality is not as agreed",
    DisputeReason.PAYMENT_NOT_RELEASED: "Payment has not been released",
    DisputeReason.SCOPE_DISAGREEMENT: "We disagree on the scope",
    DisputeReason.DEADLINE_MISSED: "The deadline was missed",
    DisputeReason.OTHER: "Something else",
}
