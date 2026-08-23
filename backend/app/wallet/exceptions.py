"""Wallet errors."""

from __future__ import annotations

from app.core.exceptions import BusinessRuleViolation, NotFoundError


class WalletNotFoundError(NotFoundError):
    code = "WALLET_NOT_FOUND"
    message = "We could not find a wallet for this account."


class WalletFrozenError(BusinessRuleViolation):
    code = "WALLET_FROZEN"
    status_code = 403
    message = "This wallet is temporarily frozen. Please contact support."


class WithdrawalNotPermittedError(BusinessRuleViolation):
    code = "WITHDRAWAL_NOT_PERMITTED"
    status_code = 403
    message = "Identity verification is required before withdrawing funds."


class AmountLimitError(BusinessRuleViolation):
    code = "AMOUNT_LIMIT_EXCEEDED"
    message = "This amount is outside the permitted range."
