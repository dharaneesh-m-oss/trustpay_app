"""Authentication and authorisation dependencies.

`get_current_user` returns a **User**, not an email string. Ownership checks
throughout TrustPay compare `project.client_id == current_user.id`; doing that
against a string identifier would be both fragile and unauthorisable, and every
handler would have to re-query the database anyway.
"""

from __future__ import annotations

from collections.abc import Callable

from fastapi import Depends, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.config.settings import settings
from app.core.constants import UserRole, UserStatus
from app.core.context import RequestContext
from app.core.exceptions import AccountInactiveError, AuthorizationError, InvalidTokenError
from app.dependencies.database import get_db
from app.security.tokens import decode_access_token
from app.users import repository as users_repo
from app.users.model import User

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_PREFIX}/auth/token",
    auto_error=True,
)


def get_request_context(request: Request) -> RequestContext:
    client_host = request.client.host if request.client else None
    return RequestContext(
        ip_address=client_host,
        user_agent=request.headers.get("user-agent"),
    )


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    payload = decode_access_token(token)  # raises InvalidToken / TokenExpired

    user = users_repo.get_by_id(db, payload.user_id)
    if user is None:
        # The token verifies but its subject is gone — a deleted account holding
        # a still-valid token must not authenticate.
        raise InvalidTokenError()

    if user.status in (UserStatus.SUSPENDED, UserStatus.CLOSED):
        raise AccountInactiveError()

    # The role is re-read from the database rather than trusted from the token:
    # an admin demoted two minutes ago must lose admin access immediately, not
    # when their access token happens to expire.
    return user


def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    if current_user.status != UserStatus.ACTIVE:
        raise AccountInactiveError()
    return current_user


def require_roles(*roles: UserRole) -> Callable[[User], User]:
    """Dependency factory for role-gated routes."""
    allowed: frozenset[UserRole] = frozenset(roles)

    def _guard(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed:
            raise AuthorizationError()
        return current_user

    return _guard


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.ADMIN:
        raise AuthorizationError()
    return current_user


__all__ = [
    "oauth2_scheme",
    "get_request_context",
    "get_current_user",
    "get_current_active_user",
    "require_roles",
    "require_admin",
]
