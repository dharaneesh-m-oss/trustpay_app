"""Notification creation and reading.

`create()` stages a row on the caller's session and does not commit. A
notification saying "payment released" must not exist unless the payment
actually committed, so it rides the same transaction as the event it describes.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.notifications.constants import NotificationSeverity, NotificationType
from app.notifications.model import Notification


def create(
    db: Session,
    *,
    user_id: uuid.UUID | None,
    notification_type: NotificationType,
    title: str,
    body: str,
    target: dict | None = None,
    project_id: uuid.UUID | None = None,
    milestone_id: uuid.UUID | None = None,
    severity: NotificationSeverity = NotificationSeverity.INFO,
) -> Notification | None:
    # A project without a receiver has nobody to notify yet; that is normal
    # rather than an error.
    if user_id is None:
        return None

    notification = Notification(
        user_id=user_id,
        notification_type=notification_type,
        title=title[:120],
        body=body,
        target=target or {},
        project_id=project_id,
        milestone_id=milestone_id,
        severity=severity,
    )
    db.add(notification)
    return notification


def list_for_user(
    db: Session,
    user_id: uuid.UUID,
    *,
    limit: int = 30,
    offset: int = 0,
    unread_only: bool = False,
) -> list[Notification]:
    query = select(Notification).where(Notification.user_id == user_id)
    if unread_only:
        query = query.where(Notification.is_read.is_(False))
    return list(
        db.scalars(
            query.order_by(Notification.created_at.desc()).limit(limit).offset(offset)
        ).all()
    )


def count_unread(db: Session, user_id: uuid.UUID) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user_id, Notification.is_read.is_(False))
        )
        or 0
    )


def mark_read(db: Session, user_id: uuid.UUID, notification_id: uuid.UUID) -> bool:
    """Scoped to the owner: marking someone else's notification read is not a
    permitted operation, so the user id is part of the WHERE clause."""
    result = db.execute(
        update(Notification)
        .where(
            Notification.id == notification_id,
            Notification.user_id == user_id,
            Notification.is_read.is_(False),
        )
        .values(is_read=True, read_at=datetime.now(UTC))
    )
    db.commit()
    return bool(result.rowcount)


def mark_all_read(db: Session, user_id: uuid.UUID) -> int:
    result = db.execute(
        update(Notification)
        .where(Notification.user_id == user_id, Notification.is_read.is_(False))
        .values(is_read=True, read_at=datetime.now(UTC))
    )
    db.commit()
    return int(result.rowcount or 0)
