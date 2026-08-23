"""Wallet and double-entry ledger.

The point of these tests is the invariants, not the endpoints: money is never
created or destroyed, balances always reconcile to the postings, a balance can
never go negative, and repeating a request never moves money twice.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config.settings import settings
from app.core.constants import UserRole
from app.ledger import service as ledger
from app.ledger.constants import AccountType, PostingDirection, TransactionType
from app.ledger.model import LedgerAccount, LedgerPosting, LedgerTransaction
from app.users.model import User
from app.wallet.model import Wallet

API = settings.API_PREFIX


def money(value: str) -> Decimal:
    return Decimal(value)


# ------------------------------------------------------------------ lifecycle


def test_registration_creates_a_wallet_and_three_accounts(
    client: TestClient, registered_user, db
) -> None:
    user = db.scalar(select(User).where(User.email == registered_user["email"]))

    wallet = db.scalar(select(Wallet).where(Wallet.user_id == user.id))
    assert wallet is not None
    assert wallet.currency == settings.DEFAULT_CURRENCY

    accounts = db.scalars(
        select(LedgerAccount).where(LedgerAccount.owner_user_id == user.id)
    ).all()
    assert {account.account_type for account in accounts} == {
        AccountType.USER_AVAILABLE,
        AccountType.USER_PROTECTED,
        AccountType.USER_PENDING_SETTLEMENT,
    }
    assert all(account.balance == money("0.00") for account in accounts)


def test_wallet_has_no_balance_columns() -> None:
    """Balances live in the ledger; a second copy on the wallet would drift."""
    columns = set(Wallet.__table__.columns.keys())
    assert not {"available_balance", "locked_balance", "balance"} & columns


def test_new_wallet_reads_all_zeroes(client: TestClient, auth_headers) -> None:
    response = client.get(f"{API}/wallet", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["available"] == "0.00"
    assert body["protected"] == "0.00"
    assert body["pending_settlement"] == "0.00"
    assert body["total"] == "0.00"
    assert body["demo_mode"] is True


# -------------------------------------------------------------------- top up


def test_top_up_increases_available_balance(client: TestClient, auth_headers) -> None:
    response = client.post(
        f"{API}/wallet/top-up", json={"amount": "25400.00"}, headers=auth_headers
    )

    assert response.status_code == 200
    body = response.json()
    assert body["available"] == "25400.00"
    assert body["total"] == "25400.00"


def test_top_up_writes_two_balanced_postings(
    client: TestClient, auth_headers, db
) -> None:
    client.post(
        f"{API}/wallet/top-up", json={"amount": "500.00"}, headers=auth_headers
    )

    transaction = db.scalar(select(LedgerTransaction))
    assert transaction.transaction_type == TransactionType.TOP_UP
    assert transaction.amount == money("500.00")
    assert transaction.is_simulated is True

    postings = db.scalars(
        select(LedgerPosting).where(LedgerPosting.transaction_id == transaction.id)
    ).all()
    assert len(postings) == 2

    debits = sum(
        p.amount for p in postings if p.direction == PostingDirection.DEBIT
    )
    credits = sum(
        p.amount for p in postings if p.direction == PostingDirection.CREDIT
    )
    assert debits == credits == money("500.00")


def test_top_up_amount_is_exact_not_floating_point(
    client: TestClient, auth_headers
) -> None:
    """1.10 + 2.20 + 1.05 is 4.35 exactly.

    Accumulated as floats the same three amounts give 4.3500000000000005 — the
    assertion at the bottom pins that down. Every amount stays above MIN_TOP_UP
    so the limit check cannot mask what is being tested.
    """
    amounts = ["1.10", "2.20", "1.05"]

    for amount in amounts:
        response = client.post(
            f"{API}/wallet/top-up",
            json={"amount": amount, "idempotency_key": f"exact-{amount}-00000000"},
            headers=auth_headers,
        )
        assert response.status_code == 200, response.text

    assert response.json()["available"] == "4.35"

    float_total = 0.0
    for amount in amounts:
        float_total += float(amount)
    assert float_total != 4.35  # what a float balance would have stored


def test_top_up_rejects_zero_and_negative(client: TestClient, auth_headers) -> None:
    for amount in ("0", "-100.00"):
        response = client.post(
            f"{API}/wallet/top-up", json={"amount": amount}, headers=auth_headers
        )
        assert response.status_code == 422, amount


def test_top_up_enforces_limits(client: TestClient, auth_headers) -> None:
    below = client.post(
        f"{API}/wallet/top-up", json={"amount": "0.50"}, headers=auth_headers
    )
    assert below.status_code == 400
    assert below.json()["error"]["code"] == "AMOUNT_LIMIT_EXCEEDED"

    above = client.post(
        f"{API}/wallet/top-up", json={"amount": "99999999.00"}, headers=auth_headers
    )
    assert above.status_code == 400


def test_top_up_requires_authentication(client: TestClient) -> None:
    assert client.post(f"{API}/wallet/top-up", json={"amount": "100.00"}).status_code == 401


# ----------------------------------------------------------------- withdrawal


def test_withdraw_reduces_available_balance(client: TestClient, auth_headers) -> None:
    client.post(
        f"{API}/wallet/top-up", json={"amount": "1000.00"}, headers=auth_headers
    )
    response = client.post(
        f"{API}/wallet/withdraw", json={"amount": "250.50"}, headers=auth_headers
    )

    assert response.status_code == 200
    assert response.json()["available"] == "749.50"


def test_withdrawal_beyond_balance_is_refused(
    client: TestClient, auth_headers, db
) -> None:
    client.post(
        f"{API}/wallet/top-up", json={"amount": "100.00"}, headers=auth_headers
    )
    response = client.post(
        f"{API}/wallet/withdraw", json={"amount": "500.00"}, headers=auth_headers
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INSUFFICIENT_FUNDS"

    # The refusal left nothing behind: still exactly one transaction.
    assert len(db.scalars(select(LedgerTransaction)).all()) == 1
    assert (
        client.get(f"{API}/wallet", headers=auth_headers).json()["available"]
        == "100.00"
    )


def test_balance_can_never_go_negative(client: TestClient, auth_headers, db) -> None:
    for _ in range(3):
        client.post(
            f"{API}/wallet/withdraw", json={"amount": "50.00"}, headers=auth_headers
        )

    balances = db.scalars(select(LedgerAccount.balance)).all()
    assert all(balance >= 0 for balance in balances)


# ---------------------------------------------------------------- idempotency


def test_repeating_a_top_up_with_the_same_key_moves_money_once(
    client: TestClient, auth_headers, db
) -> None:
    payload = {"amount": "750.00", "idempotency_key": "topup-abc-12345678"}

    first = client.post(f"{API}/wallet/top-up", json=payload, headers=auth_headers)
    second = client.post(f"{API}/wallet/top-up", json=payload, headers=auth_headers)

    assert first.status_code == second.status_code == 200
    assert second.json()["available"] == "750.00"  # not 1500.00

    assert len(db.scalars(select(LedgerTransaction)).all()) == 1


def test_same_key_with_a_different_amount_is_rejected(
    client: TestClient, auth_headers
) -> None:
    """Reusing a key for a different request is a bug, not a retry."""
    key = "topup-xyz-87654321"
    client.post(
        f"{API}/wallet/top-up",
        json={"amount": "100.00", "idempotency_key": key},
        headers=auth_headers,
    )
    conflict = client.post(
        f"{API}/wallet/top-up",
        json={"amount": "999.00", "idempotency_key": key},
        headers=auth_headers,
    )

    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"


def test_different_keys_both_apply(client: TestClient, auth_headers) -> None:
    client.post(
        f"{API}/wallet/top-up",
        json={"amount": "100.00", "idempotency_key": "key-one-11111111"},
        headers=auth_headers,
    )
    response = client.post(
        f"{API}/wallet/top-up",
        json={"amount": "100.00", "idempotency_key": "key-two-22222222"},
        headers=auth_headers,
    )
    assert response.json()["available"] == "200.00"


# -------------------------------------------------------------- ledger rules


def test_ledger_rejects_an_unbalanced_transaction(db, registered_user) -> None:
    user = db.scalar(select(User).where(User.email == registered_user["email"]))
    available = ledger.get_or_create_account(
        db, owner_user_id=user.id, account_type=AccountType.USER_AVAILABLE
    )
    source = ledger.system_account(db, AccountType.SYSTEM_EXTERNAL_SOURCE)

    from app.ledger.exceptions import UnbalancedTransactionError

    with pytest.raises(UnbalancedTransactionError):
        ledger.post(
            db,
            transaction_type=TransactionType.ADJUSTMENT,
            postings=[
                ledger.PostingRequest(
                    account_id=source.id,
                    direction=PostingDirection.DEBIT,
                    amount=money("100.00"),
                ),
                ledger.PostingRequest(
                    account_id=available.id,
                    direction=PostingDirection.CREDIT,
                    amount=money("90.00"),  # does not balance
                ),
            ],
            description="Deliberately unbalanced",
        )
    db.rollback()


def test_ledger_rejects_a_single_sided_transaction(db, registered_user) -> None:
    user = db.scalar(select(User).where(User.email == registered_user["email"]))
    available = ledger.get_or_create_account(
        db, owner_user_id=user.id, account_type=AccountType.USER_AVAILABLE
    )

    from app.ledger.exceptions import InvalidPostingError

    with pytest.raises(InvalidPostingError):
        ledger.post(
            db,
            transaction_type=TransactionType.ADJUSTMENT,
            postings=[
                ledger.PostingRequest(
                    account_id=available.id,
                    direction=PostingDirection.CREDIT,
                    amount=money("100.00"),
                )
            ],
            description="Money from nowhere",
        )
    db.rollback()


def test_postings_record_the_running_balance(
    client: TestClient, auth_headers, db
) -> None:
    for amount in ("100.00", "50.00", "25.00"):
        client.post(
            f"{API}/wallet/top-up", json={"amount": amount}, headers=auth_headers
        )

    available = db.scalar(
        select(LedgerAccount).where(
            LedgerAccount.account_type == AccountType.USER_AVAILABLE
        )
    )
    postings = db.scalars(
        select(LedgerPosting)
        .where(LedgerPosting.account_id == available.id)
        .order_by(LedgerPosting.created_at)
    ).all()

    assert [str(p.balance_after) for p in postings] == ["100.00", "150.00", "175.00"]


# ------------------------------------------------------------ reconciliation


def test_the_books_balance_after_activity(client: TestClient, auth_headers, db) -> None:
    client.post(
        f"{API}/wallet/top-up", json={"amount": "5000.00"}, headers=auth_headers
    )
    client.post(
        f"{API}/wallet/withdraw", json={"amount": "1234.56"}, headers=auth_headers
    )

    report = ledger.reconcile(db)

    assert report.total_debits == report.total_credits
    assert report.discrepancies == []
    assert report.is_balanced


def test_reconciliation_detects_a_tampered_balance(
    client: TestClient, auth_headers, db
) -> None:
    """If someone updates a balance outside the ledger, reconciliation says so."""
    client.post(
        f"{API}/wallet/top-up", json={"amount": "1000.00"}, headers=auth_headers
    )

    available = db.scalar(
        select(LedgerAccount).where(
            LedgerAccount.account_type == AccountType.USER_AVAILABLE
        )
    )
    available.balance = money("999999.00")
    db.commit()

    report = ledger.reconcile(db)

    assert not report.is_balanced
    assert len(report.discrepancies) == 1
    discrepancy = report.discrepancies[0]
    assert discrepancy.cached_balance == money("999999.00")
    assert discrepancy.computed_balance == money("1000.00")


def test_reconciliation_endpoint_requires_admin(
    client: TestClient, auth_headers, registered_user, db
) -> None:
    assert (
        client.get(f"{API}/ledger/reconciliation", headers=auth_headers).status_code
        == 403
    )

    user = db.scalar(select(User).where(User.email == registered_user["email"]))
    user.role = UserRole.ADMIN
    db.commit()

    response = client.get(f"{API}/ledger/reconciliation", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["is_balanced"] is True


# ---------------------------------------------------------------- statement


def test_transaction_history_shows_direction_and_net_effect(
    client: TestClient, auth_headers
) -> None:
    client.post(
        f"{API}/wallet/top-up", json={"amount": "800.00"}, headers=auth_headers
    )
    client.post(
        f"{API}/wallet/withdraw", json={"amount": "300.00"}, headers=auth_headers
    )

    response = client.get(f"{API}/wallet/transactions", headers=auth_headers)
    assert response.status_code == 200

    body = response.json()
    assert body["total"] == 2

    newest, oldest = body["items"]
    assert newest["transaction_type"] == "WITHDRAWAL"
    assert newest["direction_for_user"] == "DEBIT"
    assert newest["net_effect"] == "-300.00"

    assert oldest["transaction_type"] == "TOP_UP"
    assert oldest["direction_for_user"] == "CREDIT"
    assert oldest["net_effect"] == "800.00"


def test_history_is_scoped_to_the_signed_in_user(
    client: TestClient, auth_headers
) -> None:
    client.post(
        f"{API}/wallet/top-up", json={"amount": "100.00"}, headers=auth_headers
    )

    client.post(
        f"{API}/users/register",
        json={
            "full_name": "Other Person",
            "email": "other@example.com",
            "password": "TrustPay2026x",
        },
    )
    other_login = client.post(
        f"{API}/auth/login",
        json={"email": "other@example.com", "password": "TrustPay2026x"},
    ).json()
    other_headers = {"Authorization": f"Bearer {other_login['access_token']}"}

    assert (
        client.get(f"{API}/wallet/transactions", headers=other_headers).json()["total"]
        == 0
    )
    assert (
        client.get(f"{API}/wallet/transactions", headers=auth_headers).json()["total"]
        == 1
    )


def test_history_pagination(client: TestClient, auth_headers) -> None:
    for index in range(5):
        client.post(
            f"{API}/wallet/top-up",
            json={"amount": "10.00", "idempotency_key": f"page-key-{index:08d}"},
            headers=auth_headers,
        )

    page = client.get(
        f"{API}/wallet/transactions?limit=2&offset=2", headers=auth_headers
    ).json()

    assert page["total"] == 5
    assert len(page["items"]) == 2
    assert page["limit"] == 2
    assert page["offset"] == 2


# ------------------------------------------------------------------ reversal


def test_reversal_posts_the_mirror_image_and_keeps_the_original(
    client: TestClient, auth_headers, registered_user, db
) -> None:
    client.post(
        f"{API}/wallet/top-up", json={"amount": "400.00"}, headers=auth_headers
    )

    original = db.scalar(select(LedgerTransaction))
    ledger.reverse(db, original, description="Reversal of an incorrect top-up")
    db.commit()

    db.expire_all()
    original = db.scalar(
        select(LedgerTransaction).where(LedgerTransaction.id == original.id)
    )

    # The original row still exists, marked rather than deleted.
    assert original.status.value == "REVERSED"
    assert original.reversed_by_transaction_id is not None

    # And the money is back where it started.
    assert (
        client.get(f"{API}/wallet", headers=auth_headers).json()["available"] == "0.00"
    )
    assert ledger.reconcile(db).is_balanced
