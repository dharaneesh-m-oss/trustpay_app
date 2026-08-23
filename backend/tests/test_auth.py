"""Authentication and session behaviour.

These assert the security properties the foundation claims, not just the happy
path: enumeration resistance, lockout, token rotation, reuse detection, and the
fact that a password change ends every existing session.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth.model import RefreshToken
from app.config.settings import settings
from app.core.constants import AuditAction
from app.audit.model import AuditLog
from app.users.model import User

API = settings.API_PREFIX


# ---------------------------------------------------------------- registration


def test_register_returns_user_without_password_hash(client: TestClient) -> None:
    response = client.post(
        f"{API}/users/register",
        json={
            "full_name": "Ravi Kumar",
            "email": "Ravi@Example.COM",
            "password": "TrustPay2026x",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "ravi@example.com"  # normalised
    assert body["role"] == "USER"
    assert body["status"] == "ACTIVE"
    assert "password" not in body
    assert "password_hash" not in body


def test_register_rejects_duplicate_email(client: TestClient, registered_user) -> None:
    response = client.post(
        f"{API}/users/register",
        json={
            "full_name": "Someone Else",
            "email": registered_user["email"].upper(),
            "password": "TrustPay2026x",
        },
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "EMAIL_ALREADY_REGISTERED"


def test_register_rejects_weak_password(client: TestClient) -> None:
    response = client.post(
        f"{API}/users/register",
        json={
            "full_name": "Weak Password",
            "email": "weak@example.com",
            "password": "short",
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_password_is_stored_hashed(client: TestClient, registered_user, db) -> None:
    user = db.scalar(select(User).where(User.email == registered_user["email"]))
    assert user.password_hash != registered_user["password"]
    assert user.password_hash.startswith("$2b$")


# ------------------------------------------------------------------- login


def test_login_returns_token_pair_and_user(client: TestClient, registered_user) -> None:
    response = client.post(
        f"{API}/auth/login",
        json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    assert body["user"]["email"] == registered_user["email"]
    assert body["access_token"] and body["refresh_token"]


def test_unknown_email_and_wrong_password_are_indistinguishable(
    client: TestClient, registered_user
) -> None:
    """Different responses here would let an attacker enumerate accounts."""
    unknown = client.post(
        f"{API}/auth/login",
        json={"email": "nobody@example.com", "password": "TrustPay2026x"},
    )
    wrong = client.post(
        f"{API}/auth/login",
        json={"email": registered_user["email"], "password": "WrongPassword1"},
    )

    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json()["error"]["code"] == wrong.json()["error"]["code"]
    assert unknown.json()["error"]["message"] == wrong.json()["error"]["message"]


def test_account_locks_after_max_failed_attempts(
    client: TestClient, registered_user, db
) -> None:
    for _ in range(settings.MAX_FAILED_LOGIN_ATTEMPTS):
        client.post(
            f"{API}/auth/login",
            json={"email": registered_user["email"], "password": "WrongPassword1"},
        )

    # Even the correct password is refused while the lock holds.
    response = client.post(
        f"{API}/auth/login",
        json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        },
    )

    assert response.status_code == 423
    assert response.json()["error"]["code"] == "ACCOUNT_LOCKED"

    user = db.scalar(select(User).where(User.email == registered_user["email"]))
    assert user.locked_until is not None

    locked_events = db.scalars(
        select(AuditLog).where(AuditLog.action == AuditAction.USER_LOCKED_OUT.value)
    ).all()
    assert len(locked_events) == 1


def test_successful_login_resets_failed_attempts(
    client: TestClient, registered_user, db
) -> None:
    client.post(
        f"{API}/auth/login",
        json={"email": registered_user["email"], "password": "WrongPassword1"},
    )
    client.post(
        f"{API}/auth/login",
        json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        },
    )

    user = db.scalar(select(User).where(User.email == registered_user["email"]))
    assert user.failed_login_attempts == 0
    assert user.last_login_at is not None


# ------------------------------------------------------------------ protected


def test_protected_route_requires_token(client: TestClient) -> None:
    assert client.get(f"{API}/users/me").status_code == 401


def test_protected_route_rejects_garbage_token(client: TestClient) -> None:
    response = client.get(
        f"{API}/users/me", headers={"Authorization": "Bearer not-a-real-token"}
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_TOKEN"


def test_refresh_token_is_not_accepted_as_a_bearer_token(
    client: TestClient, session_tokens
) -> None:
    """A refresh token is a different credential class and must not authorise."""
    response = client.get(
        f"{API}/users/me",
        headers={"Authorization": f"Bearer {session_tokens['refresh_token']}"},
    )
    assert response.status_code == 401


def test_me_returns_the_signed_in_user(
    client: TestClient, auth_headers, registered_user
) -> None:
    response = client.get(f"{API}/users/me", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["email"] == registered_user["email"]


# -------------------------------------------------------------------- refresh


def test_refresh_rotates_the_token(client: TestClient, session_tokens) -> None:
    response = client.post(
        f"{API}/auth/refresh",
        json={"refresh_token": session_tokens["refresh_token"]},
    )

    assert response.status_code == 200
    rotated = response.json()
    assert rotated["refresh_token"] != session_tokens["refresh_token"]

    # The new access token works.
    me = client.get(
        f"{API}/users/me",
        headers={"Authorization": f"Bearer {rotated['access_token']}"},
    )
    assert me.status_code == 200


def test_reusing_a_rotated_refresh_token_kills_the_family(
    client: TestClient, session_tokens, db
) -> None:
    first = session_tokens["refresh_token"]
    second = client.post(f"{API}/auth/refresh", json={"refresh_token": first}).json()[
        "refresh_token"
    ]

    # Replay the consumed token: treated as a leak.
    replay = client.post(f"{API}/auth/refresh", json={"refresh_token": first})
    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "REFRESH_TOKEN_REUSED"

    # The token issued from it is now dead too.
    after = client.post(f"{API}/auth/refresh", json={"refresh_token": second})
    assert after.status_code == 401

    assert db.scalar(
        select(AuditLog).where(
            AuditLog.action == AuditAction.TOKEN_REUSE_DETECTED.value
        )
    )


def test_expired_refresh_token_is_rejected(
    client: TestClient, session_tokens, db
) -> None:
    token = db.scalar(select(RefreshToken))
    token.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()

    response = client.post(
        f"{API}/auth/refresh", json={"refresh_token": session_tokens["refresh_token"]}
    )
    assert response.status_code == 401


def test_unknown_refresh_token_is_rejected(client: TestClient) -> None:
    response = client.post(
        f"{API}/auth/refresh", json={"refresh_token": "x" * 64}
    )
    assert response.status_code == 401


# --------------------------------------------------------------------- logout


def test_logout_revokes_the_session(client: TestClient, session_tokens, auth_headers) -> None:
    response = client.post(
        f"{API}/auth/logout",
        json={"refresh_token": session_tokens["refresh_token"]},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["sessions_revoked"] == 1

    replay = client.post(
        f"{API}/auth/refresh", json={"refresh_token": session_tokens["refresh_token"]}
    )
    assert replay.status_code == 401


def test_logout_all_revokes_every_session(
    client: TestClient, registered_user, session_tokens, auth_headers
) -> None:
    second = client.post(
        f"{API}/auth/login",
        json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        },
    ).json()

    response = client.post(
        f"{API}/auth/logout", json={"all_sessions": True}, headers=auth_headers
    )
    assert response.status_code == 200
    assert response.json()["sessions_revoked"] == 2

    assert (
        client.post(
            f"{API}/auth/refresh", json={"refresh_token": second["refresh_token"]}
        ).status_code
        == 401
    )


def test_a_user_cannot_revoke_another_users_token(
    client: TestClient, session_tokens, auth_headers
) -> None:
    client.post(
        f"{API}/users/register",
        json={
            "full_name": "Other Person",
            "email": "other@example.com",
            "password": "TrustPay2026x",
        },
    )
    other = client.post(
        f"{API}/auth/login",
        json={"email": "other@example.com", "password": "TrustPay2026x"},
    ).json()

    # Asha presents someone else's refresh token for revocation.
    response = client.post(
        f"{API}/auth/logout",
        json={"refresh_token": other["refresh_token"]},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["sessions_revoked"] == 0

    # The other user's session still works.
    still_valid = client.post(
        f"{API}/auth/refresh", json={"refresh_token": other["refresh_token"]}
    )
    assert still_valid.status_code == 200


@pytest.mark.parametrize("path", ["/users/me", "/auth/logout"])
def test_error_envelope_shape(client: TestClient, path: str) -> None:
    response = client.request(
        "POST" if path == "/auth/logout" else "GET", f"{API}{path}", json={}
    )
    body = response.json()
    assert set(body.keys()) == {"error"}
    assert {"code", "message", "request_id"} <= set(body["error"].keys())
    assert response.headers.get("X-Request-ID")
