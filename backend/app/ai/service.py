"""Trust Score computation and explanation (spec sections 18–23).

Layer 3 turns the model's risk probability into a 0–100 score, layer 4 maps it
to a band, and the explanation turns coefficients into sentences a person can
act on.

Two rules are enforced here and are not negotiable:

* **Cold start is declared, not hidden** (section 20). A brand-new account has
  almost no behavioural evidence, so its score is pulled toward a neutral
  starting value and labelled with limited confidence rather than presented as
  a confident read.
* **The AI never acts** (section 23). Nothing in this module moves money,
  suspends an account or resolves a dispute. It produces a number, an
  explanation and — at most — a recommendation for a human.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.constants import (
    BAND_LABELS,
    COLD_START_SCORE,
    CONFIDENCE_MIN_EVENTS_HIGH,
    CONFIDENCE_MIN_EVENTS_MODERATE,
    MODEL_VERSION,
    ConfidenceLevel,
    RiskBand,
    band_for_score,
)
from app.ai.features import (
    FEATURE_LABELS,
    FEATURE_PHRASING,
    FeatureSet,
    compute_features,
    describe_features,
)
from app.ai.model import TrustScore
from app.ai import trust_model
from app.notifications import service as notifications
from app.notifications.constants import NotificationSeverity, NotificationType
from app.users.model import User

#: Contributions smaller than this are noise, not explanation.
_MIN_CONTRIBUTION = 0.08

#: How many reasons to show. More than this and nobody reads any of them.
_MAX_REASONS = 4


@dataclass(frozen=True, slots=True)
class ScoreResult:
    score: int
    band: RiskBand
    band_label: str
    confidence: ConfidenceLevel
    risk_probability: float
    positive_reasons: list[str]
    risk_reasons: list[str]
    features: dict[str, float]
    contributions: dict[str, float]
    evidence_count: int
    model_version: str
    previous_score: int | None = None

    @property
    def delta(self) -> int | None:
        if self.previous_score is None:
            return None
        return self.score - self.previous_score


def _confidence_for(evidence_count: int) -> ConfidenceLevel:
    if evidence_count >= CONFIDENCE_MIN_EVENTS_HIGH:
        return ConfidenceLevel.HIGH
    if evidence_count >= CONFIDENCE_MIN_EVENTS_MODERATE:
        return ConfidenceLevel.MODERATE
    return ConfidenceLevel.LIMITED


def _apply_cold_start(raw_score: int, evidence_count: int) -> int:
    """Blend a thin-evidence score toward the neutral starting point.

    With no history the model reads "new account" as risk, which would brand
    every legitimate newcomer as dangerous. The weight given to the model rises
    with the amount of evidence, so the score becomes genuinely the model's as
    the account accumulates a record.
    """
    if evidence_count >= CONFIDENCE_MIN_EVENTS_HIGH:
        return raw_score

    weight = evidence_count / CONFIDENCE_MIN_EVENTS_HIGH
    blended = (weight * raw_score) + ((1 - weight) * COLD_START_SCORE)
    return int(round(blended))


def _explain(
    contributions: dict[str, float], features: FeatureSet
) -> tuple[list[str], list[str]]:
    """Turn signed contributions into plain sentences.

    Section 22: users see language, never coefficients. Negative contributions
    push toward trustworthiness, positive toward risk.
    """
    ranked = sorted(contributions.items(), key=lambda item: item[1])

    positive: list[str] = []
    risks: list[str] = []

    for name, contribution in ranked:
        if abs(contribution) < _MIN_CONTRIBUTION:
            continue
        good_phrase, bad_phrase = FEATURE_PHRASING.get(
            name, (FEATURE_LABELS.get(name, name), FEATURE_LABELS.get(name, name))
        )
        if contribution < 0 and len(positive) < _MAX_REASONS:
            positive.append(good_phrase)
        elif contribution > 0 and len(risks) < _MAX_REASONS:
            risks.append(bad_phrase)

    if not positive and not risks:
        positive.append("No unusual activity on this account")

    return positive, risks


def compute_score(db: Session, user: User) -> ScoreResult:
    """Score a user without saving. Pure read — safe to call on any request."""
    features = compute_features(db, user)
    prediction = trust_model.predict(features.vector())

    raw_score = int(round((1.0 - prediction.risk_probability) * 100))
    score = max(0, min(100, _apply_cold_start(raw_score, features.evidence_count)))

    band = band_for_score(score)
    positive, risks = _explain(prediction.contributions, features)

    latest = _latest_score_row(db, user.id)

    return ScoreResult(
        score=score,
        band=band,
        band_label=BAND_LABELS[band],
        confidence=_confidence_for(features.evidence_count),
        risk_probability=prediction.risk_probability,
        positive_reasons=positive,
        risk_reasons=risks,
        features=describe_features(features),
        contributions={
            name: round(value, 4) for name, value in prediction.contributions.items()
        },
        evidence_count=features.evidence_count,
        model_version=MODEL_VERSION,
        previous_score=latest.score if latest else None,
    )


def _latest_score_row(db: Session, user_id: uuid.UUID) -> TrustScore | None:
    return db.scalar(
        select(TrustScore)
        .where(TrustScore.user_id == user_id)
        .order_by(TrustScore.created_at.desc())
        .limit(1)
    )


def record_score(
    db: Session, user: User, *, reason: str | None = None, notify: bool = True
) -> ScoreResult:
    """Compute, persist, and tell the user if it moved meaningfully.

    Section 50 requires the notification to explain *why* the score changed,
    which is why the top risk reason is carried into the message rather than
    just the numbers.
    """
    result = compute_score(db, user)

    row = TrustScore(
        user_id=user.id,
        score=result.score,
        risk_band=result.band,
        risk_probability=result.risk_probability,
        confidence=result.confidence,
        features=result.features,
        explanation={
            "positive": result.positive_reasons,
            "risks": result.risk_reasons,
            "contributions": result.contributions,
        },
        model_version=result.model_version,
        previous_score=result.previous_score,
        change_reason=reason,
    )
    db.add(row)

    delta = result.delta
    if notify and delta is not None and abs(delta) >= 5:
        primary = (
            result.risk_reasons[0]
            if delta < 0 and result.risk_reasons
            else (result.positive_reasons[0] if result.positive_reasons else "Recent activity")
        )
        notifications.create(
            db,
            user_id=user.id,
            notification_type=NotificationType.TRUST_SCORE_CHANGED,
            title=f"Trust Score changed: {result.previous_score} → {result.score}",
            body=f"{primary}.",
            target={"screen": "trust-score"},
            severity=(
                NotificationSeverity.WARNING if delta < 0 else NotificationSeverity.SUCCESS
            ),
        )

    db.commit()
    return result


def history(db: Session, user: User, limit: int = 20) -> list[TrustScore]:
    return list(
        db.scalars(
            select(TrustScore)
            .where(TrustScore.user_id == user.id)
            .order_by(TrustScore.created_at.desc())
            .limit(limit)
        ).all()
    )


def model_info() -> dict:
    """Held-out performance, surfaced so the number is not taken on faith."""
    metrics = trust_model.get_metrics()
    return {
        "model_version": MODEL_VERSION,
        "model_type": "LogisticRegression (standardised features)",
        "explainability": "Exact Shapley attribution (closed form for linear models)",
        "metrics": {
            key: (round(value, 4) if isinstance(value, float) else value)
            for key, value in metrics.items()
        },
        "trained_on": (
            "Synthetic behaviour generated from a documented latent-risk process. "
            "No real customer outcomes exist yet to train on."
        ),
        "generated_at": datetime.now(UTC).isoformat(),
    }
