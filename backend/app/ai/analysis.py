"""Agreement analysis, dispute summarisation and the assistant.

Sections 25, 26 and 27. Three deliberate constraints run through all of them:

* **The AI never decides.** It flags, summarises and suggests. Every output
  that touches a decision carries a statement that a human makes the call.
* **The assistant never invents account facts.** Anything about money, status
  or balances is read from the database and passed in; the assistant formats
  what it is given and refuses what it was not.
* **Analysis is deterministic.** No external model is called, so the same
  agreement produces the same findings every time — which is what makes a demo
  reproducible and a finding arguable.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy.orm import Session

from app.ai import llm, prompts
from app.ai.constants import MODEL_VERSION, AnalysisType
from app.ai.model import AIAnalysis
from app.core.money import ZERO, to_money
from app.disputes.model import Dispute
from app.milestones.constants import STATUS_LABELS, MilestoneStatus
from app.projects.model import Project

DISCLAIMER = (
    "AI-generated. Final decisions are made by an authorised person, not by this system."
)

#: Appended when the deterministic analyser answered instead of Claude, so the
#: UI never implies a model reviewed something it did not.
RULES_NOTE = (
    "Produced by TrustPay's built-in checks. Connect an Anthropic API key for a "
    "full model-written review."
)

#: Words that promise something without saying what would satisfy it. A
#: milestone described only in these terms cannot be objectively judged
#: complete, which is how "is it done?" becomes a dispute.
VAGUE_TERMS = (
    "etc",
    "and so on",
    "as needed",
    "as required",
    "good quality",
    "high quality",
    "professional",
    "nice",
    "modern",
    "clean",
    "best effort",
    "asap",
    "soon",
    "reasonable",
    "appropriate",
    "some",
    "various",
)

MEASURABLE_HINTS = (
    "deliver",
    "provide",
    "include",
    "must",
    "will",
    "shall",
    "page",
    "screen",
    "file",
    "document",
    "test",
    "deploy",
    "review",
    "approve",
    "%",
    "number",
)


@dataclass
class Finding:
    severity: str  # LOW | MEDIUM | HIGH
    area: str
    issue: str
    recommendation: str
    milestone_sequence: int | None = None


@dataclass
class Rewrite:
    milestone_sequence: int
    original: str
    improved: str


@dataclass
class AgreementAnalysis:
    risk_level: str
    summary: str
    findings: list[Finding]
    strengths: list[str]
    #: Concrete replacement wording Claude proposes for weak criteria. Empty when
    #: the deterministic analyser produced this result — it can spot a vague
    #: criterion but cannot write a better one.
    suggested_rewrites: list[Rewrite] = field(default_factory=list)
    engine: str = llm.ENGINE_RULES
    model: str | None = None
    disclaimer: str = DISCLAIMER

    def to_dict(self) -> dict:
        return {
            "risk_level": self.risk_level,
            "summary": self.summary,
            "findings": [asdict(finding) for finding in self.findings],
            "strengths": self.strengths,
            "suggested_rewrites": [asdict(item) for item in self.suggested_rewrites],
            "engine": self.engine,
            "model": self.model,
            "disclaimer": (
                self.disclaimer
                if self.engine == llm.ENGINE_MODEL
                else f"{self.disclaimer} {RULES_NOTE}"
            ),
        }


def _contains_vague_language(text: str) -> list[str]:
    lowered = text.lower()
    return [term for term in VAGUE_TERMS if term in lowered]


def _looks_measurable(text: str) -> bool:
    lowered = text.lower()
    return sum(1 for hint in MEASURABLE_HINTS if hint in lowered) >= 2


def analyse_project(project: Project) -> AgreementAnalysis:
    """Inspect a project's structure and terms for the gaps that cause disputes."""
    findings: list[Finding] = []
    strengths: list[str] = []

    milestones = sorted(project.milestones, key=lambda item: item.sequence)

    # --- milestone-level checks ---
    for milestone in milestones:
        criteria = (milestone.completion_criteria or "").strip()

        if len(criteria) < 25:
            findings.append(
                Finding(
                    severity="HIGH",
                    area="Completion criteria",
                    issue=f"Milestone {milestone.sequence} does not clearly define what counts as complete.",
                    recommendation=(
                        "State what must be delivered and how it will be checked, "
                        "so approval is a matter of fact rather than opinion."
                    ),
                    milestone_sequence=milestone.sequence,
                )
            )
        elif not _looks_measurable(criteria):
            findings.append(
                Finding(
                    severity="MEDIUM",
                    area="Completion criteria",
                    issue=f"Milestone {milestone.sequence} describes intent but not a measurable outcome.",
                    recommendation="Add specific deliverables that can be pointed at when the work is submitted.",
                    milestone_sequence=milestone.sequence,
                )
            )

        vague = _contains_vague_language(criteria)
        if vague:
            findings.append(
                Finding(
                    severity="MEDIUM",
                    area="Ambiguous language",
                    issue=(
                        f"Milestone {milestone.sequence} relies on open-ended wording "
                        f"({', '.join(sorted(set(vague))[:3])})."
                    ),
                    recommendation="Replace subjective wording with something both parties could verify.",
                    milestone_sequence=milestone.sequence,
                )
            )

        if milestone.due_date is None:
            findings.append(
                Finding(
                    severity="MEDIUM",
                    area="Deadlines",
                    issue=f"Milestone {milestone.sequence} has no due date.",
                    recommendation="Set a date, so 'late' means something specific.",
                    milestone_sequence=milestone.sequence,
                )
            )

        if milestone.revision_limit == 0:
            findings.append(
                Finding(
                    severity="LOW",
                    area="Revisions",
                    issue=f"Milestone {milestone.sequence} allows no revisions.",
                    recommendation=(
                        "Allowing at least one revision usually resolves a disagreement "
                        "without a dispute."
                    ),
                    milestone_sequence=milestone.sequence,
                )
            )

    # --- distribution checks ---
    total = to_money(project.total_amount)
    if milestones and total > ZERO:
        largest = max(milestones, key=lambda item: item.amount)
        share = to_money(largest.amount) / total
        if share > Decimal("0.6") and len(milestones) > 1:
            findings.append(
                Finding(
                    severity="MEDIUM",
                    area="Payment distribution",
                    issue=(
                        f"Milestone {largest.sequence} carries "
                        f"{share * 100:.0f}% of the project value."
                    ),
                    recommendation=(
                        "Spreading value more evenly reduces how much is at stake in "
                        "any single disagreement."
                    ),
                    milestone_sequence=largest.sequence,
                )
            )
        else:
            strengths.append("Payment is spread sensibly across milestones")

    if len(milestones) == 1 and total > Decimal("25000.00"):
        findings.append(
            Finding(
                severity="MEDIUM",
                area="Structure",
                issue="The whole project value sits in a single milestone.",
                recommendation=(
                    "Break the work into stages so payment tracks progress instead of "
                    "arriving all at once."
                ),
            )
        )

    if project.end_date is None:
        findings.append(
            Finding(
                severity="LOW",
                area="Deadlines",
                issue="The project has no agreed completion date.",
                recommendation="Add one, so delivery expectations are shared.",
            )
        )

    # --- strengths ---
    if all(
        len((milestone.completion_criteria or "").strip()) >= 40
        for milestone in milestones
    ):
        strengths.append("Every milestone defines what completion means")
    if all(milestone.due_date for milestone in milestones) and milestones:
        strengths.append("Every milestone has a deadline")
    if len(milestones) >= 3:
        strengths.append("Work is staged, so payment follows progress")
    if any(milestone.revision_limit > 0 for milestone in milestones):
        strengths.append("Revisions are agreed in advance")

    high = sum(1 for finding in findings if finding.severity == "HIGH")
    medium = sum(1 for finding in findings if finding.severity == "MEDIUM")

    if high >= 1 or medium >= 4:
        risk_level = "HIGH"
        summary = "This agreement has gaps that commonly lead to disputes."
    elif medium >= 1:
        risk_level = "MEDIUM"
        summary = "This agreement is workable, but some terms could be tightened."
    else:
        risk_level = "LOW"
        summary = "This agreement is clearly structured, with measurable terms."

    return AgreementAnalysis(
        risk_level=risk_level,
        summary=summary,
        findings=findings,
        strengths=strengths or ["Terms are recorded and agreed up front"],
    )


