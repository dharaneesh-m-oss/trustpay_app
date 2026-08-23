"""Wallet limits.

Values live here rather than inline so risk rules stay adjustable without
hunting through service code (spec section 19 applies the same principle to the
Trust Score bands).
"""

from __future__ import annotations

from decimal import Decimal

#: Smallest movement the wallet accepts. Below this, fees and rounding dominate.
MIN_TOP_UP = Decimal("1.00")
MIN_WITHDRAWAL = Decimal("1.00")

#: Ceiling on a single simulated top-up. Prevents a demo from minting numbers
#: large enough to make later NUMERIC(18,2) arithmetic meaningless.
MAX_TOP_UP = Decimal("1000000.00")
MAX_WITHDRAWAL = Decimal("1000000.00")

#: Top-ups above this are flagged for review by the risk engine (section 24).
#: Flagging only — the transaction still completes; a human decides what to do.
LARGE_TRANSACTION_THRESHOLD = Decimal("100000.00")
