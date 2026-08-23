"""Profile, email change and password change."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config.settings import settings
from app.audit.model import AuditLog
from app.users.model import User

API = settings.API_PREFIX


def test_update_profile(client: TestClient, auth_headers) -> None:
    response = client.put(
        f"{API}/users/me",
        json={"full_name": "Asha  R  Menon", "phone": "+919812345678"},
        headers=auth_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["full_name"] == "Asha R Menon"  # whitespace collapsed
    assert body["phone"] == "+919812345678"


def test_changing_phone_clears_its_verification(
    client: TestClient, auth_headers, registered_user, db
) -> None:
    user = db.scalar(select(User).where(User.email == registered_user["email"]))
    from datetime import UTC, datetime

    user.phone_verified_at = datetime.now(UTC)
    db.commit()

    client.put(
        f"{API}/users/me",
        json={"full_name": "Asha Menon", "phone": "+919800000000"},
        headers=auth_headers,
    )

    db.expire_all()
    user = db.scalar(select(User).where(User.email == registered_user["email"]))
    assert user.phone_verified_at is None


def test_phone_must_be_unique(client: TestClient, auth_headers) -> None:
    client.post(
        f"{API}/users/register",
        json={
            "full_name": "Second Person",
            "email": "second@example.com",
            "password": "TrustPay2026x",
            "phone": "+919000000001",
        },
    )

    response = client.put(
        f"{API}/users/me",
        json={"full_name": "Asha Menon", "phone": "+919000000001"},
        headers=auth_headers,
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "PHONE_ALREADY_REGISTERED"


def test_profile_update_cannot_change_email(client: TestClient, auth_headers, registered_user) -> None:
    """The email field is not part of the profile contract; sending it is ignored."""
    response = client.put(
        f"{API}/users/me",
        json={"full_name": "Asha Menon", "email": "attacker@example.com"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["email"] == registered_user["email"]


def test_change_email_requires_current_password(
    client: TestClient, auth_headers
) -> None:
    response = client.post(
        f"{API}/users/me/email",
        json={"new_email": "new@example.com", "current_password": "WrongPassword1"},
        headers=auth_headers,
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INCORRECT_PASSWORD"


def test_change_email_succeeds_and_unverifies(
    client: TestClient, auth_headers, registered_user
) -> None:
    response = client.post(
        f"{API}/users/me/email",
        json={
            "new_email": "Asha.New@Example.com",
            "current_password": registered_user["password"],
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert response.json()["email"] == "asha.new@example.com"
    assert response.json()["email_verified_at"] is None

    # The new address signs in; the old one no longer does.
    assert (
        client.post(
            f"{API}/auth/login",
            json={
                "email": "asha.new@example.com",
                "password": registered_user["password"],
            },
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"{API}/auth/login",
            json={
                "email": registered_user["email"],
                "password": registered_user["password"],
            },
        ).status_code
        == 401
    )


def test_change_email_rejects_an_address_in_use(
    client: TestClient, auth_headers, registered_user
) -> None:
    client.post(
        f"{API}/users/register",
        json={
            "full_name": "Taken Person",
            "email": "taken@example.com",
            "password": "TrustPay2026x",
        },
    )

    response = client.post(
        f"{API}/users/me/email",
        json={
            "new_email": "taken@example.com",
            "current_password": registered_user["password"],
        },
        headers=auth_headers,
    )
    assert response.status_code == 409


def test_change_password_requires_the_current_one(
    client: TestClient, auth_headers
) -> None:
    response = client.post(
        f"{API}/users/me/password",
        json={"current_password": "WrongPassword1", "new_password": "NewTrustPay99"},
        headers=auth_headers,
    )
    assert response.status_code == 400


def test_change_password_signs_out_every_session(
    client: TestClient, registered_user, session_tokens, auth_headers, db
) -> None:
    # A second device is signed in as well.
    other_device = client.post(
        f"{API}/auth/login",
        json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        },
    ).json()

    response = client.post(
        f"{API}/users/me/password",
        json={
            "current_password": registered_user["password"],
            "new_password": "NewTrustPay99",
        },
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert "2 active session(s)" in response.json()["message"]

    # Neither device can refresh any more.
    for token in (session_tokens["refresh_token"], other_device["refresh_token"]):
        assert (
            client.post(f"{API}/auth/refresh", json={"refresh_token": token}).status_code
            == 401
        )

    # The new password works; the old one does not.
    assert (
        client.post(
            f"{API}/auth/login",
            json={"email": registered_user["email"], "password": "NewTrustPay99"},
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"{API}/auth/login",
            json={
                "email": registered_user["email"],
                "password": registered_user["password"],
            },
        ).status_code
        == 401
    )


def test_audit_trail_records_the_account_lifecycle(
    client: TestClient, auth_headers, registered_user, db
) -> None:
    client.put(
        f"{API}/users/me",
        json={"full_name": "Asha Menon Updated", "phone": None},
        headers=auth_headers,
    )

    actions = db.scalars(select(AuditLog.action)).all()
    assert "USER_REGISTERED" in actions
    assert "USER_LOGIN_SUCCEEDED" in actions
    assert "USER_PROFILE_UPDATED" in actions


def test_audit_context_never_stores_a_password(
    client: TestClient, registered_user, db
) -> None:
    entries = db.scalars(select(AuditLog)).all()
    serialised = str([entry.context for entry in entries])
    assert registered_user["password"] not in serialised
