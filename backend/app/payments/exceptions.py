"""Payment errors, each mapping to a message a user can act on."""

from __future__ import annotations

from app.core.exceptions import BusinessRuleViolation, NotFoundError, TrustPayError


class PaymentsNotEnabledError(TrustPayError):
    """No provider credentials, so real money cannot move.

    Deliberately a 503 rather than a 400: nothing the caller sent is wrong, the
    deployment simply cannot do this yet.
    """

    code = "PAYMENTS_NOT_ENABLED"
    status_code = 503
    message = (
        "Live payments are not switched on for this deployment yet. "
        "Adding or withdrawing real money needs a payment provider account."
    )


class BankAccountNotFoundError(NotFoundError):
    code = "BANK_ACCOUNT_NOT_FOUND"
    status_code = 404
    message = "That bank account is not on your profile."


class PaymentIntentNotFoundError(NotFoundError):
    code = "PAYMENT_INTENT_NOT_FOUND"
    status_code = 404
    message = "That payment could not be found."


class DuplicateBankAccountError(BusinessRuleViolation):
    code = "BANK_ACCOUNT_EXISTS"
    status_code = 409
    message = "That account is already on your profile."


class AccountNotVerifiedError(BusinessRuleViolation):
    code = "ACCOUNT_NOT_VERIFIED"
    status_code = 400
    message = "That account has not been verified."


class PayoutTooSmallError(BusinessRuleViolation):
    code = "PAYOUT_TOO_SMALL"
    status_code = 400
    message = "That withdrawal is below the minimum."


class PayoutLimitError(BusinessRuleViolation):
    code = "PAYOUT_LIMIT"
    status_code = 429
    message = "That would pass your daily withdrawal limit."


class VerificationFailedError(BusinessRuleViolation):
    code = "VERIFICATION_FAILED"
    status_code = 422
    message = "Those bank details could not be verified."
