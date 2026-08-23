"""Primary key generation.

UUIDs are used for every entity (spec section 29) so identifiers are neither
guessable nor enumerable — an integer `/projects/41` invites walking the range.

Where the interpreter provides it we use UUIDv7, whose leading bits are a
timestamp. That keeps freshly inserted rows adjacent in the B-tree index instead
of scattering writes across it the way UUIDv4 does, which matters for the
append-only ledger.
"""

from __future__ import annotations

import uuid

_HAS_UUID7 = hasattr(uuid, "uuid7")


def new_uuid() -> uuid.UUID:
    if _HAS_UUID7:
        return uuid.uuid7()  # type: ignore[attr-defined]  # CPython >= 3.14
    return uuid.uuid4()
