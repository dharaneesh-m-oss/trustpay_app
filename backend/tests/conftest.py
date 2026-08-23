"""Test fixtures.

Tests run against a real PostgreSQL database (`trustpay_test`), not SQLite. The
things most worth testing here — native enums, NUMERIC money, row locks,
ON DELETE behaviour — either do not exist or behave differently in SQLite, so a
SQLite test suite would pass while production broke.

The environment is set before `app` is imported: pydantic-settings reads real
environment variables ahead of the .env file, so this redirects the whole
application at the test database without touching .env.
"""

from __future__ import annotations

import os

os.environ["ENVIRONMENT"] = "test"
os.environ["DATABASE_URL"] = (
    "postgresql+psycopg://trustpay:trustpay_dev_pw@127.0.0.1:5432/trustpay_test"
)
os.environ.setdefault("SECRET_KEY", "test-secret-key-that-is-long-enough-1234567890")
# Keep hashing cheap so the suite is not dominated by bcrypt work factor.
os.environ["BCRYPT_ROUNDS"] = "4"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.config.settings import settings  # noqa: E402
from app.database.registry import Base  # noqa: E402
from app.database.session import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402

API = settings.API_PREFIX


@pytest.fixture(scope="session", autouse=True)
def _schema() -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def _clean_tables():
    """Empty every table between tests.

    TRUNCATE ... CASCADE rather than per-test transactions: the code under test
    commits its own transactions (that is the point of the service layer), so a
    wrapping transaction would not roll them back cleanly.
    """
    yield
    with engine.begin() as connection:
        tables = ", ".join(
            f'"{table.name}"' for table in reversed(Base.metadata.sorted_tables)
        )
        connection.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def registered_user(client: TestClient) -> dict:
    payload = {
        "full_name": "Asha Menon",
        "email": "asha@example.com",
        "password": "TrustPay2026x",
        "phone": "+919876543210",
    }
    response = client.post(f"{API}/users/register", json=payload)
    assert response.status_code == 201, response.text
    return {**payload, "id": response.json()["id"]}


@pytest.fixture
def session_tokens(client: TestClient, registered_user: dict) -> dict:
    response = client.post(
        f"{API}/auth/login",
        json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def auth_headers(session_tokens: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {session_tokens['access_token']}"}
