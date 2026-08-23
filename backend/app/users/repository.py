"""User persistence.

Repositories read and stage writes. They never commit — the service layer owns
the transaction boundary, because a single business operation (release a
payment, write two ledger entries, update a milestone, log an audit row) must
commit exactly once, atomically.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.users.model import User


def get_by_id(db: Session, user_id: uuid.UUID) -> User | None:
    return db.get(User, user_id)


def get_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email.strip().lower()))


def get_by_phone(db: Session, phone: str) -> User | None:
    return db.scalar(select(User).where(User.phone == phone))


def get_by_google_subject(db: Session, subject: str) -> User | None:
    """Google's `sub` is the stable identifier; an email can be reassigned."""
    if not subject:
        return None
    return db.scalar(select(User).where(User.google_subject == subject))


def get_for_update(db: Session, user_id: uuid.UUID) -> User | None:
    """Read the row with a write lock held until the transaction ends.

    Used by the login path so two concurrent attempts cannot both read the same
    failed-attempt counter and then overwrite each other's increment.

    `populate_existing` forces the ORM to refresh from the locked row. The login
    path has already loaded this user by email, so without it the session would
    return the cached instance with its pre-lock `failed_login_attempts` and the
    lock would protect nothing.
    """
    return db.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def add(db: Session, user: User) -> User:
    db.add(user)
    db.flush()  # assigns defaults and surfaces constraint violations now
    return user