def analyse_agreement_text(text: str) -> AgreementAnalysis:
    """Analyse pasted agreement text that is not yet a structured project."""
    findings: list[Finding] = []
    strengths: list[str] = []
    lowered = text.lower()

    if not re.search(r"\b(milestone|phase|stage|deliverable)\b", lowered):
        findings.append(
            Finding(
                severity="HIGH",
                area="Structure",
                issue="No milestones or stages are described.",
                recommendation="Break the work into stages, each with its own payment.",
            )
        )
    else:
        strengths.append("The work is described in stages")

    if not re.search(r"\b(date|deadline|by \d|within \d+ (day|week|month))", lowered):
        findings.append(
            Finding(
                severity="MEDIUM",
                area="Deadlines",
                issue="No deadlines are stated.",
                recommendation="Add dates for each stage.",
            )
        )

    if not re.search(r"\b(revision|amend|change request|rework)\b", lowered):
        findings.append(
            Finding(
                severity="MEDIUM",
                area="Revisions",
                issue="Revision terms are not covered.",
                recommendation="State how many rounds of changes are included.",
            )
        )

    if not re.search(r"\b(cancel|terminat|withdraw|refund)\b", lowered):
        findings.append(
            Finding(
                severity="MEDIUM",
                area="Cancellation",
                issue="The agreement does not say what happens if it is cancelled.",
                recommendation="State how funds are handled if either party walks away.",
            )
        )

    if not re.search(r"\b(accept|approv|sign.?off|complete when)\b", lowered):
        findings.append(
            Finding(
                severity="HIGH",
                area="Completion criteria",
                issue="It is not clear what counts as the work being accepted.",
                recommendation="Define acceptance so payment release is not a judgement call.",
            )
        )

    vague = _contains_vague_language(text)
    if len(vague) >= 3:
        findings.append(
            Finding(
                severity="MEDIUM",
                area="Ambiguous language",
                issue=f"Open-ended wording appears throughout ({', '.join(sorted(set(vague))[:4])}).",
                recommendation="Replace subjective terms with verifiable ones.",
            )
        )

    high = sum(1 for finding in findings if finding.severity == "HIGH")
    medium = sum(1 for finding in findings if finding.severity == "MEDIUM")
    risk_level = "HIGH" if high else ("MEDIUM" if medium else "LOW")

    return AgreementAnalysis(
        risk_level=risk_level,
        summary=(
            "This agreement leaves important terms undefined."
            if high
            else "This agreement covers the basics but could be tightened."
            if medium
            else "This agreement covers the terms that usually matter."
        ),
        findings=findings,
        strengths=strengths or ["Terms are written down"],
    )


