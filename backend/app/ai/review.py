"""Claude-backed review, with the deterministic analysers as the safety net.

`analysis.py` holds the rule-based analysers. This module is what the API
actually calls: it asks Claude first, and falls back to those analysers when no
key is configured, when the call fails, or when the model declines.

The fallback is not an error path — it returns a complete analysis. The
difference is depth: Claude reads the actual wording and can propose better
text; the rules can only detect that wording is thin. Every response reports
which engine answered, so the UI never implies a model reviewed something it
did not.
"""

from __future__ import annotations

from decimal import Decimal

from app.ai import analysis, llm, prompts
from app.ai.analysis import AgreementAnalysis, AssistantReply, Finding, Rewrite
from app.core.money import ZERO, to_money
from app.disputes.model import Dispute
from app.milestones.constants import STATUS_LABELS
from app.projects.model import Project

_MAX_AGREEMENT_CHARS = 12000


# ---------------------------------------------------------------- agreements


def _project_brief(project: Project) -> str:
    """Everything Claude needs to review an agreement, and nothing else.

    Deliberately excludes names, balances and ledger data: judging whether terms
    are clear does not require knowing who the parties are or what they can
    afford, and the less that goes into a prompt, the less there is to leak.
    """
    milestones = sorted(project.milestones, key=lambda item: item.sequence)
    total = to_money(project.total_amount)

    lines = [
        f"Project: {project.title}",
        f"Description: {project.description}",
        f"Total value: {project.currency} {total:,.2f}",
        f"Agreed completion date: {project.end_date or 'not set'}",
        f"Number of milestones: {len(milestones)}",
        "",
    ]

    for milestone in milestones:
        share = (to_money(milestone.amount) / total * 100) if total > ZERO else Decimal(0)
        lines += [
            f"--- Milestone {milestone.sequence}: {milestone.title}",
            (
                f"Amount: {milestone.currency} {to_money(milestone.amount):,.2f} "
                f"({share:.0f}% of the project value)"
            ),
            f"Due: {milestone.due_date or 'no due date set'}",
            f"Revisions allowed: {milestone.revision_limit}",
            f"Description: {milestone.description}",
            f"Completion criteria: {milestone.completion_criteria}",
            "",
        ]

    if project.agreement_text:
        lines += [
            "--- Additional agreement text supplied by the client ---",
            project.agreement_text[:8000],
        ]

    return "\n".join(lines)


def _to_analysis(payload: dict, model: str | None) -> AgreementAnalysis:
    return AgreementAnalysis(
        risk_level=payload.get("risk_level", "MEDIUM"),
        summary=payload.get("summary", ""),
        findings=[
            Finding(
                severity=item.get("severity", "MEDIUM"),
                area=item.get("area", "General"),
                issue=item.get("issue", ""),
                recommendation=item.get("recommendation", ""),
                milestone_sequence=item.get("milestone_sequence"),
            )
            for item in payload.get("findings", [])
        ],
        strengths=list(payload.get("strengths", [])),
        suggested_rewrites=[
            Rewrite(
                milestone_sequence=item.get("milestone_sequence", 0),
                original=item.get("original", ""),
                improved=item.get("improved", ""),
            )
            for item in payload.get("suggested_rewrites", [])
        ],
        engine=llm.ENGINE_MODEL,
        model=model,
    )


def review_project(project: Project) -> AgreementAnalysis:
    if llm.is_available():
        try:
            result = llm.complete_json(
                system=prompts.AGREEMENT_SYSTEM,
                prompt=_project_brief(project),
                schema=prompts.AGREEMENT_SCHEMA,
            )
            return _to_analysis(result.data, result.model)
        except llm.LLMUnavailable:
            pass

    return analysis.analyse_project(project)


def review_agreement_text(text: str) -> AgreementAnalysis:
    if llm.is_available():
        try:
            result = llm.complete_json(
                system=prompts.AGREEMENT_SYSTEM,
                prompt=(
                    "Review this agreement text. It has not been split into "
                    "structured milestones yet, so judge the wording as written.\n\n"
                    + text[:_MAX_AGREEMENT_CHARS]
                ),
                schema=prompts.AGREEMENT_SCHEMA,
            )
            return _to_analysis(result.data, result.model)
        except llm.LLMUnavailable:
            pass

    return analysis.analyse_agreement_text(text)


# ------------------------------------------------------------------ disputes


