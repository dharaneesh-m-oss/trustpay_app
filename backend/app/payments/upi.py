"""UPI intents.

A UPI intent is a URL. Handing `upi://pay?...` to Android opens whichever UPI
apps are installed - GPay, PhonePe, Paytm, the bank's own - with the payee,
amount and reference already filled in. That part is genuinely real and needs no
merchant account: it is the same mechanism a printed QR code uses.

What an intent cannot do is tell you whether the payment happened.

The paying app reports success to *itself*, not to us, and a returning user can
say anything. Treating "the app came back" as proof of payment is how a wallet
gets drained by anyone willing to press back at the right moment. So an intent
here only ever creates a PENDING intent; the balance moves when the payment
provider confirms it over a signed webhook, and at no other time.

That is the whole reason a payment aggregator is required for real money in.
The deep link is the easy half.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal
from urllib.parse import quote

# The packages behind the buttons people actually recognise. Android resolves
# `upi://` against all of them; naming them lets the app offer a direct choice
# rather than a system chooser, which is what the big wallets do.
UPI_APPS: dict[str, dict[str, str]] = {
    "gpay": {
        "label": "Google Pay",
        "package": "com.google.android.apps.nbu.paisa.user",
        "scheme": "tez://upi/pay",
    },
    "phonepe": {
        "label": "PhonePe",
        "package": "com.phonepe.app",
        "scheme": "phonepe://pay",
    },
    "paytm": {
        "label": "Paytm",
        "package": "net.one97.paytm",
        "scheme": "paytmmp://pay",
    },
    "bhim": {
        "label": "BHIM",
        "package": "in.org.npci.upiapp",
        "scheme": "upi://pay",
    },
    "any": {
        "label": "Other UPI app",
        "package": "",
        "scheme": "upi://pay",
    },
}

# A transaction reference is alphanumeric and at most 35 characters. Longer or
# punctuated references are silently dropped by some PSPs, which turns a
# reconcilable payment into an anonymous one.
_REF_SAFE = re.compile(r"[^A-Za-z0-9]")


def transaction_reference(intent_id: str) -> str:
    return _REF_SAFE.sub("", intent_id.replace("-", ""))[:35].upper()


@dataclass(frozen=True)
class UpiTarget:
    key: str
    label: str
    package: str
    url: str


def build_intent_urls(
    *,
    payee_vpa: str,
    payee_name: str,
    amount: Decimal,
    reference: str,
    note: str,
) -> list[UpiTarget]:
    """One URL per app, all describing the same payment.

    The amount is embedded and marked non-editable by convention (`am` plus a
    fixed `cu`); a payer can still change it in some apps, which is exactly why
    the confirmation step compares the amount the provider reports against the
    amount we asked for rather than trusting this string.
    """
    params = (
        f"pa={quote(payee_vpa)}"
        f"&pn={quote(payee_name)}"
        f"&am={amount:.2f}"
        f"&cu=INR"
        f"&tr={quote(reference)}"
        f"&tn={quote(note[:50])}"
    )

    targets: list[UpiTarget] = []
    for key, app in UPI_APPS.items():
        targets.append(
            UpiTarget(
                key=key,
                label=app["label"],
                package=app["package"],
                url=f"{app['scheme']}?{params}",
            )
        )
    return targets
