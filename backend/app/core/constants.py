"""Enumerations shared across TrustPay domains.

Domain-specific enums live in each module's `constants.py`. Only values used by
more than one domain belong here.
"""

from __future__ import annotations

from enum import StrEnum


class UserRole(StrEnum):
    """System-level role.

    IMPORTANT: "client" and "receiver" are NOT system roles. The same person is a
    client on one project and a receiver on another, so those are per-project
    roles recorded on ProjectMember (see projects/constants.py). Storing them on
    the user would permanently mislabel anyone who does both.
    """

    USER = "USER"
    ADMIN = "ADMIN"
    SUPPORT = "SUPPORT"


class UserStatus(StrEnum):
    PENDING_VERIFICATION = "PENDING_VERIFICATION"
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    CLOSED = "CLOSED"


class Currency(StrEnum):
    INR = "INR"
    USD = "USD"
    EUR = "EUR"


class AuditAction(StrEnum):
    """Append-only record of consequential events (spec section 31)."""

    USER_REGISTERED = "USER_REGISTERED"
    USER_LOGIN_SUCCEEDED = "USER_LOGIN_SUCCEEDED"
    USER_LOGIN_FAILED = "USER_LOGIN_FAILED"
    USER_LOCKED_OUT = "USER_LOCKED_OUT"
    USER_LOGGED_OUT = "USER_LOGGED_OUT"
    USER_PROFILE_UPDATED = "USER_PROFILE_UPDATED"
    USER_PASSWORD_CHANGED = "USER_PASSWORD_CHANGED"
    TOKEN_REFRESHED = "TOKEN_REFRESHED"
    TOKEN_REUSE_DETECTED = "TOKEN_REUSE_DETECTED"

    WALLET_CREATED = "WALLET_CREATED"
    WALLET_TOPPED_UP = "WALLET_TOPPED_UP"
    BANK_ACCOUNT_ADDED = "BANK_ACCOUNT_ADDED"
    BANK_ACCOUNT_VERIFIED = "BANK_ACCOUNT_VERIFIED"
    PAYOUT_REQUESTED = "PAYOUT_REQUESTED"
    PAYOUT_REVERSED = "PAYOUT_REVERSED"
    WALLET_WITHDRAWN = "WALLET_WITHDRAWN"
    WALLET_FROZEN = "WALLET_FROZEN"
    LEDGER_TRANSACTION_REVERSED = "LEDGER_TRANSACTION_REVERSED"
