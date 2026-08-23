"""Authentication business logic.

Three operations, each owning one transaction: login, refresh, logout.

The refresh design is rotation with reuse detection. Every refresh consumes the
presented token and issues a new one in the same family. Presenting a token that
was already consumed means the credential exists in two places — a leak — so the
entire family is revoked and the client is forced to sign in again.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.audit import service as audit
from app.auth import repository as auth_repo
from app.auth.exceptions import (
    AccountLockedOutError,
    AccountNotActiveError,
    InvalidCredentialsError,
    InvalidRefreshTokenError,
    RefreshTokenReuseError,
)
from app.auth.model import RefreshToken
from app.config.settings import settings
from app.core.constants import AuditAction, UserRole, UserStatus
from app.core.context import RequestContext
from app.core.identifiers import new_uuid
from app.core.logging import get_logger
from app.security.password import dummy_verify, verify_password
from app.security.tokens import (
    create_access_token,
    create_refresh_token,
    hash_refresh_token,
)
from app.users import repository as users_repo
from app.users.model import User

logger = get_logger(__name__)


class IssuedSession:
    """The pair of credentials handed to a client after login or refresh."""

    __slots__ = ("access_token", "refresh_token", "expires_in", "user")

    def __init__(
        self, access_token: str, refresh_token: str, expires_in: int, user: User
    ) -> None:
        self.access_token = access_token
        self.refresh_token = refresh_token
        self.expires_in = expires_in
        self.user = user


def _now() -> datetime:
    return datetime.now(UTC)


def _issue_session(
    db: Session,
    user: User,
    *,
    family_id: uuid.UUID,
    context: RequestContext,
) -> IssuedSession:
    access = create_access_token(user.id, user.role.value)
    refresh = create_refresh_token()

    auth_repo.add(
        db,
        RefreshToken(
            user_id=user.id,
            token_hash=refresh.token_hash,
            family_id=family_id,
            expires_at=refresh.expires_at,
            user_agent=(context.user_agent or "")[:255] or None,
            ip_address=context.ip_address,
        ),
    )

    return IssuedSession(
        access_token=access.token,
        refresh_token=refresh.raw,
        expires_in=access.expires_in,
        user=user,
    )


def _assert_can_authenticate(user: User, now: datetime) -> None:
    if user.locked_until and user.locked_until > now:
        raise AccountLockedOutError()

    if user.status in (UserStatus.SUSPENDED, UserStatus.CLOSED):
        raise AccountNotActiveError()


def login(
    db: Session,
    email: str,
    password: str,
    context: RequestContext | None = None,
) -> IssuedSession:
    context = context or RequestContext()
    now = _now()

    user = users_repo.get_by_email(db, email)

    if user is None:
        # Spend comparable time so response latency does not reveal whether the
        # address exists, then fail with the same error a wrong password gives.
        dummy_verify()
        audit.record(
            db,
            action=AuditAction.USER_LOGIN_FAILED,
            context={"email": email.strip().lower(), "reason": "unknown_email"},
            ip_address=context.ip_address,
            user_agent=context.user_agent,
        )
        db.commit()
        raise InvalidCredentialsError()

    # Re-read under a row lock: concurrent attempts must serialise on the
    # failed-attempt counter rather than racing it.
    locked_user = users_repo.get_for_update(db, user.id) or user

    _assert_can_authenticate(locked_user, now)

    if not verify_password(password, locked_user.password_hash):
        locked_user.failed_login_attempts += 1
        reason = "wrong_password"

        if locked_user.failed_login_attempts >= settings.MAX_FAILED_LOGIN_ATTEMPTS:
            locked_user.locked_until = now + timedelta(
                minutes=settings.ACCOUNT_LOCKOUT_MINUTES
            )
            locked_user.failed_login_attempts = 0
            reason = "locked_out"
            audit.record(
                db,
                action=AuditAction.USER_LOCKED_OUT,
                actor_user_id=locked_user.id,
                entity_type="user",
                entity_id=locked_user.id,
                context={"until": locked_user.locked_until.isoformat()},
                ip_address=context.ip_address,
                user_agent=context.user_agent,
            )

        audit.record(
            db,
            action=AuditAction.USER_LOGIN_FAILED,
            actor_user_id=locked_user.id,
            entity_type="user",
            entity_id=locked_user.id,
            context={"reason": reason},
            ip_address=context.ip_address,
            user_agent=context.user_agent,
        )
        db.commit()

        if reason == "locked_out":
            raise AccountLockedOutError()
        raise InvalidCredentialsError()

    locked_user.failed_login_attempts = 0
    locked_user.locked_until = None
    locked_user.last_login_at = now

    session = _issue_session(
        db, locked_user, family_id=new_uuid(), context=context
    )

    audit.record(
        db,
        action=AuditAction.USER_LOGIN_SUCCEEDED,
        actor_user_id=locked_user.id,
        entity_type="user",
        entity_id=locked_user.id,
        ip_address=context.ip_address,
        user_agent=context.user_agent,
    )
    db.commit()
    return session


def refresh_session(
    db: Session,
    raw_refresh_token: str,
    context: RequestContext | None = None,
) -> IssuedSession:
    context = context or RequestContext()
    now = _now()

    token_hash = hash_refresh_token(raw_refresh_token)
    stored = auth_repo.get_by_hash_for_update(db, token_hash)

    if stored is None:
        raise InvalidRefreshTokenError()

    if stored.rotated_at is not None or stored.revoked_at is not None:
        # This token was already exchanged or explicitly revoked, yet someone
        # still holds it. Assume compromise and end the whole family.
        revoked = auth_repo.revoke_family(
            db, stored.family_id, reason="reuse_detected", now=now
        )
        audit.record(
            db,
            action=AuditAction.TOKEN_REUSE_DETECTED,
            actor_user_id=stored.user_id,
            entity_type="refresh_token_family",
            entity_id=stored.family_id,
            context={"tokens_revoked": revoked},
            ip_address=context.ip_address,
            user_agent=context.user_agent,
        )
        db.commit()
        logger.warning(
            "refresh_token_reuse_detected",
            user_id=str(stored.user_id),
            family_id=str(stored.family_id),
        )
        raise RefreshTokenReuseError()

    if stored.expires_at <= now:
        raise InvalidRefreshTokenError()

    user = users_repo.get_by_id(db, stored.user_id)
    if user is None:
        raise InvalidRefreshTokenError()

    _assert_can_authenticate(user, now)

    stored.rotated_at = now

    session = _issue_session(db, user, family_id=stored.family_id, context=context)

    audit.record(
        db,
        action=AuditAction.TOKEN_REFRESHED,
        actor_user_id=user.id,
        entity_type="refresh_token_family",
        entity_id=stored.family_id,
        ip_address=context.ip_address,
        user_agent=context.user_agent,
    )
    db.commit()
    return session


def logout(
    db: Session,
    user: User,
    *,
    raw_refresh_token: str | None,
    all_sessions: bool,
    context: RequestContext | None = None,
) -> int:
    """Revoke the presented session, or every session for the user."""
    context = context or RequestContext()
    now = _now()

    if all_sessions:
        revoked = auth_repo.revoke_all_for_user(
            db, user.id, reason="logout_all", now=now
        )
    elif raw_refresh_token:
        stored = auth_repo.get_by_hash(db, hash_refresh_token(raw_refresh_token))
        # Only the owner of a token may revoke it; a token belonging to someone
        # else is treated as absent rather than revoked.
        if stored is None or stored.user_id != user.id:
            revoked = 0
        else:
            revoked = auth_repo.revoke_family(
                db, stored.family_id, reason="logout", now=now
            )
    else:
        revoked = 0

    audit.record(
        db,
        action=AuditAction.USER_LOGGED_OUT,
        actor_user_id=user.id,
        entity_type="user",
        entity_id=user.id,
        context={"all_sessions": all_sessions, "tokens_revoked": revoked},
        ip_address=context.ip_address,
        user_agent=context.user_agent,
    )
    db.commit()
    return revoked


def sign_in_with_google(
    db: Session,
    id_token: str,
    *,
    context: RequestContext | None = None,
) -> IssuedSession:
    """Sign in, or create an account, from a verified Google identity.

    The matching order is deliberate and is the security-relevant part:

    1. **By Google subject.** The stable id. A returning user is found here.
    2. **By email, and only then linked.** Someone who registered with a
       password and later taps "Continue with Google" should land in their own
       account, not a second one. Linking is safe *only* because
       `verify_id_token` has already refused any token whose email Google has
       not verified - without that check this branch would be an account
       takeover: claim the email, get the account.
    3. **Otherwise create one**, with no password at all rather than a random
       one nobody can use.

    An account is never created here for a suspended or closed user, and an
    existing locked account is not unlocked by arriving through Google.
    """
    from app.auth.google import verify_id_token

    context = context or RequestContext()
    identity = verify_id_token(id_token)
    now = _now()

    user = users_repo.get_by_google_subject(db, identity.subject)
    created = False

    if user is None:
        existing = users_repo.get_by_email(db, identity.email)
        if existing is not None:
            _assert_can_authenticate(existing, now)
            existing.google_subject = identity.subject
            if not existing.email_verified_at:
                existing.email_verified_at = now
            if identity.picture and not existing.avatar_url:
                existing.avatar_url = identity.picture
            user = existing
        else:
            user = User(
                full_name=identity.full_name,
                email=identity.email,
                password_hash=None,
                google_subject=identity.subject,
                avatar_url=identity.picture,
                role=UserRole.USER,
                status=UserStatus.ACTIVE,
                email_verified_at=now,
            )
            db.add(user)
            db.flush()
            created = True

            # Same post-registration work the password path does, so an account
            # created through Google is not a second-class one.
            from app.projects.invitations import claim_pending_invitations
            from app.wallet.service import create_wallet_for_user

            create_wallet_for_user(db, user)
            claim_pending_invitations(db, user)
    else:
        _assert_can_authenticate(user, now)

    user.last_login_at = now
    user.failed_login_attempts = 0

    session = _issue_session(
        db, user, family_id=new_uuid(), context=context
    )

    audit.record(
        db,
        action=AuditAction.USER_REGISTERED if created else AuditAction.USER_LOGGED_IN,
        actor_user_id=user.id,
        entity_type="user",
        entity_id=user.id,
        context={"method": "google", "created": created},
        ip_address=context.ip_address,
        user_agent=context.user_agent,
    )
    db.commit()

    logger.info(
        "google_sign_in user_id=%s created=%s", user.id, created
    )
    return session
