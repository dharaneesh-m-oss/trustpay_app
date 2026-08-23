"""TrustPay error hierarchy.

Section 49 of the spec: never show a raw API error to a user. Every failure
raised by a service is a TrustPayError carrying a stable machine code, a
human-readable message safe to display, and the HTTP status it maps to. The
handlers registered in main.py render them into one consistent envelope.
"""

from __future__ import annotations

from typing import Any


class TrustPayError(Exception):
    """Base class for every expected, user-facing failure."""

    code: str = "INTERNAL_ERROR"
    status_code: int = 500
    message: str = "Something went wrong. Please try again."

    def __init__(
        self,
        message: str | None = None,
        *,
        code: str | None = None,
        status_code: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.message = message or self.message
        self.code = code or self.code
        self.status_code = status_code or self.status_code
        self.details = details or {}
        super().__init__(self.message)

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details:
            payload["details"] = self.details
        return payload


# ---------- 400 ----------
class ValidationError(TrustPayError):
    code = "VALIDATION_ERROR"
    status_code = 400
    message = "Some of the information provided is not valid."


class BusinessRuleViolation(TrustPayError):
    code = "BUSINESS_RULE_VIOLATION"
    status_code = 400
    message = "This action is not allowed in the current state."


class InvalidStateTransition(BusinessRuleViolation):
    code = "INVALID_STATE_TRANSITION"
    message = "This item cannot move to that state from where it is now."


# ---------- 401 / 403 ----------
class AuthenticationError(TrustPayError):
    code = "AUTHENTICATION_FAILED"
    status_code = 401
    message = "Email or password is incorrect."


class InvalidTokenError(AuthenticationError):
    code = "INVALID_TOKEN"
    message = "Your session is no longer valid. Please sign in again."


class TokenExpiredError(AuthenticationError):
    code = "TOKEN_EXPIRED"
    message = "Your session has expired. Please sign in again."


class AccountLockedError(AuthenticationError):
    code = "ACCOUNT_LOCKED"
    status_code = 423
    message = "Too many failed attempts. This account is temporarily locked."


class AccountInactiveError(AuthenticationError):
    code = "ACCOUNT_INACTIVE"
    status_code = 403
    message = "This account is not active."


class AuthorizationError(TrustPayError):
    code = "NOT_AUTHORIZED"
    status_code = 403
    message = "You do not have permission to do this."


# ---------- 404 / 409 ----------
class NotFoundError(TrustPayError):
    code = "NOT_FOUND"
    status_code = 404
    message = "We could not find what you were looking for."


class ConflictError(TrustPayError):
    code = "CONFLICT"
    status_code = 409
    message = "This conflicts with something that already exists."


class DuplicateEmailError(ConflictError):
    code = "EMAIL_ALREADY_REGISTERED"
    message = "An account already exists with this email address."


class IdempotencyConflictError(ConflictError):
    code = "IDEMPOTENCY_CONFLICT"
    message = "A different request was already processed with this idempotency key."


# ---------- 422 / 429 ----------
class InsufficientFundsError(BusinessRuleViolation):
    code = "INSUFFICIENT_FUNDS"
    status_code = 422
    message = "There is not enough available balance for this action."


class RateLimitError(TrustPayError):
    code = "RATE_LIMITED"
    status_code = 429
    message = "Too many requests. Please wait a moment and try again."
