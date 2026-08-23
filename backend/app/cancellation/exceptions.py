"""Cancellation and OTP errors."""

from __future__ import annotations

from app.core.exceptions import (
    AuthorizationError,
    BusinessRuleViolation,
    NotFoundError,
    RateLimitError,
    ValidationError,
)


class CancellationNotFoundError(NotFoundError):
    code = "CANCELLATION_NOT_FOUND"
    message = "We could not find that cancellation request."


class CancellationNotPendingError(BusinessRuleViolation):
    code = "CANCELLATION_NOT_PENDING"
    message = "This cancellation request has already been resolved."


class NotTheVerifierError(AuthorizationError):
    """The client who requested the cancellation is not allowed to confirm it.

    This is the rule that makes protected funds meaningful: whoever asks to pull
    the money back cannot also be the one who approves it.
    """

    code = "NOT_THE_VERIFIER"
    message = "Only the receiver can verify this cancellation."


class OtpInvalidError(ValidationError):
    code = "OTP_INVALID"
    status_code = 400
    message = "That code is not correct."


class OtpExpiredError(ValidationError):
    code = "OTP_EXPIRED"
    status_code = 400
    message = "That code has expired. Request a new one."


class OtpTooManyAttemptsError(BusinessRuleViolation):
    code = "OTP_TOO_MANY_ATTEMPTS"
    status_code = 429
    message = "Too many incorrect attempts. Request a new code."


class OtpRateLimitedError(RateLimitError):
    code = "OTP_RATE_LIMITED"
    message = "Too many codes requested. Please wait before trying again."
