"""Engine and session factory."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config.settings import settings

def _through_a_pooler(url: str) -> bool:
    """Is this connection going through a transaction-mode connection pooler?

    Supabase's transaction pooler (port 6543) and PgBouncer in transaction mode
    hand each statement to whichever backend is free, so a prepared statement
    created on one connection is not there on the next. psycopg 3 prepares
    statements automatically after a few repeats, which means such a deployment
    works perfectly until it suddenly does not - `prepared statement "_pg3_0"
    does not exist`, some minutes in, under load.
    """
    lowered = url.lower()
    return ":6543/" in lowered or "pgbouncer=true" in lowered


_connect_args: dict[str, object] = {}
if _through_a_pooler(settings.DATABASE_URL):
    # Never prepare, so there is nothing to lose between statements.
    _connect_args["prepare_threshold"] = None

engine = create_engine(
    settings.DATABASE_URL,
    echo=settings.DB_ECHO,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_pre_ping=True,   # a connection killed by the DB is replaced, not raised
    future=True,
    connect_args=_connect_args,
)

SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,  # response models can still read attributes post-commit
    class_=Session,
)


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional scope for code outside the request cycle (seeds, jobs, tests)."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
