"""Token issuing and verification.

Two different mechanisms, on purpose:

* The **access token** is a short-lived signed JWT. It is self-contained so that
  authorising a request costs no database round trip.
* The **refresh token** is an opaque random string, stored only as a SHA-256
  digest. A JWT refresh token cannot be revoked without a denylist anyway, and a
  database leak of opaque digests yields nothing usable — whereas leaked JWTs
  would be replayable until expiry.

Refresh tokens are rotated on every use and carry a family id, so replaying a
token that was already exchanged is detectable (see auth/service.py).
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt

from app.config.settings import settings
from app.core.exceptions import InvalidTokenError, TokenExpiredError

TOKEN_ISSUER = "trustpay"
ACCESS_TOKEN_TYPE = "access"

_REFRESH_TOKEN_BYTES = 48


@dataclass(frozen=True, slots=True)
class AccessTokenPayload:
    user_id: uuid.UUID
    role: str
    jti: str
    issued_at: datetime
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class IssuedAccessToken:
    token: str
    expires_at: datetime
    expires_in: int


@dataclass(frozen=True, slots=True)
class IssuedRefreshToken:
    """`raw` is returned to the client exactly once and never persisted."""

    raw: str
    token_hash: str
    expires_at: datetime


def _now() -> datetime:
    return datetime.now(UTC)


def create_access_token(user_id: uuid.UUID, role: str) -> IssuedAccessToken:
    issued_at = _now()
    expires_at = issued_at + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    claims = {
        "sub": str(user_id),
        "role": role,
        "typ": ACCESS_TOKEN_TYPE,
        "jti": secrets.token_urlsafe(16),
        "iss": TOKEN_ISSUER,
        "iat": int(issued_at.timestamp()),
        "exp": int(expires_at.timestamp()),
    }

    token = jwt.encode(claims, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return IssuedAccessToken(
        token=token,
        expires_at=expires_at,
        expires_in=settings.access_token_ttl_seconds,
    )


def decode_access_token(token: str) -> AccessTokenPayload:
    """Verify signature, expiry, issuer and token type.

    `algorithms` is pinned to the configured algorithm so a token whose header
    claims `alg: none` — or a different algorithm entirely — is rejected rather
    than trusted.
    """
    try:
        claims = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
            issuer=TOKEN_ISSUER,
            options={"require": ["exp", "iat", "sub", "iss"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenExpiredError() from exc
    except jwt.InvalidTokenError as exc:
        raise InvalidTokenError() from exc

    if claims.get("typ") != ACCESS_TOKEN_TYPE:
        # A refresh token must never be usable as a bearer credential.
        raise InvalidTokenError()

    try:
        user_id = uuid.UUID(str(claims["sub"]))
    except (KeyError, ValueError) as exc:
        raise InvalidTokenError() from exc

    return AccessTokenPayload(
        user_id=user_id,
        role=str(claims.get("role", "")),
        jti=str(claims.get("jti", "")),
        issued_at=datetime.fromtimestamp(claims["iat"], tz=UTC),
        expires_at=datetime.fromtimestamp(claims["exp"], tz=UTC),
    )


def hash_refresh_token(raw_token: str) -> str:
    """SHA-256 is correct here — the input is 384 bits of CSPRNG output, so it
    has no guessable structure for a slow KDF to protect."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def compare_token_hash(candidate_hash: str, stored_hash: str) -> bool:
    return hmac.compare_digest(candidate_hash, stored_hash)


def create_refresh_token() -> IssuedRefreshToken:
    raw = secrets.token_urlsafe(_REFRESH_TOKEN_BYTES)
    return IssuedRefreshToken(
        raw=raw,
        token_hash=hash_refresh_token(raw),
        expires_at=_now() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
