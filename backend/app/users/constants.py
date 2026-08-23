"""User domain constants."""

from __future__ import annotations

from app.core.constants import UserRole, UserStatus

__all__ = ["UserRole", "UserStatus", "ACTIVE_LOGIN_STATUSES"]

# Statuses that are allowed to authenticate. Everything else is refused with an
# explicit reason rather than a generic credential failure.
ACTIVE_LOGIN_STATUSES = frozenset({UserStatus.ACTIVE, UserStatus.PENDING_VERIFICATION})
