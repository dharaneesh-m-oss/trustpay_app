"""AI and risk constants.

Risk bands are defined once, here, because section 19 requires them to be
configurable rather than hardcoded throughout the application.
"""

from __future__ import annotations

from enum import StrEnum

MODEL_VERSION = "trust-score-1.0.0"


class RiskBand(StrEnum):
    VERY_LOW = "VERY_LOW"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    VERY_HIGH = "VERY_HIGH"


class ConfidenceLevel(StrEnum):
    HIGH = "HIGH"
    MODERATE = "MODERATE"
    LIMITED = "LIMITED"


class AnalysisType(StrEnum):
    AGREEMENT = "AGREEMENT"
    DISPUTE = "DISPUTE"
    PAYMENT_RISK = "PAYMENT_RISK"
    SUBMISSION = "SUBMISSION"


#: (inclusive lower bound, band). Section 19's thresholds, in one place.
RISK_BANDS: tuple[tuple[int, RiskBand], ...] = (
    (90, RiskBand.VERY_LOW),
    (75, RiskBand.LOW),
    (50, RiskBand.MEDIUM),
    (25, RiskBand.HIGH),
    (0, RiskBand.VERY_HIGH),
)

BAND_LABELS: dict[RiskBand, str] = {
    RiskBand.VERY_LOW: "Very low risk",
    RiskBand.LOW: "Low risk",
    RiskBand.MEDIUM: "Medium risk",
    RiskBand.HIGH: "High risk",
    RiskBand.VERY_HIGH: "Very high risk",
}


def band_for_score(score: int) -> RiskBand:
    for threshold, band in RISK_BANDS:
        if score >= threshold:
            return band
    return RiskBand.VERY_HIGH


#: A brand-new account has almost no behavioural history. Claiming a confident
#: read on it would be dishonest, so confidence is derived from how much
#: evidence actually exists (spec section 20).
CONFIDENCE_MIN_EVENTS_HIGH = 15
CONFIDENCE_MIN_EVENTS_MODERATE = 5

#: The score a user starts on before any behaviour is observed. Deliberately
#: mid-to-upper rather than perfect: a new account has not earned 100, and
#: starting at 0 would punish people for being new.
COLD_START_SCORE = 72


class RiskRule(StrEnum):
    UNUSUALLY_LARGE_TRANSACTION = "UNUSUALLY_LARGE_TRANSACTION"
    RAPID_REPEATED_TRANSACTIONS = "RAPID_REPEATED_TRANSACTIONS"
    REPEATED_CANCELLATIONS = "REPEATED_CANCELLATIONS"
    HIGH_DISPUTE_RATE = "HIGH_DISPUTE_RATE"
    NEW_ACCOUNT_LARGE_VALUE = "NEW_ACCOUNT_LARGE_VALUE"
    SUDDEN_BEHAVIOUR_CHANGE = "SUDDEN_BEHAVIOUR_CHANGE"


RULE_MESSAGES: dict[RiskRule, str] = {
    RiskRule.UNUSUALLY_LARGE_TRANSACTION: "This amount is much larger than usual for this account.",
    RiskRule.RAPID_REPEATED_TRANSACTIONS: "Several transactions were made in quick succession.",
    RiskRule.REPEATED_CANCELLATIONS: "This account has cancelled funded milestones repeatedly.",
    RiskRule.HIGH_DISPUTE_RATE: "A high share of this account's projects have gone to dispute.",
    RiskRule.NEW_ACCOUNT_LARGE_VALUE: "A large amount on an account with little history.",
    RiskRule.SUDDEN_BEHAVIOUR_CHANGE: "Recent activity differs sharply from this account's pattern.",
}
