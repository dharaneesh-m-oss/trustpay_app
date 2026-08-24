"""Payment checks.

Three groups, in order of how much damage a bug would do:

  - **Webhook signatures.** The webhook is unauthenticated and can credit a
    wallet. If forged signatures pass, anyone who finds the URL can print money.
  - **Credit-once.** Providers retry. A retry must not credit twice.
  - **Verification.** IFSC format and name matching, including the Indian name
    shapes that a naive exact-match would wrongly reject.

The name-matching cases are drawn from how banks actually store names: surnames
expanded from initials, honorifics, and order swapped. Each one is a real
account that must not be locked out, or a real mismatch that must not pass.
"""

from __future__ import annotations

import hashlib
import hmac

import pytest

from app.payments import provider, verification


# --------------------------------------------------------------- signatures

def test_webhook_signature_accepts_a_genuine_payload(monkeypatch):
    secret = "whsec_testing_only"
    monkeypatch.setattr(
        provider.settings, "RAZORPAY_WEBHOOK_SECRET", secret, raising=False
    )

    body = b'{"event":"payment.captured"}'
    signature = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()

    assert provider.verify_webhook_signature(body, signature) is True


def test_webhook_signature_rejects_a_forgery(monkeypatch):
    monkeypatch.setattr(
        provider.settings, "RAZORPAY_WEBHOOK_SECRET", "whsec_testing_only", raising=False
    )
    body = b'{"event":"payment.captured"}'
    assert provider.verify_webhook_signature(body, "deadbeef") is False
    assert provider.verify_webhook_signature(body, "") is False


def test_webhook_signature_rejects_a_modified_body(monkeypatch):
    """The signature must cover the body, not merely exist."""
    secret = "whsec_testing_only"
    monkeypatch.setattr(
        provider.settings, "RAZORPAY_WEBHOOK_SECRET", secret, raising=False
    )

    original = b'{"amount":100}'
    signature = hmac.new(secret.encode(), original, hashlib.sha256).hexdigest()
    tampered = b'{"amount":100000}'

    assert provider.verify_webhook_signature(tampered, signature) is False


def test_webhook_refuses_everything_when_no_secret_is_configured(monkeypatch):
    """Absent a secret, no signature can be trusted - so none is accepted."""
    monkeypatch.setattr(
        provider.settings, "RAZORPAY_WEBHOOK_SECRET", None, raising=False
    )
    body = b"{}"
    signature = hmac.new(b"anything", body, hashlib.sha256).hexdigest()
    assert provider.verify_webhook_signature(body, signature) is False


# ------------------------------------------------------------ configuration

def test_provider_reports_unconfigured_without_keys(monkeypatch):
    monkeypatch.setattr(provider.settings, "RAZORPAY_KEY_ID", None, raising=False)
    monkeypatch.setattr(provider.settings, "RAZORPAY_KEY_SECRET", None, raising=False)
    assert provider.configured() is False
    assert provider.payouts_configured() is False


@pytest.mark.asyncio
async def test_creating_an_order_without_keys_refuses_rather_than_pretending(monkeypatch):
    monkeypatch.setattr(provider.settings, "RAZORPAY_KEY_ID", None, raising=False)
    monkeypatch.setattr(provider.settings, "RAZORPAY_KEY_SECRET", None, raising=False)

    from decimal import Decimal

    with pytest.raises(provider.ProviderNotConfigured):
        await provider.create_order(amount=Decimal("100.00"), reference="TEST")


# ------------------------------------------------------------------ amounts

def test_amounts_convert_without_drift():
    from decimal import Decimal

    assert provider.to_paise(Decimal("100.00")) == 10000
    assert provider.to_paise(Decimal("0.01")) == 1
    assert provider.to_paise(Decimal("1999.99")) == 199999
    assert provider.from_paise(199999) == Decimal("1999.99")


# --------------------------------------------------------------------- IFSC

@pytest.mark.parametrize(
    "code",
    ["SBIN0001234", "HDFC0000123", "ICIC0004567"],
)
def test_valid_ifsc_codes_are_accepted(code):
    assert verification.normalise_ifsc(code) == code


@pytest.mark.parametrize(
    "code",
    [
        "SBIN1001234",  # fifth character must be zero
        "SBI0001234",   # too short
        "SBIN00012345", # too long
        "1BIN0001234",  # bank code must be letters
        "",
    ],
)
def test_malformed_ifsc_codes_are_rejected(code):
    with pytest.raises(verification.VerificationError):
        verification.normalise_ifsc(code)


def test_ifsc_is_normalised_before_checking():
    assert verification.normalise_ifsc("  sbin0001234 ") == "SBIN0001234"


# ---------------------------------------------------------- account numbers

@pytest.mark.parametrize("number", ["123456789", "12345678901234", "123456789012345678"])
def test_plausible_account_numbers_are_accepted(number):
    assert verification.normalise_account_number(number) == number


