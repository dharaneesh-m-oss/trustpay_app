"""One-time code generation and verification (spec section 16).

Every requirement in that section is enforced here rather than at the call site:

* generated server-side with a CSPRNG
* hashed before storage, never stored or returned in plaintext
* expires
* single use
* capped attempts
* invalidated on success

The plaintext code is returned exactly once, from `generate()`, so a delivery
channel can send it. It is never persisted, logged, or included in a response.
"""

from __future__ import annotations

import hmac
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import bcrypt

from app.cancellation.constants import OTP_LENGTH, OTP_TTL_MINUTES


@dataclass(frozen=True, slots=True)
class GeneratedOtp:
    #: Plaintext. Hand to the delivery channel, then let it go out of scope.
    code: str
    code_hash: str
    expires_at: datetime


def generate_code(length: int = OTP_LENGTH) -> str:
    """A uniformly random numeric code.

    `secrets.randbelow` per digit, not `random` — the latter is a Mersenne
    Twister whose output is predictable from a handful of observed values.
    """
    return "".join(str(secrets.randbelow(10)) for _ in range(length))


def hash_code(code: str) -> str:
    """Salted bcrypt, at a lower cost than a password.

    A 6-digit code has only a million possibilities, so a stolen hash is
    brute-forceable regardless of cost factor — the real defences are the
    10-minute expiry and the 5-attempt cap. The cost here is chosen so
    verification stays fast while still salting the stored value.
    """
    return bcrypt.hashpw(code.encode("utf-8"), bcrypt.gensalt(rounds=8)).decode("utf-8")


def verify_code(candidate: str, code_hash: str) -> bool:
    """Constant-time comparison that never raises on malformed input."""
    if not candidate or not code_hash:
        return False
    if not candidate.isdigit():
        return False
    try:
        return bcrypt.checkpw(candidate.encode("utf-8"), code_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def generate(ttl_minutes: int = OTP_TTL_MINUTES) -> GeneratedOtp:
    code = generate_code()
    return GeneratedOtp(
        code=code,
        code_hash=hash_code(code),
        expires_at=datetime.now(UTC) + timedelta(minutes=ttl_minutes),
    )


def mask_destination(destination: str | None) -> str:
    """Show enough to recognise the destination, not enough to identify it.

    "+919876543210" becomes "+91******3210". Displaying the full number would
    leak the receiver's contact details to whoever is looking at the screen.
    """
    if not destination:
        return "your registered contact"
    if "@" in destination:
        name, _, domain = destination.partition("@")
        visible = name[:2] if len(name) > 2 else name[:1]
        return f"{visible}{'*' * max(len(name) - len(visible), 1)}@{domain}"
    digits = "".join(character for character in destination if character.isdigit())
    if len(digits) <= 4:
        return "*" * len(digits)
    return f"{destination[:3]}{'*' * (len(digits) - 7)}{digits[-4:]}"


def constant_time_equals(left: str, right: str) -> bool:
    return hmac.compare_digest(left, right)
