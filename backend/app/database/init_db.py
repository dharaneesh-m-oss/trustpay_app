"""Development-only schema creation.

Alembic owns the schema. This helper exists so a fresh clone can start without
running migrations first; it is refused outside development, because
`create_all` silently ignores drift on an existing database and would let
production diverge from the migration history.
"""

from __future__ import annotations

from app.config.settings import settings
from app.core.logging import get_logger
from app.database.registry import Base
from app.database.session import engine

logger = get_logger(__name__)


def init_db() -> None:
    if settings.ENVIRONMENT not in ("development", "test"):
        raise RuntimeError(
            "init_db() is development-only. Run 'alembic upgrade head' instead."
        )
    Base.metadata.create_all(bind=engine)
    logger.info("schema_created", tables=len(Base.metadata.tables))
