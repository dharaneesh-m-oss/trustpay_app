"""Project and milestone errors."""

from __future__ import annotations

from app.core.exceptions import (
    AuthorizationError,
    BusinessRuleViolation,
    InvalidStateTransition,
    NotFoundError,
    ValidationError,
)


class ProjectNotFoundError(NotFoundError):
    code = "PROJECT_NOT_FOUND"
    message = "We could not find that project."


class MilestoneNotFoundError(NotFoundError):
    code = "MILESTONE_NOT_FOUND"
    message = "We could not find that milestone."


class NotAProjectMemberError(AuthorizationError):
    """Deliberately a 403 rather than a 404-style hint.

    Whether a given project id exists is itself information; both the "not
    yours" and "does not exist" paths return the same shape so ids cannot be
    probed.
    """

    code = "NOT_PROJECT_MEMBER"
    message = "You do not have access to this project."


class NotProjectClientError(AuthorizationError):
    code = "NOT_PROJECT_CLIENT"
    message = "Only the client on this project can do that."


class NotProjectReceiverError(AuthorizationError):
    code = "NOT_PROJECT_RECEIVER"
    message = "Only the receiver on this project can do that."


class MilestoneAmountMismatchError(ValidationError):
    code = "MILESTONE_TOTAL_MISMATCH"
    message = "The milestone amounts must add up to the project total."


class InvalidMilestoneError(ValidationError):
    code = "INVALID_MILESTONE"
    message = "This milestone is not valid."


class ProjectNotEditableError(BusinessRuleViolation):
    code = "PROJECT_NOT_EDITABLE"
    message = "This project can no longer be changed."


class ProjectNotActiveError(BusinessRuleViolation):
    code = "PROJECT_NOT_ACTIVE"
    message = "This project is not active."


class InvalidMilestoneTransitionError(InvalidStateTransition):
    code = "INVALID_MILESTONE_TRANSITION"


class MilestoneAlreadyFundedError(BusinessRuleViolation):
    code = "MILESTONE_ALREADY_FUNDED"
    message = "This milestone has already been funded."


class MilestoneNotFundedError(BusinessRuleViolation):
    code = "MILESTONE_NOT_FUNDED"
    message = "This milestone has not been funded yet."


class PaymentAlreadyReleasedError(BusinessRuleViolation):
    code = "PAYMENT_ALREADY_RELEASED"
    message = "Payment for this milestone has already been released."


class RevisionLimitReachedError(BusinessRuleViolation):
    code = "REVISION_LIMIT_REACHED"
    message = "The agreed number of revisions for this milestone has been used."


class ReceiverRequiredError(ValidationError):
    code = "RECEIVER_REQUIRED"
    message = "A receiver must be invited before this project can start."


class CannotInviteSelfError(ValidationError):
    code = "CANNOT_INVITE_SELF"
    message = "You cannot invite yourself as the receiver."


class MilestoneInDisputeError(BusinessRuleViolation):
    """Neither party may move money on a milestone while it is disputed.

    Only an admin resolution can, and it goes through disputes/service.resolve().
    """

    code = "MILESTONE_IN_DISPUTE"
    message = "This milestone is in dispute. A TrustPay reviewer will resolve it."
