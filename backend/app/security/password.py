"""Password hashing and policy.

We call the `bcrypt` library directly. passlib is deliberately not used: it
reads `bcrypt.__about__`, an attribute removed in bcrypt 4.1, so the
passlib+bcrypt pairing in the original requirements.txt raises on the first
hash it ever computes.
"""

from __future__ import annotations

import bcrypt

from app.config.settings import settings
from app.core.exceptions import ValidationError


def validate_password_policy(password: str) -> None:
    """Raise ValidationError if the password is unusable or too weak.

    The byte-length ceiling is not arbitrary: bcrypt only considers the first 72
    bytes. Accepting a longer password would silently ignore the remainder and
    give the user false confidence in a long passphrase.
    """
    if not password:
        raise ValidationError("Password is required.")

    encoded = password.encode("utf-8")

    if len(password) < settings.PASSWORD_MIN_LENGTH:
        raise ValidationError(
            f"Password must be at least {settings.PASSWORD_MIN_LENGTH} characters."
        )

    if len(encoded) > settings.PASSWORD_MAX_BYTES:
        raise ValidationError(
            f"Password must be at most {settings.PASSWORD_MAX_BYTES} bytes long."
        )

    if "\x00" in password:
        raise ValidationError("Password must not contain a null character.")

    if not any(c.isalpha() for c in password) or not any(c.isdigit() for c in password):
        raise ValidationError("Password must contain both letters and numbers.")


def hash_password(password: str) -> str:
    validate_password_policy(password)
    salt = bcrypt.gensalt(rounds=settings.BCRYPT_ROUNDS)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain_password: str, password_hash: str) -> bool:
    """Constant-time verification that never raises on malformed input.

    A malformed stored hash must read as "wrong password", not as a 500 that
    tells an attacker something about the account.
    """
    if not plain_password or not password_hash:
        return False
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"), password_hash.encode("utf-8")
        )
    except (ValueError, TypeError):
        return False


_DUMMY_HASH = b"$2b$12$R2gC6PfrCwe3nUGzoiAw0uK7ySHC09bVy8FfZnt7uVjcPwvVwiEM."


def dummy_verify() -> None:
    """Burn a comparable amount of time when the account does not exist.

    Without this, "unknown email" returns measurably faster than "wrong
    password", which turns the login endpoint into an account enumeration
    oracle.
    """
    try:
        bcrypt.checkpw(b"trustpay-timing-equalizer", _DUMMY_HASH)
    except (ValueError, TypeError):  # pragma: no cover - defensive
        pass
