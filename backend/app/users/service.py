"""User business logic.

Every public function here owns its transaction: it stages work through the
repository, writes an audit row, and commits once. Routers contain no business
rules.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import service as audit
from app.core.constants import AuditAction, UserRole, UserStatus
from app.core.context import RequestContext
from app.security.password import hash_password, verify_password
from app.users import repository as users_repo
from app.users.exceptions import (
    EmailAlreadyRegisteredError,
    IncorrectPasswordError,
    PasswordlessAccountError,
    PhoneAlreadyRegisteredError,
    UserNotFoundError,
)
from app.users.model import User
from app.users.schema import (
    ChangeEmailRequest,
    ChangePasswordRequest,
    UserRegisterRequest,
    UserUpdateRequest,
)


def register_user(
    db: Session,
    payload: UserRegisterRequest,
    context: RequestContext | None = None,
) -> User:
    context = context or RequestContext()

    if users_repo.get_by_email(db, payload.email):
        raise EmailAlreadyRegisteredError()

    if payload.phone and users_repo.get_by_phone(db, payload.phone):
        raise PhoneAlreadyRegisteredError()

    user = User(
        full_name=payload.full_name,
        email=payload.email,
        phone=payload.phone,
        password_hash=hash_password(payload.password),
        role=UserRole.USER,
        status=UserStatus.ACTIVE,
    )

    # Imported here rather than at module scope: both of these import users,
    # so a top-level import in this direction would be circular.
    from app.projects.invitations import claim_pending_invitations
    from app.wallet import service as wallet_service

    try:
        users_repo.add(db, user)

        # "Every user has exactly one wallet" (docs/07_Database_Design.md), so
        # the wallet and its three ledger accounts are created inside this same
        # transaction. A committed user with no wallet is a state the rest of
        # the system has no way to recover from.
        wallet_service.create_wallet_for_user(db, user)

        # A client may have invited this person by email before they had an
        # account. Claim those now, in the same transaction, so the invitation
        # is waiting for them the first time they open the app.
        claimed = claim_pending_invitations(db, user)

        audit.record(
            db,
            action=AuditAction.USER_REGISTERED,
            actor_user_id=user.id,
            entity_type="user",
            entity_id=user.id,
            context={"email": user.email, "invitations_claimed": claimed},
            ip_address=context.ip_address,
            user_agent=context.user_agent,
        )
        db.commit()
    except IntegrityError as exc:
        # Two simultaneous registrations of the same address both pass the
        # pre-check above; the unique index settles it. The loser gets the same
        # message a sequential duplicate would get.
        db.rollback()
        raise EmailAlreadyRegisteredError() from exc

    return user


def get_user(db: Session, user_id: uuid.UUID) -> User:
    user = users_repo.get_by_id(db, user_id)
    if user is None:
        raise UserNotFoundError()
    return user


def update_profile(
    db: Session,
    user: User,
    payload: UserUpdateRequest,
    context: RequestContext | None = None,
) -> User:
    context = context or RequestContext()

    if payload.phone and payload.phone != user.phone:
        existing = users_repo.get_by_phone(db, payload.phone)
        if existing and existing.id != user.id:
            raise PhoneAlreadyRegisteredError()
        # A changed number is unverified until it is verified again.
        user.phone_verified_at = None

    diff = {
        "full_name": (user.full_name, payload.full_name),
        "phone": (user.phone, payload.phone),
    }

    user.full_name = payload.full_name
    user.phone = payload.phone

    audit.record(
        db,
        action=AuditAction.USER_PROFILE_UPDATED,
        actor_user_id=user.id,
        entity_type="user",
        entity_id=user.id,
        context={
            field: {"from": before, "to": after}
            for field, (before, after) in diff.items()
            if before != after
        },
        ip_address=context.ip_address,
        user_agent=context.user_agent,
    )

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise PhoneAlreadyRegisteredError() from exc

    return user


def change_email(
    db: Session,
    user: User,
    payload: ChangeEmailRequest,
    context: RequestContext | None = None,
) -> User:
    """Changing the sign-in address requires proving possession of the password."""
    context = context or RequestContext()

    if not verify_password(payload.current_password, user.password_hash):
        raise IncorrectPasswordError()

    if payload.new_email != user.email:
        existing = users_repo.get_by_email(db, payload.new_email)
        if existing and existing.id != user.id:
            raise EmailAlreadyRegisteredError()

    previous = user.email
    user.email = payload.new_email
    user.email_verified_at = None  # the new address is unproven

    audit.record(
        db,
        action=AuditAction.USER_PROFILE_UPDATED,
        actor_user_id=user.id,
        entity_type="user",
        entity_id=user.id,
        context={"email": {"from": previous, "to": user.email}},
        ip_address=context.ip_address,
        user_agent=context.user_agent,
    )

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise EmailAlreadyRegisteredError() from exc

    return user


def change_password(
    db: Session,
    user: User,
    payload: ChangePasswordRequest,
    context: RequestContext | None = None,
) -> int:
    """Change the password and revoke every existing session.

    If the password was changed because it was compromised, leaving the
    attacker's refresh token alive would defeat the point of changing it.
    Returns the number of sessions revoked.
    """
    context = context or RequestContext()

    if user.password_hash is None:
        raise PasswordlessAccountError()

    if not verify_password(payload.current_password, user.password_hash):
        raise IncorrectPasswordError()

    user.password_hash = hash_password(payload.new_password)
    user.failed_login_attempts = 0
    user.locked_until = None

    # Imported here rather than at module scope: auth imports users, so a
    # top-level import in this direction would be circular.
    from app.auth import repository as auth_repo

    revoked = auth_repo.revoke_all_for_user(
        db, user.id, reason="password_changed", now=datetime.now(UTC)
    )

    audit.record(
        db,
        action=AuditAction.USER_PASSWORD_CHANGED,
        actor_user_id=user.id,
        entity_type="user",
        entity_id=user.id,
        context={"sessions_revoked": revoked},
        ip_address=context.ip_address,
        user_agent=context.user_agent,
    )
    db.commit()
    return revoked
