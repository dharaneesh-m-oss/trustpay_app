"""Authentication domain errors."""

from __future__ import annotations

from app.core.exceptions import (
    AccountInactiveError,
    AccountLockedError,
    AuthenticationError,
    InvalidTokenError,
)


class InvalidCredentialsError(AuthenticationError):
    """Deliberately identical for an unknown email and for a wrong password.

    Distinguishing the two turns the login endpoint into an account enumeration
    oracle: an attacker could confirm which addresses hold TrustPay accounts.
    """

    code = "INVALID_CREDENTIALS"
    message = "Email or password is incorrect."


class AccountLockedOutError(AccountLockedError):
    pass


class AccountNotActiveError(AccountInactiveError):
    pass


class InvalidRefreshTokenError(InvalidTokenError):
    code = "INVALID_REFRESH_TOKEN"
    message = "Your session is no longer valid. Please sign in again."


class RefreshTokenReuseError(InvalidTokenError):
    code = "REFRESH_TOKEN_REUSED"
    message = "This session was ended for your security. Please sign in again."
