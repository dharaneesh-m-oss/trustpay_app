"""Audit recording.

`record()` stages the row on the caller's session but does not commit. The audit
entry and the change it describes therefore share one transaction: either both
land or neither does.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.audit.model import AuditLog
from app.core.constants import AuditAction

# Keys that must never reach the audit table even if a caller passes them.
_REDACTED_KEYS = frozenset(
    {
        "password",
        "current_password",
        "new_password",
        "password_hash",
        "token",
        "access_token",
        "refresh_token",
        "otp",
        "otp_code",
        "secret",
        "authorization",
    }
)


def _sanitize(context: dict[str, Any] | None) -> dict[str, Any]:
    if not context:
        return {}
    return {
        key: ("[REDACTED]" if key.lower() in _REDACTED_KEYS else value)
        for key, value in context.items()
    }


def record(
    db: Session,
    *,
    action: AuditAction | str,
    actor_user_id: uuid.UUID | None = None,
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
    context: dict[str, Any] | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> AuditLog:
    entry = AuditLog(
        actor_user_id=actor_user_id,
        action=str(action),
        entity_type=entity_type,
        entity_id=entity_id,
        context=_sanitize(context),
        ip_address=ip_address,
        user_agent=(user_agent or "")[:255] or None,
    )
    db.add(entry)
    return entry