def _dispute_brief(dispute: Dispute, milestone, project: Project) -> str:
    """Both accounts plus the documented record, labelled so the model can tell
    a claim apart from a fact."""
    lines = [
        f"Milestone {milestone.sequence}: {milestone.title}",
        f"Amount at stake: {milestone.currency} {to_money(milestone.amount):,.2f}",
        f"Current state: {STATUS_LABELS.get(milestone.status, milestone.status)}",
        "",
        "AGREED COMPLETION CRITERIA (what both parties signed up to):",
        milestone.completion_criteria,
        "",
        f"REASON GIVEN FOR THE DISPUTE: {dispute.reason}",
        "",
        "DOCUMENTED RECORD (recorded by the system, not claimed by either party):",
    ]

    if milestone.funded_at:
        lines.append(f"- {milestone.funded_at:%d %b %Y}: funds protected")

    for submission in getattr(milestone, "submissions", []) or []:
        lines.append(
            f"- {submission.created_at:%d %b %Y}: work submitted (attempt "
            f"{submission.attempt}, marked {submission.completion_percentage}% complete, "
            f"{len(submission.evidence or [])} attachment(s))"
        )
        lines.append(f"    submission note: {submission.note}")
        if submission.review_note:
            lines.append(f"    client asked for changes: {submission.review_note}")

    lines.append(f"- {dispute.created_at:%d %b %Y}: dispute raised")
    lines.append(
        f"- revisions used: {milestone.revisions_used} of {milestone.revision_limit}"
    )
    lines += ["", "STATEMENTS (claims made by the parties):"]

    for message in dispute.messages:
        if message.author_id == project.client_id:
            who = "CLIENT"
        elif project.receiver_id and message.author_id == project.receiver_id:
            who = "RECEIVER"
        else:
            who = "REVIEWER"
        lines.append(f"- [{who}] {message.body}")
        for item in message.evidence or []:
            lines.append(f"    evidence attached: {item}")

    return "\n".join(lines)


def review_dispute(dispute: Dispute, milestone, project: Project) -> dict:
    """Brief a reviewer on a dispute. Never returns an outcome."""
    deterministic = analysis.summarise_dispute(dispute, milestone, project)

    if llm.is_available():
        try:
            result = llm.complete_json(
                system=prompts.DISPUTE_SYSTEM,
                prompt=_dispute_brief(dispute, milestone, project),
                schema=prompts.DISPUTE_SCHEMA,
            )
            payload = dict(result.data)
            # The timeline is derived from timestamps, not judgement — take the
            # deterministic one rather than asking the model to retype dates.
            payload["timeline"] = deterministic.timeline
            payload["relevant_milestone"] = deterministic.relevant_milestone
            payload["engine"] = llm.ENGINE_MODEL
            payload["model"] = result.model
            payload["disclaimer"] = analysis.DISCLAIMER
            return payload
        except llm.LLMUnavailable:
            pass

    payload = deterministic.to_dict()
    payload["engine"] = llm.ENGINE_RULES
    payload["model"] = None
    payload["disclaimer"] = f"{analysis.DISCLAIMER} {analysis.RULES_NOTE}"
    return payload


# ----------------------------------------------------------------- assistant


def _facts_block(facts: dict) -> str:
    """Render the verified facts as labelled lines.

    Plain text rather than JSON: it reads unambiguously, and it does not invite
    the model to treat a nested structure as something to explore.
    """
    lines = [
        f"Available balance: {facts['currency']} {facts['available']}",
        f"Protected in active milestones: {facts['currency']} {facts['protected']}",
        (
            f"Trust Score: {facts['trust_score']} out of 100 "
            f"({facts['trust_band']}, {facts['trust_confidence']} confidence)"
        ),
        f"Milestones submitted and awaiting the client's review: {facts.get('awaiting_review', 0)}",
    ]

    if facts.get("next_milestone"):
        lines += [
            f"Current active milestone: {facts['next_milestone']} "
            f"({facts.get('next_milestone_status')})",
            f"Its agreed completion criteria: {facts.get('next_milestone_criteria')}",
        ]
    else:
        lines.append("Current active milestone: none")

    reasons = facts.get("score_reasons") or []
    if reasons:
        lines.append("Trust Score factors: " + "; ".join(reasons[:4]))

    signals = facts.get("risk_signals") or []
    lines.append(
        "Risk flags on this account: "
        + ("; ".join(signals[:3]) if signals else "none")
    )

    return "\n".join(lines)


def ask_assistant(question: str, *, facts: dict) -> AssistantReply:
    """Answer a question about the signed-in user's own account.

    Claude receives the verified facts and the question, with the question
    fenced and labelled as untrusted so an instruction smuggled inside it reads
    as data rather than as a directive.
    """
    if llm.is_available():
        try:
            answer = llm.complete_text(
                system=prompts.ASSISTANT_SYSTEM,
                prompt=prompts.assistant_prompt(question, _facts_block(facts)),
                max_tokens=800,
                effort="medium",
            )
            return AssistantReply(
                answer=answer,
                sources=["account", "policy"],
                disclaimer=analysis.DISCLAIMER,
            )
        except llm.LLMUnavailable:
            pass

    return analysis.answer_question(question, facts=facts)


def trust_narrative(score_payload: dict) -> str | None:
    """A short plain-language explanation of a Trust Score.

    Returns None when Claude is unavailable — the caller already shows the
    ranked reasons, so there is nothing to fall back to and nothing lost.
    """
    if not llm.is_available():
        return None

    lines = [
        f"Score: {score_payload['score']} out of 100",
        f"Band: {score_payload['band_label']}",
        f"Confidence: {score_payload['confidence']}",
        "Signals helping this score: "
        + ("; ".join(score_payload.get("positive_reasons") or []) or "none"),
        "Signals hurting this score: "
        + ("; ".join(score_payload.get("risk_reasons") or []) or "none"),
    ]
    if score_payload.get("previous_score") is not None:
        lines.append(
            f"Previous score: {score_payload['previous_score']} "
            f"(change: {score_payload.get('delta')})"
        )

    try:
        return llm.complete_text(
            system=prompts.TRUST_NARRATIVE_SYSTEM,
            prompt="\n".join(lines),
            max_tokens=400,
            effort="low",
        )
    except llm.LLMUnavailable:
        return None
