"""Cancellation and OTP constants."""

from __future__ import annotations

from enum import StrEnum


class CancellationStatus(StrEnum):
    AWAITING_RECEIVER = "AWAITING_RECEIVER"
    CONFIRMED = "CONFIRMED"
    DECLINED = "DECLINED"
    EXPIRED = "EXPIRED"
    WITHDRAWN = "WITHDRAWN"


class OtpPurpose(StrEnum):
    CANCELLATION = "CANCELLATION"
    PHONE_VERIFICATION = "PHONE_VERIFICATION"


class OtpStatus(StrEnum):
    ACTIVE = "ACTIVE"
    CONSUMED = "CONSUMED"
    EXPIRED = "EXPIRED"
    INVALIDATED = "INVALIDATED"


#: Six digits is the familiar length for an SMS code. The security comes from
#: the short expiry, the attempt cap and the rate limit — not from length.
OTP_LENGTH = 6
OTP_TTL_MINUTES = 10
OTP_MAX_ATTEMPTS = 5

#: How many codes one user may request per window, so an attacker cannot force
#: endless regeneration to widen their guessing surface.
OTP_MAX_SENDS_PER_WINDOW = 3
OTP_SEND_WINDOW_MINUTES = 15
