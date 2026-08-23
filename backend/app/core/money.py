"""Money handling.

Money is `decimal.Decimal` end to end and NUMERIC(18, 2) in PostgreSQL. Floats
are never used for money anywhere in TrustPay: 0.1 + 0.2 != 0.3 in binary
floating point, and a ledger that does not reconcile to the paisa is not a
ledger.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from sqlalchemy import Numeric

from app.config.settings import settings
from app.core.exceptions import ValidationError

MoneyColumn = Numeric(settings.MONEY_PRECISION, settings.MONEY_SCALE)

ZERO = Decimal("0.00")
_QUANTUM = Decimal(1).scaleb(-settings.MONEY_SCALE)


def to_money(value: Decimal | int | str) -> Decimal:
    """Normalise any accepted input to an exact 2-decimal Decimal."""
    if isinstance(value, float):
        raise ValidationError("Monetary amounts must not be provided as floats.")
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValidationError("Amount is not a valid number.") from exc

    if not amount.is_finite():
        raise ValidationError("Amount is not a valid number.")

    return amount.quantize(_QUANTUM, rounding=ROUND_HALF_UP)


def require_positive(value: Decimal, field: str = "Amount") -> Decimal:
    amount = to_money(value)
    if amount <= ZERO:
        raise ValidationError(f"{field} must be greater than zero.")
    return amount


def require_non_negative(value: Decimal, field: str = "Amount") -> Decimal:
    amount = to_money(value)
    if amount < ZERO:
        raise ValidationError(f"{field} cannot be negative.")
    return amount


def format_money(value: Decimal, currency: str | None = None) -> str:
    """Display helper. Presentation only — never parse this back into a Decimal."""
    code = currency or settings.DEFAULT_CURRENCY
    symbol = {"INR": "₹", "USD": "$", "EUR": "€"}.get(code, f"{code} ")
    return f"{symbol}{to_money(value):,.2f}"


def as_field_error(value: Decimal | int | str, field: str = "Amount") -> Decimal:
    """Validate a money field from inside a pydantic validator.

    `require_positive` raises TrustPayError, which pydantic does not catch — it
    would escape validation entirely and be rendered as a 400 while every other
    field error is a 422. Converting to ValueError keeps one consistent shape
    for "you sent something invalid".
    """
    try:
        return require_positive(value, field)
    except ValidationError as exc:
        raise ValueError(exc.message) from exc