# ------------------------------------------------------------------ disputes


@dataclass
class DisputeSummary:
    main_disagreement: str
    client_position: str
    receiver_position: str
    evidence_summary: str
    relevant_milestone: str
    timeline: list[str]
    considerations: list[str]
    disclaimer: str = DISCLAIMER

    def to_dict(self) -> dict:
        return asdict(self)


def summarise_dispute(dispute: Dispute, milestone, project: Project) -> DisputeSummary:
    """Lay out both sides for the admin who has to decide.

    Deliberately does not recommend an outcome. Section 23 forbids the AI from
    resolving disputes, and a summary that ends with "the client is right"
    would be a resolution wearing a summary's clothes.
    """
    client_messages = [
        message for message in dispute.messages if message.author_id == project.client_id
    ]
    receiver_messages = [
        message
        for message in dispute.messages
        if project.receiver_id and message.author_id == project.receiver_id
    ]

    def latest(messages) -> str:
        return messages[-1].body.strip() if messages else "No statement provided yet."

    evidence_count = sum(len(message.evidence or []) for message in dispute.messages)
    submissions = getattr(milestone, "submissions", []) or []

    timeline: list[str] = []
    if milestone.funded_at:
        timeline.append(f"{milestone.funded_at:%d %b %Y} — funds protected")
    for submission in submissions:
        timeline.append(
            f"{submission.created_at:%d %b %Y} — work submitted "
            f"(attempt {submission.attempt}, {submission.completion_percentage}% complete)"
        )
        if submission.reviewed_at:
            timeline.append(f"{submission.reviewed_at:%d %b %Y} — client requested changes")
    timeline.append(f"{dispute.created_at:%d %b %Y} — dispute raised")

    considerations = []
    if not submissions:
        considerations.append("No work has been submitted against this milestone.")
    if evidence_count == 0:
        considerations.append("Neither party has attached evidence.")
    if len((milestone.completion_criteria or "").strip()) < 40:
        considerations.append(
            "The milestone's completion criteria are brief, so 'complete' may be genuinely ambiguous."
        )
    if milestone.revisions_used >= milestone.revision_limit and milestone.revision_limit:
        considerations.append("The agreed revision allowance has been used up.")
    if not considerations:
        considerations.append("Both parties have stated a position and provided evidence.")

    return DisputeSummary(
        main_disagreement=f"Whether “{milestone.title}” meets the agreed completion criteria.",
        client_position=latest(client_messages),
        receiver_position=latest(receiver_messages),
        evidence_summary=(
            f"{evidence_count} item(s) of evidence across {len(dispute.messages)} statement(s)."
        ),
        relevant_milestone=(
            f"Milestone {milestone.sequence}: {milestone.title} — "
            f"{milestone.currency} {milestone.amount:,.2f}, "
            f"currently {STATUS_LABELS.get(milestone.status, milestone.status)}"
        ),
        timeline=timeline,
        considerations=considerations,
    )


# ----------------------------------------------------------------- assistant


@dataclass
class AssistantReply:
    answer: str
    sources: list[str]
    disclaimer: str = DISCLAIMER

    def to_dict(self) -> dict:
        return asdict(self)


