"""Request-scoped database session.

The session is closed after every request, and rolled back if the handler
raised. A half-applied financial mutation must never survive an exception
(spec section 13).
"""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy.orm import Session

from app.database.session import SessionLocal


def get_db() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
