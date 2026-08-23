"""Bank account and UPI verification.

Three checks, in increasing order of how much they actually prove:

1. **Format.** An IFSC is eleven characters, fifth is always zero. A UPI VPA has
   a handle this side of a set we recognise. Cheap, offline, catches typos.
2. **Existence.** The IFSC is looked up against Razorpay's public registry,
   which needs no credentials and returns the real bank and branch. This is what
   turns "eleven plausible characters" into "State Bank of India, Adyar".
3. **Ownership.** Whether the account actually belongs to this person. That
   cannot be established by any amount of string checking - it needs a penny
   drop through a payout provider, and it is the one check that decides whether
   money reaches the right human.

Only the third one matters for fraud, and only the third one needs money and
credentials to run. Saying that plainly here so nobody reads a green tick from
check 2 as proof of check 3: `verified_owner` stays False until a real penny
drop says otherwise.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

import httpx

# The public IFSC registry. No key, no account, generous rate limits.
IFSC_REGISTRY = "https://ifsc.razorpay.com/{ifsc}"

# Eleven characters: four-letter bank code, a mandatory 0, then the branch.
IFSC_PATTERN = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")

# Indian account numbers vary by bank - 9 to 18 digits covers every scheme in
# use. Anything outside that is a typo, not an unusual bank.
ACCOUNT_PATTERN = re.compile(r"^\d{9,18}$")

# user@handle, where the handle is a PSP. Deliberately permissive on the user
# part because banks allow a lot, and strict on shape.
VPA_PATTERN = re.compile(r"^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z0-9.\-]{1,63}$")


class VerificationError(Exception):
    """A check failed in a way the user can fix."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field
        self.message = message


@dataclass(frozen=True)
class BankDetails:
    ifsc: str
    bank: str
    branch: str
    city: str
    state: str
    supports_upi: bool
    supports_imps: bool
    supports_neft: bool


def normalise_ifsc(raw: str) -> str:
    ifsc = (raw or "").strip().upper().replace(" ", "")
    if not IFSC_PATTERN.match(ifsc):
        raise VerificationError(
            "ifsc",
            "That is not a valid IFSC. It is 11 characters: four letters, a zero, "
            "then six more.",
        )
    return ifsc


def normalise_account_number(raw: str) -> str:
    account = re.sub(r"[\s-]", "", raw or "")
    if not ACCOUNT_PATTERN.match(account):
        raise VerificationError(
            "account_number",
            "Account numbers are 9 to 18 digits. Check for a missing or extra digit.",
        )
    return account


def normalise_vpa(raw: str) -> str:
    vpa = (raw or "").strip().lower()
    if not VPA_PATTERN.match(vpa):
        raise VerificationError(
            "vpa",
            "That is not a valid UPI ID. They look like name@bank.",
        )
    return vpa


async def lookup_ifsc(ifsc: str, *, timeout: float = 8.0) -> BankDetails:
    """Resolve an IFSC to a real bank and branch.

    A lookup failure is reported as a failure rather than waved through. An
    unverifiable IFSC on a payout is how money reaches the wrong branch, and a
    registry being briefly unreachable is a better thing to retry than to
    guess past.
    """
    code = normalise_ifsc(ifsc)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(IFSC_REGISTRY.format(ifsc=code))
    except httpx.HTTPError as exc:
        raise VerificationError(
            "ifsc",
            "Could not reach the bank registry to check that IFSC. Try again in a moment.",
        ) from exc

    if response.status_code == 404:
        raise VerificationError(
            "ifsc", "No bank branch has that IFSC. Check it against your passbook."
        )
    if response.status_code >= 400:
        raise VerificationError(
            "ifsc", "The bank registry could not check that IFSC right now."
        )

    body = response.json()
    return BankDetails(
        ifsc=code,
        bank=body.get("BANK") or "Unknown bank",
        branch=body.get("BRANCH") or "Unknown branch",
        city=body.get("CITY") or "",
        state=body.get("STATE") or "",
        supports_upi=bool(body.get("UPI")),
        supports_imps=bool(body.get("IMPS")),
        supports_neft=bool(body.get("NEFT")),
    )


# Honorifics and suffixes that carry no identity and only ever cause false
# mismatches between a bank record and a profile.
_NOISE = {
    "mr", "mrs", "ms", "miss", "dr", "prof", "shri", "smt", "sri", "kumari",
    "md", "mohd", "s", "d", "w", "o",
}


def _tokens(name: str) -> list[str]:
    """Reduce a name to comparable parts.

    Indian names arrive in every arrangement a form allows: initials expanded or
    not, surname first or last, with or without honorifics, with accents from a
    transliteration. Comparing raw strings would reject most legitimate matches.
    """
    folded = unicodedata.normalize("NFKD", name or "")
    folded = "".join(ch for ch in folded if not unicodedata.combining(ch))
    folded = folded.lower().replace(".", " ").replace("-", " ")
    parts = [part for part in re.split(r"\s+", folded) if part]
    return [part for part in parts if part not in _NOISE and len(part) > 1]


@dataclass(frozen=True)
class NameMatch:
    score: float
    matched: bool
    reason: str


def match_names(profile_name: str, bank_name: str) -> NameMatch:
    """Compare the account holder's name against the profile name.

    The threshold is deliberately not 1.0. Requiring an exact match rejects
    "Dharaneesh M" against "DHARANEESH MUTHUKUMAR", which is the same person and
    the single most common shape of Indian bank record. Requiring too little
    would let "Priya S" pass for "Priyanka Sharma", so the rule is: every token
    of the shorter name must appear in the longer one, either whole or as an
    initial.
    """
    left = _tokens(profile_name)
    right = _tokens(bank_name)

    if not left or not right:
        return NameMatch(0.0, False, "One of the names is empty.")

    shorter, longer = (left, right) if len(left) <= len(right) else (right, left)

    hits = 0
    for token in shorter:
        if token in longer:
            hits += 1
            continue
        # A single letter matching the start of a full token is an initial.
        if len(token) == 1 and any(other.startswith(token) for other in longer):
            hits += 1
            continue
        # An abbreviation of a longer token: "muthu" against "muthukumar".
        if any(other.startswith(token) or token.startswith(other) for other in longer):
            hits += 0.75

    score = round(hits / len(shorter), 3)

    if score >= 0.99:
        return NameMatch(score, True, "The names match.")
    if score >= 0.6:
        return NameMatch(
            score,
            True,
            "The names match closely enough to accept, allowing for how banks "
            "record initials and surnames.",
        )
    return NameMatch(
        score,
        False,
        "The account holder's name does not look like your profile name. "
        "Payouts must go to an account in your own name.",
    )


def mask_account(account_number: str) -> str:
    """Never store or return a full account number to a screen."""
    tail = account_number[-4:]
    return "x" * max(0, len(account_number) - 4) + tail