def answer_question(question: str, *, facts: dict) -> AssistantReply:
    """Answer using only the facts supplied by the caller.

    `facts` is assembled by the router from trusted database reads. If a
    question needs a number that is not in `facts`, the assistant says it does
    not know — section 27 forbids inventing transaction status, and a payments
    assistant that guesses balances is worse than no assistant.
    """
    lowered = question.lower().strip()
    sources: list[str] = []

    def has(*terms: str) -> bool:
        return any(term in lowered for term in terms)

    if has("balance", "how much", "money i have", "available"):
        sources.append("wallet")
        return AssistantReply(
            answer=(
                f"Your available balance is {facts['currency']} {facts['available']}. "
                f"{facts['currency']} {facts['protected']} is protected against active "
                "milestones, which means it is yours but cannot be spent until those "
                "milestones are approved or cancelled."
            ),
            sources=sources,
        )

    if has("where is my payment", "where's my payment", "not received", "when will i be paid"):
        sources.append("milestones")
        if facts.get("awaiting_review"):
            return AssistantReply(
                answer=(
                    f"You have {facts['awaiting_review']} milestone(s) submitted and "
                    "waiting on the client's review. The money is already protected, so "
                    "it is committed to you — it moves to your available balance as soon "
                    "as the client approves."
                ),
                sources=sources,
            )
        return AssistantReply(
            answer=(
                "Nothing of yours is currently awaiting review. Payment is released once "
                "you submit a funded milestone and the client approves it."
            ),
            sources=sources,
        )

    if has("why is my payment protected", "why protected", "what does protected mean"):
        return AssistantReply(
            answer=(
                "Protected funds are money the client has already committed to a specific "
                "milestone. It has left their spendable balance and cannot be used for "
                "anything else. It is released to the receiver when the client approves the "
                "submitted work, or returned to the client if the milestone is cancelled — "
                "and a cancellation needs the receiver's own verification code."
            ),
            sources=["policy"],
        )

    if has("trust score", "my score", "why did my score"):
        sources.append("trust_score")
        reasons = facts.get("score_reasons") or []
        reason_text = (" " + " ".join(f"{reason}." for reason in reasons[:3])) if reasons else ""
        return AssistantReply(
            answer=(
                f"Your Trust Score is {facts['trust_score']} out of 100 "
                f"({facts['trust_band']}), with {facts['trust_confidence']} confidence."
                f"{reason_text}"
            ),
            sources=sources,
        )

    if has("cancel", "cancellation"):
        return AssistantReply(
            answer=(
                "A client can request cancellation of a funded milestone, but it does not "
                "happen on their say-so. The receiver is notified and sent a one-time code, "
                "and only the receiver can enter it. Until they do, the money stays "
                "protected. If the receiver declines, the milestone continues."
            ),
            sources=["policy"],
        )

    if has("dispute", "disagree", "not happy"):
        return AssistantReply(
            answer=(
                "Either party can raise a dispute on a milestone. Both sides submit their "
                "account and any evidence, the protected funds stay where they are, and a "
                "TrustPay reviewer decides the outcome. The AI may summarise the case, but "
                "a person makes the decision."
            ),
            sources=["policy"],
        )

    if has("milestone", "what do i need to do", "requirement"):
        sources.append("milestones")
        if facts.get("next_milestone"):
            return AssistantReply(
                answer=(
                    f"Your next milestone is “{facts['next_milestone']}” "
                    f"({facts['next_milestone_status']}). "
                    f"It requires: {facts['next_milestone_criteria']}"
                ),
                sources=sources,
            )
        return AssistantReply(
            answer="You have no active milestones right now.", sources=sources
        )

    if has("flagged", "risk", "suspicious"):
        sources.append("risk_signals")
        signals = facts.get("risk_signals") or []
        if signals:
            return AssistantReply(
                answer=(
                    "Recent activity raised the following for review: "
                    + " ".join(signals[:3])
                    + " A flag is not an accusation — it means a person will look at it."
                ),
                sources=sources,
            )
        return AssistantReply(
            answer="Nothing on your account is currently flagged for review.",
            sources=sources,
        )

    # The honest default. Better than a confident guess about someone's money.
    return AssistantReply(
        answer=(
            "I can help with your balance, protected funds, milestone status, Trust Score, "
            "cancellations and disputes. I could not match that question to anything I can "
            "verify from your account, so I would rather not guess."
        ),
        sources=[],
    )


# ------------------------------------------------------------------ storage


def store(
    db: Session,
    *,
    analysis_type: AnalysisType,
    result: dict,
    requested_by_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    milestone_id: uuid.UUID | None = None,
    dispute_id: uuid.UUID | None = None,
) -> AIAnalysis:
    row = AIAnalysis(
        analysis_type=analysis_type,
        requested_by_id=requested_by_id,
        project_id=project_id,
        milestone_id=milestone_id,
        dispute_id=dispute_id,
        result=result,
        model_version=MODEL_VERSION,
    )
    db.add(row)
    return row
