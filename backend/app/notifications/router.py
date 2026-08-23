"""Notification endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_active_user
from app.dependencies.database import get_db
from app.notifications import service as notifications
from app.notifications.constants import NotificationSeverity, NotificationType
from app.users.model import User

router = APIRouter(prefix="/notifications", tags=["Notifications"])


class NotificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    notification_type: NotificationType
    severity: NotificationSeverity
    title: str
    body: str
    target: dict
    project_id: uuid.UUID | None
    milestone_id: uuid.UUID | None
    is_read: bool
    created_at: datetime


class NotificationPage(BaseModel):
    items: list[NotificationResponse]
    unread: int


@router.get("", response_model=NotificationPage, summary="Your notifications")
def list_notifications(
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    unread_only: bool = Query(default=False),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> NotificationPage:
    items = notifications.list_for_user(
        db, current_user.id, limit=limit, offset=offset, unread_only=unread_only
    )
    return NotificationPage(
        items=[NotificationResponse.model_validate(item) for item in items],
        unread=notifications.count_unread(db, current_user.id),
    )


@router.post("/{notification_id}/read", summary="Mark one as read")
def mark_read(
    notification_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> dict:
    changed = notifications.mark_read(db, current_user.id, notification_id)
    return {"updated": changed, "unread": notifications.count_unread(db, current_user.id)}


@router.post("/read-all", summary="Mark everything as read")
def mark_all_read(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> dict:
    count = notifications.mark_all_read(db, current_user.id)
    return {"updated": count, "unread": 0}
