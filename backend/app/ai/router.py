"""AI endpoints (spec section 28)."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm import selectinload

from app.ai import analysis as ai_analysis
from app.ai import llm as ai_llm
from app.ai import review as ai_review
from app.ai import rules as risk_rules
from app.ai import service as trust
from app.ai.constants import AnalysisType
from app.ai.model import RiskSignal
from app.auth.dependencies import get_current_active_user
from app.config.settings import settings
from app.dependencies.database import get_db
from app.milestones.constants import STATUS_LABELS, PROTECTED_STATUSES, MilestoneStatus
from app.milestones.model import Milestone
from app.projects import repository as projects_repo
from app.users.model import User
from app.wallet import service as wallet_service

router = APIRouter(prefix="/ai", tags=["AI"])


class TrustScoreResponse(BaseModel):
    score: int
    out_of: int = 100
    band: str
    band_label: str
    confidence: str
    positive_reasons: list[str]
    risk_reasons: list[str]
    previous_score: int | None
    delta: int | None
    evidence_count: int
    model_version: str

    #: Section 20: say so when the data is thin, rather than implying certainty.
    limited_data_notice: str | None = None


class ExplanationResponse(TrustScoreResponse):
    features: dict
    contributions: dict
    model_info: dict
    #: Claude's plain-language reading of the score. Null when unavailable.
    narrative: str | None = None


class AgreementTextBody(BaseModel):
    text: str = Field(min_length=20, max_length=20000)


class AssistantBody(BaseModel):
    question: str = Field(min_length=2, max_length=500)


def _to_score_response(result: trust.ScoreResult) -> dict:
    notice = None
    if result.confidence != "HIGH":
        notice = (
            "This account has limited history, so the score is based on little "
            "evidence and will become more accurate with use."
        )
    return {
        "score": result.score,
        "band": str(result.band),
        "band_label": result.band_label,
        "confidence": str(result.confidence),
        "positive_reasons": result.positive_reasons,
        "risk_reasons": result.risk_reasons,
        "previous_score": result.previous_score,
        "delta": result.delta,
        "evidence_count": result.evidence_count,
        "model_version": result.model_version,
        "limited_data_notice": notice,
    }


@router.get("/status", summary="Which AI engine is active")
def ai_status() -> dict:
    """Tells the client whether answers are model-written or rule-based.

    The app shows this, so a reviewer is never left guessing whether Claude
    actually looked at their agreement.
    """
    available = ai_llm.is_available()
    return {
        "engine": ai_llm.ENGINE_MODEL if available else ai_llm.ENGINE_RULES,
        "model": settings.AI_MODEL if available else None,
        "claude_connected": available,
        "trust_score_model": trust.model_info(),
        "note": (
            "Agreement review, dispute summaries and the assistant are written by "
            "Claude."
            if available
            else "No Anthropic API key is configured, so TrustPay's built-in "
            "analysers are answering. The Trust Score model is unaffected — it "
            "runs locally either way."
        ),
    }


@router.get(
    "/trust-score", response_model=TrustScoreResponse, summary="Your Trust Score"
)
def get_trust_score(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> TrustScoreResponse:
    result = trust.compute_score(db, current_user)
    return TrustScoreResponse(**_to_score_response(result))


@router.get(
    "/trust-score/explanation",
    response_model=ExplanationResponse,
    summary="Why your score is what it is",
)
def get_explanation(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> ExplanationResponse:
    """Includes the feature values and their signed contributions.

    Section 22 says raw internals must not be shown to ordinary users; the
    plain-language reasons are what the mobile client renders. The numeric
    detail is here for admins, auditors and anyone who wants to check the
    working.
    """
    result = trust.compute_score(db, current_user)
    payload = _to_score_response(result)

    # A short written explanation on top of the ranked signals. None when Claude
    # is unavailable — the reasons are already shown, so nothing is lost.
    narrative = ai_review.trust_narrative(payload)

    return ExplanationResponse(
        **payload,
        narrative=narrative,
        features=result.features,
        contributions=result.contributions,
        model_info=trust.model_info(),
    )


@router.post(
    "/trust-score/recalculate",
    response_model=TrustScoreResponse,
    summary="Recompute and record your score",
)
def recalculate(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> TrustScoreResponse:
    result = trust.record_score(db, current_user, reason="Requested by user")
    return TrustScoreResponse(**_to_score_response(result))


@router.post("/analyze-agreement", summary="Analyse pasted agreement text")
def analyze_agreement(
    payload: AgreementTextBody,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> dict:
    result = ai_review.review_agreement_text(payload.text).to_dict()
    ai_analysis.store(
        db,
        analysis_type=AnalysisType.AGREEMENT,
        result=result,
        requested_by_id=current_user.id,
    )
    db.commit()
    return result


@router.get("/risk-signals", summary="What has been flagged on your account")
def my_risk_signals(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> dict:
    """Users can see their own flags.

    Hiding them would make the system feel arbitrary; section 23 is clear that
    the AI advises rather than punishes, and someone who can see why they were
    flagged can contest it.
    """
    signals = list(
        db.scalars(
            select(RiskSignal)
            .where(RiskSignal.user_id == current_user.id)
            .order_by(RiskSignal.created_at.desc())
            .limit(20)
        ).all()
    )
    return {
        "items": [
            {
                "rule": signal.rule,
                "severity": signal.severity,
                "message": signal.message,
                "context": signal.context,
                "created_at": signal.created_at.isoformat(),
            }
            for signal in signals
        ],
        "note": (
            "A flag means a person may review the activity. It is not an accusation, "
            "and nothing is blocked automatically."
        ),
    }


@router.post("/assistant", summary="Ask about your account")
def assistant(
    payload: AssistantBody,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> dict:
    """Answers from verified database reads only.

    Every fact the assistant can state is assembled here, from the same services
    the rest of the API uses. It has no ability to invent a balance or a status
    because it is never given the chance to guess one.
    """
    balances = wallet_service.get_balances(db, current_user)
    score = trust.compute_score(db, current_user)

    projects, _total = (
        projects_repo.list_for_user(db, current_user.id, limit=50, offset=0),
        0,
    )
    project_ids = [project.id for project in projects]

    milestones = (
        list(
            db.scalars(
                select(Milestone)
                .where(Milestone.project_id.in_(project_ids))
                .options(selectinload(Milestone.project))
            ).all()
        )
        if project_ids
        else []
    )

    awaiting_review = sum(
        1 for item in milestones if item.status == MilestoneStatus.SUBMITTED
    )
    active = [item for item in milestones if item.status in PROTECTED_STATUSES]
    next_milestone = min(active, key=lambda item: item.sequence) if active else None

    signals = list(
        db.scalars(
            select(RiskSignal.message)
            .where(RiskSignal.user_id == current_user.id)
            .order_by(RiskSignal.created_at.desc())
            .limit(5)
        ).all()
    )

    facts = {
        "currency": balances.wallet.currency,
        "available": f"{balances.available:,.2f}",
        "protected": f"{balances.protected:,.2f}",
        "trust_score": score.score,
        "trust_band": score.band_label,
        "trust_confidence": str(score.confidence).lower(),
        "score_reasons": score.positive_reasons + score.risk_reasons,
        "awaiting_review": awaiting_review,
        "next_milestone": next_milestone.title if next_milestone else None,
        "next_milestone_status": (
            STATUS_LABELS.get(next_milestone.status, "") if next_milestone else None
        ),
        "next_milestone_criteria": (
            next_milestone.completion_criteria if next_milestone else None
        ),
        "risk_signals": signals,
    }

    reply = ai_review.ask_assistant(payload.question, facts=facts)
    return {
        **reply.to_dict(),
        "engine": ai_llm.ENGINE_MODEL if ai_llm.is_available() else ai_llm.ENGINE_RULES,
        "asked_at": datetime.now().isoformat(),
    }