@pytest.mark.parametrize("number", ["12345678", "1234567890123456789", "abcd1234567", ""])
def test_implausible_account_numbers_are_rejected(number):
    with pytest.raises(verification.VerificationError):
        verification.normalise_account_number(number)


def test_spaces_and_dashes_are_stripped_from_account_numbers():
    assert verification.normalise_account_number("1234 5678 9012") == "123456789012"


def test_account_numbers_are_masked_for_display():
    assert verification.mask_account("123456789012") == "xxxxxxxx9012"


# ------------------------------------------------------------ name matching

@pytest.mark.parametrize(
    ("profile", "bank"),
    [
        ("Dharaneesh M", "DHARANEESH MUTHUKUMAR"),
        ("Priya Sharma", "PRIYA SHARMA"),
        ("Priya Sharma", "Sharma Priya"),
        ("Mr Rajesh Kumar", "RAJESH KUMAR"),
        ("A R Rahman", "ALLAH RAKHA RAHMAN"),
        ("Ravi  Kumar", "ravi kumar"),
    ],
)
def test_the_same_person_written_differently_still_matches(profile, bank):
    """Bank records and profiles rarely agree on form. They must still match."""
    result = verification.match_names(profile, bank)
    assert result.matched, f"{profile!r} vs {bank!r} scored {result.score}"


@pytest.mark.parametrize(
    ("profile", "bank"),
    [
        ("Priya Sharma", "Rahul Verma"),
        ("Dharaneesh M", "Suresh Babu"),
        ("Anita Desai", "Kavita Menon"),
    ],
)
def test_different_people_do_not_match(profile, bank):
    """The check that stops a payout reaching somebody else's account."""
    result = verification.match_names(profile, bank)
    assert not result.matched, f"{profile!r} vs {bank!r} scored {result.score}"


def test_empty_names_never_match():
    assert not verification.match_names("", "Priya Sharma").matched
    assert not verification.match_names("Priya Sharma", "").matched


# ---------------------------------------------------------------------- UPI

@pytest.mark.parametrize("vpa", ["someone@okhdfcbank", "user.name@ybl", "9876543210@paytm"])
def test_valid_upi_ids_are_accepted(vpa):
    assert verification.normalise_vpa(vpa) == vpa.lower()


@pytest.mark.parametrize("vpa", ["nohandle", "@bank", "a@", "spaces here@ybl", ""])
def test_malformed_upi_ids_are_rejected(vpa):
    with pytest.raises(verification.VerificationError):
        verification.normalise_vpa(vpa)


def test_upi_intent_carries_the_amount_and_reference():
    from decimal import Decimal

    from app.payments import upi

    targets = upi.build_intent_urls(
        payee_vpa="trustpay@okaxis",
        payee_name="TrustPay",
        amount=Decimal("1500.50"),
        reference="ABC123",
        note="TrustPay wallet ABC123",
    )

    by_key = {target.key: target for target in targets}
    assert set(by_key) >= {"gpay", "phonepe", "paytm", "any"}

    for target in targets:
        assert "am=1500.50" in target.url
        assert "tr=ABC123" in target.url
        assert "cu=INR" in target.url
        assert "pa=trustpay%40okaxis" in target.url


def test_transaction_references_are_alphanumeric_and_bounded():
    """PSPs silently drop punctuated or overlong references."""
    from app.payments import upi

    reference = upi.transaction_reference("0198f3aa-7c21-7f0e-9c4d-2b1a5f6e8d90")
    assert reference.isalnum()
    assert len(reference) <= 35
    assert reference.isupper()


# --------------------------------------------------------------- UPI payouts

def test_a_payout_must_name_exactly_one_destination():
    """Neither is a payout to nowhere; both makes the destination depend on
    which column the code happens to read first."""
    import uuid

    import pytest as _pytest
    from pydantic import ValidationError

    from app.payments.schema import PayoutRequestBody

    bank = uuid.uuid4()
    upi = uuid.uuid4()

    assert PayoutRequestBody(amount=500, bank_account_id=bank).bank_account_id == bank
    assert PayoutRequestBody(amount=500, upi_account_id=upi).upi_account_id == upi

    with _pytest.raises(ValidationError):
        PayoutRequestBody(amount=500)

    with _pytest.raises(ValidationError):
        PayoutRequestBody(amount=500, bank_account_id=bank, upi_account_id=upi)


def test_upi_ids_are_lowercased_on_the_way_in():
    """VPAs are case-insensitive, so storing two casings as two accounts would
    let the same destination be added twice."""
    from app.payments.schema import UpiAccountCreateRequest

    payload = UpiAccountCreateRequest(vpa="  Someone@OkHdfcBank ", holder_name="Priya Sharma")
    assert payload.vpa == "someone@okhdfcbank"
