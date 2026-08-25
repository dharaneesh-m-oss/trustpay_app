"""Claude integration.

This is the layer that makes TrustPay's AI features genuinely model-driven
rather than pattern-matched. It is deliberately built so the product does not
*depend* on it: every caller has a deterministic fallback, and if no API key is
configured — or the API errors, or takes too long — the feature still works and
says which engine produced the answer.

Two rules run through everything here:

* **The model never sees a secret and never decides about money.** Prompts carry
  project terms and figures the caller already fetched from the database. No
  password, token, OTP or raw ledger access goes into a prompt, and no output
  from this module moves funds — section 23 is explicit that consequential
  decisions belong to people.
* **Structured output, not prose parsing.** Every analysis call constrains the
  response with a JSON schema, so the caller gets a shape it can rely on instead
  of regexing English out of a paragraph.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from app.config.settings import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

#: Marks which engine produced a result, so the UI can be honest about it.
ENGINE_MODEL = "claude"
ENGINE_OPENAI = "openai"
ENGINE_RULES = "rules"


@dataclass(frozen=True, slots=True)
class LLMResult:
    data: dict[str, Any]
    engine: str
    model: str | None = None


class LLMUnavailable(RuntimeError):
    """No usable model - missing key, missing package, or a failed call."""


_client: Any = None
_client_checked = False
_openai_client: Any = None
_openai_checked = False


def active_engine() -> str:
    """Which engine will answer, given the configuration and what is installed."""
    return settings.ai_provider


def _get_openai_client() -> Any:
    """Build the OpenAI client once, or raise LLMUnavailable.

    Import is deferred for the same reason as the Anthropic one: the app must
    start on a machine without the SDK, with AI degrading rather than the
    process failing.
    """
    global _openai_client, _openai_checked

    if _openai_client is not None:
        return _openai_client
    if _openai_checked:
        raise LLMUnavailable("OpenAI client is not configured.")

    _openai_checked = True

    if not settings.AI_ENABLED:
        raise LLMUnavailable("AI is disabled by configuration.")
    if not settings.OPENAI_API_KEY:
        raise LLMUnavailable("OPENAI_API_KEY is not set.")

    try:
        import openai
    except ImportError as exc:  # pragma: no cover - depends on the environment
        raise LLMUnavailable("The openai package is not installed.") from exc

    _openai_client = openai.OpenAI(
        api_key=settings.OPENAI_API_KEY,
        timeout=settings.AI_TIMEOUT_SECONDS,
        max_retries=1,
    )
    return _openai_client


def _openai_json(
    *, system: str, prompt: str, schema: dict[str, Any], max_tokens: int
) -> LLMResult:
    """One JSON object from OpenAI, constrained by the same schema.

    Structured outputs are used rather than asking politely for JSON: the model
    is constrained during generation, so the result is valid JSON of the right
    shape instead of prose that has to be salvaged. That matters because the
    caller's fallback is a rules engine, and a parse failure would silently
    downgrade an answer that was actually fine.
    """
    client = _get_openai_client()

    try:
        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            max_tokens=max_tokens,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "trustpay_result",
                    "schema": schema,
                    # Not strict: strict mode requires every property to be
                    # required and additionalProperties false throughout, which
                    # these schemas deliberately are not.
                    "strict": False,
                },
            },
        )
    except Exception as exc:  # noqa: BLE001 - any failure falls back to rules
        logger.warning(
            "llm_call_failed",
            engine="openai",
            error=type(exc).__name__,
            detail=str(exc)[:200],
        )
        raise LLMUnavailable(str(exc)) from exc

    choice = response.choices[0]
    if getattr(choice.message, "refusal", None):
        # A decline on a payments question is not something to paper over.
        logger.info("llm_refused", engine="openai")
        raise LLMUnavailable("The model declined this request.")

    text = choice.message.content or ""
    if not text:
        raise LLMUnavailable("The model returned no content.")

    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise LLMUnavailable("The model returned unparseable JSON.") from exc

    usage = getattr(response, "usage", None)
    logger.info(
        "llm_call_succeeded",
        engine="openai",
        model=settings.OPENAI_MODEL,
        input_tokens=getattr(usage, "prompt_tokens", 0),
        output_tokens=getattr(usage, "completion_tokens", 0),
    )
    return LLMResult(data=data, engine=ENGINE_OPENAI, model=settings.OPENAI_MODEL)


def _openai_text(*, system: str, prompt: str, max_tokens: int) -> str:
    client = _get_openai_client()

    try:
        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            max_tokens=max_tokens,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "llm_call_failed",
            engine="openai",
            error=type(exc).__name__,
            detail=str(exc)[:200],
        )
        raise LLMUnavailable(str(exc)) from exc

    choice = response.choices[0]
    if getattr(choice.message, "refusal", None):
        raise LLMUnavailable("The model declined this request.")

    text = (choice.message.content or "").strip()
    if not text:
        raise LLMUnavailable("The model returned no content.")
    return text


def _get_client() -> Any:
    """Build the Anthropic client once, or raise LLMUnavailable.

    Import is deferred so the whole application still starts on a machine
    without the SDK installed; the AI features degrade, nothing else does.
    """
    global _client, _client_checked

    if _client is not None:
        return _client

    if _client_checked:
        raise LLMUnavailable("Claude client is not configured.")

    _client_checked = True

    if not settings.AI_ENABLED:
        raise LLMUnavailable("AI is disabled by configuration.")
    if not settings.ANTHROPIC_API_KEY:
        raise LLMUnavailable("ANTHROPIC_API_KEY is not set.")

    try:
        import anthropic
    except ImportError as exc:  # pragma: no cover - depends on the environment
        raise LLMUnavailable("The anthropic package is not installed.") from exc

    _client = anthropic.Anthropic(
        api_key=settings.ANTHROPIC_API_KEY,
        timeout=settings.AI_TIMEOUT_SECONDS,
        max_retries=1,
    )
    return _client


def is_available() -> bool:
    """Whether a model-backed answer can be attempted at all."""
    engine = active_engine()
    if engine == ENGINE_RULES:
        return False
    try:
        _get_openai_client() if engine == ENGINE_OPENAI else _get_client()
        return True
    except LLMUnavailable:
        return False


def complete_json(
    *,
    system: str,
    prompt: str,
    schema: dict[str, Any],
    max_tokens: int = 4000,
    effort: str | None = None,
) -> LLMResult:
    """Ask Claude for one JSON object matching `schema`.

    `output_config.format` constrains generation to the schema, so the response
    is valid JSON of the right shape rather than prose that has to be salvaged.
    Adaptive thinking is on: these are judgement tasks — reading an agreement for
    ambiguity, weighing two accounts of a dispute — and they are exactly what
    thinking improves.

    OpenAI takes the same system prompt and the same schema; only the
    transport differs, so nothing above this layer knows which engine
    answered except through `LLMResult.engine`.
    """
    if active_engine() == ENGINE_OPENAI:
        return _openai_json(
            system=system, prompt=prompt, schema=schema, max_tokens=max_tokens
        )

    client = _get_client()

    try:
        response = client.messages.create(
            model=settings.AI_MODEL,
            max_tokens=max_tokens,
            system=[
                {
                    "type": "text",
                    "text": system,
                    # The instructions are identical across every call of a given
                    # kind, so caching the prefix pays for itself immediately.
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": prompt}],
            thinking={"type": "adaptive"},
            output_config={
                "effort": effort or settings.AI_EFFORT,
                "format": {"type": "json_schema", "schema": schema},
            },
        )
    except Exception as exc:  # noqa: BLE001 - any failure falls back to rules
        logger.warning("llm_call_failed", error=type(exc).__name__, detail=str(exc)[:200])
        raise LLMUnavailable(str(exc)) from exc

    if response.stop_reason == "refusal":
        # A safety decline on a payments question is not something to paper
        # over; the caller falls back to the deterministic analyser.
        logger.info("llm_refused", category=getattr(response.stop_details, "category", None))
        raise LLMUnavailable("The model declined this request.")

    text = next((block.text for block in response.content if block.type == "text"), "")
    if not text:
        raise LLMUnavailable("The model returned no content.")

    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:  # pragma: no cover - schema makes this rare
        raise LLMUnavailable("The model returned unparseable JSON.") from exc

    logger.info(
        "llm_call_succeeded",
        model=settings.AI_MODEL,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
        cached=getattr(response.usage, "cache_read_input_tokens", 0),
    )

    return LLMResult(data=data, engine=ENGINE_MODEL, model=settings.AI_MODEL)


def complete_text(
    *, system: str, prompt: str, max_tokens: int = 1200, effort: str | None = None
) -> str:
    """Plain-text answer, for the assistant.

    Kept separate from `complete_json` because the assistant's reply is prose
    for a person to read, and forcing it through a schema would only make it
    stilted.
    """
    if active_engine() == ENGINE_OPENAI:
        return _openai_text(system=system, prompt=prompt, max_tokens=max_tokens)

    client = _get_client()

    try:
        response = client.messages.create(
            model=settings.AI_MODEL,
            max_tokens=max_tokens,
            system=[
                {
                    "type": "text",
                    "text": system,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": prompt}],
            thinking={"type": "adaptive"},
            output_config={"effort": effort or settings.AI_EFFORT},
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("llm_call_failed", error=type(exc).__name__, detail=str(exc)[:200])
        raise LLMUnavailable(str(exc)) from exc

    if response.stop_reason == "refusal":
        raise LLMUnavailable("The model declined this request.")

    text = "\n".join(
        block.text for block in response.content if block.type == "text"
    ).strip()
    if not text:
        raise LLMUnavailable("The model returned no content.")
    return text


def reset_client_cache() -> None:
    """Used by tests to re-evaluate configuration."""
    global _client, _client_checked, _openai_client, _openai_checked
    _client = None
    _client_checked = False
    _openai_client = None
    _openai_checked = False
