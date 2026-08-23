"""Ledger errors.

These are mostly programmer errors rather than user errors — an unbalanced
transaction means the calling code is wrong, not that the user did something
invalid. They are still TrustPayErrors so they render through the same envelope
instead of surfacing as a bare 500.
"""

from __future__ import annotations

from app.core.exceptions import (
    BusinessRuleViolation,
    ConflictError,
    InsufficientFundsError,
    NotFoundError,
    TrustPayError,
)


class UnbalancedTransactionError(TrustPayError):
    code = "UNBALANCED_TRANSACTION"
    status_code = 500
    message = "This transaction could not be recorded correctly."


class InvalidPostingError(BusinessRuleViolation):
    code = "INVALID_POSTING"
    message = "This transaction could not be recorded correctly."


class LedgerAccountNotFoundError(NotFoundError):
    code = "LEDGER_ACCOUNT_NOT_FOUND"
    message = "We could not find that account."


class CurrencyMismatchError(BusinessRuleViolation):
    code = "CURRENCY_MISMATCH"
    message = "All parts of a transaction must use the same currency."


class InsufficientBalanceError(InsufficientFundsError):
    """Raised before any posting is written, so no partial state can exist."""


class DuplicateIdempotencyKeyError(ConflictError):
    code = "IDEMPOTENCY_CONFLICT"
    message = "A different request was already processed with this reference."


class TransactionAlreadyReversedError(BusinessRuleViolation):
    code = "ALREADY_REVERSED"
    message = "This transaction has already been reversed."
