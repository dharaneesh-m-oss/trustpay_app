"""Google Sign-In.

The app sends a Google ID token; this verifies it and returns the identity
inside. What makes it a verification rather than a decoding:

  - **Signature**, against Google's published keys, fetched by the `kid` in the
    token header and cached. Without this, an ID token is just base64 that
    anyone can write.
  - **Audience**, against our own client ids. A validly-signed Google token
    issued to a *different* application is still a valid Google token; accepting
    one lets any developer with a Google client sign in as anybody here.
  - **Issuer and expiry**, which PyJWT enforces once told what to expect.
  - **email_verified**, because an unverified Google email can be an address the
    holder does not control, and this app matches accounts by email.

Skipping any one of those turns "sign in with Google" into "sign in as anyone".
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import jwt
from jwt import PyJWKClient

from app.config.settings import settings

logger = logging.getLogger(__name__)

GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")

# The client caches keys and only refetches when it meets an unknown `kid`,
# which is what makes per-request verification cheap.
_jwk_client = PyJWKClient(GOOGLE_CERTS, cache_keys=True)


class GoogleAuthError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


@dataclass(frozen=True)
class GoogleIdentity:
    subject: str
    email: str
    email_verified: bool
    full_name: str
    picture: str | None


def verify_id_token(id_token: str) -> GoogleIdentity:
    if not settings.google_configured:
        raise GoogleAuthError(
            "Google sign-in is not configured for this deployment."
        )

    if not id_token or id_token.count(".") != 2:
        raise GoogleAuthError("That is not a Google sign-in token.")

    try:
        signing_key = _jwk_client.get_signing_key_from_jwt(id_token)
    except Exception as exc:  # noqa: BLE001 - PyJWK raises several unrelated types
        logger.warning("google_signing_key_lookup_failed error=%s", exc)
        raise GoogleAuthError(
            "Could not check that sign-in with Google. Please try again."
        ) from exc

    try:
        claims = jwt.decode(
            id_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.google_audiences,
            issuer=GOOGLE_ISSUERS,
            options={"require": ["exp", "iat", "aud", "iss", "sub"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise GoogleAuthError("That sign-in expired. Please try again.") from exc
    except jwt.InvalidAudienceError as exc:
        # Almost always a client-id mismatch between app and server rather than
        # an attack, and worth saying so - it is otherwise a silent dead end.
        logger.warning("google_audience_mismatch expected=%s", settings.google_audiences)
        raise GoogleAuthError(
            "This app is not registered for Google sign-in on this server."
        ) from exc
    except jwt.InvalidTokenError as exc:
        logger.warning("google_token_invalid error=%s", exc)
        raise GoogleAuthError("That Google sign-in could not be verified.") from exc

    email = (claims.get("email") or "").strip().lower()
    if not email:
        raise GoogleAuthError("That Google account has no email address.")

    if not claims.get("email_verified", False):
        raise GoogleAuthError(
            "That Google account's email is not verified, so it cannot be used "
            "to sign in here."
        )

    return GoogleIdentity(
        subject=claims["sub"],
        email=email,
        email_verified=True,
        full_name=(claims.get("name") or email.split("@")[0]).strip(),
        picture=claims.get("picture"),
    )
