"""Refresh token persistence."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.auth.model import RefreshToken


def add(db: Session, token: RefreshToken) -> RefreshToken:
    db.add(token)
    db.flush()
    return token


def get_by_hash(db: Session, token_hash: str) -> RefreshToken | None:
    return db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    )


def get_by_hash_for_update(db: Session, token_hash: str) -> RefreshToken | None:
    """Lock the row so two concurrent refreshes cannot both rotate one token.

    Without the lock, a double-tap from a flaky mobile connection could mint two
    valid token families from a single credential.
    """
    return db.scalar(
        select(RefreshToken)
        .where(RefreshToken.token_hash == token_hash)
        .with_for_update()
    )


def revoke_family(
    db: Session, family_id: uuid.UUID, *, reason: str, now: datetime
) -> int:
    """Revoke every live token descended from one login."""
    result = db.execute(
        update(RefreshToken)
        .where(
            RefreshToken.family_id == family_id,
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=now, revoked_reason=reason)
    )
    return int(result.rowcount or 0)


def revoke_all_for_user(
    db: Session, user_id: uuid.UUID, *, reason: str, now: datetime
) -> int:
    result = db.execute(
        update(RefreshToken)
        .where(
            RefreshToken.user_id == user_id,
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=now, revoked_reason=reason)
    )
    return int(result.rowcount or 0)


def count_active_sessions(db: Session, user_id: uuid.UUID, *, now: datetime) -> int:
    rows = db.scalars(
        select(RefreshToken.id).where(
            RefreshToken.user_id == user_id,
            RefreshToken.revoked_at.is_(None),
            RefreshToken.rotated_at.is_(None),
            RefreshToken.expires_at > now,
        )
    ).all()
    return len(rows)
