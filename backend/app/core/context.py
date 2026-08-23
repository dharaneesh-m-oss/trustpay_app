"""Caller metadata threaded from the HTTP edge into services.

Services must not import FastAPI's Request — that would tie business logic to
the transport. The router extracts what it needs and passes this plain object.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class RequestContext:
    ip_address: str | None = None
    user_agent: str | None = None
