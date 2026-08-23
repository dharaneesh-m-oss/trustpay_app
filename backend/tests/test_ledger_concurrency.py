"""Concurrency.

The single-threaded test client cannot exercise the row locks in
`ledger.post()`, so these tests drive real parallel sessions against the real
database. They are the reason `SELECT … FOR UPDATE` and the deterministic lock
ordering exist at all.
"""

from __future__ import annotations

import threading
import uuid
from decimal import Decimal

from sqlalchemy import select

from app.core.exceptions import InsufficientFundsError
from app.database.session import SessionLocal
from app.ledger import service as ledger
from app.ledger.constants import AccountType, PostingDirection, TransactionType
from app.ledger.model import LedgerAccount, LedgerTransaction
from app.users.model import User
from app.wallet import service as wallet_service


def _fetch_user(email: str) -> User:
    with SessionLocal() as session:
        return session.scalar(select(User).where(User.email == email))


def _top_up(user_id: uuid.UUID, amount: str, key: str | None = None) -> None:
    with SessionLocal() as session:
        user = session.get(User, user_id)
        wallet_service.top_up(session, user, Decimal(amount), idempotency_key=key)


def _run_in_threads(target, count: int) -> list[Exception]:
    """Run `target` in parallel and collect anything it raised.

    A thread that dies quietly makes a concurrency test pass for the wrong
    reason, so failures are surfaced rather than swallowed.
    """
    failures: list[Exception] = []
    lock = threading.Lock()

    def wrapper() -> None:
        try:
            target()
        except Exception as exc:  # noqa: BLE001 - reported to the test
            with lock:
                failures.append(exc)

    threads = [threading.Thread(target=wrapper) for _ in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert not any(thread.is_alive() for thread in threads), "a thread hung"
    return failures


def test_concurrent_top_ups_all_land(registered_user, db) -> None:
    """Ten parallel deposits must produce exactly ten deposits' worth.

    A read-modify-write on a balance column would lose updates here; the row
    lock is what makes the arithmetic come out right.
    """
    user = _fetch_user(registered_user["email"])

    failures = _run_in_threads(lambda: _top_up(user.id, "100.00"), 10)
    assert not failures, failures

    db.expire_all()
    available = db.scalar(
        select(LedgerAccount).where(
            LedgerAccount.owner_user_id == user.id,
            LedgerAccount.account_type == AccountType.USER_AVAILABLE,
        )
    )
    assert available.balance == Decimal("1000.00")
    assert ledger.reconcile(db).is_balanced


def test_concurrent_withdrawals_cannot_overdraw(registered_user, db) -> None:
    """Five parallel withdrawals against a balance that only covers three.

    Exactly three must succeed. Without the lock, all five could read the same
    starting balance and every one of them would think it had funds.
    """
    user = _fetch_user(registered_user["email"])
    _top_up(user.id, "300.00")

    outcomes: list[str] = []
    lock = threading.Lock()

    def attempt() -> None:
        with SessionLocal() as session:
            reloaded = session.get(User, user.id)
            try:
                wallet_service.withdraw(session, reloaded, Decimal("100.00"))
                result = "ok"
            except InsufficientFundsError:
                result = "refused"
            except Exception as exc:  # serialisation failures count as refusals
                result = f"error:{type(exc).__name__}"
        with lock:
            outcomes.append(result)

    threads = [threading.Thread(target=attempt) for _ in range(5)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert outcomes.count("ok") == 3, outcomes

    db.expire_all()
    available = db.scalar(
        select(LedgerAccount).where(
            LedgerAccount.owner_user_id == user.id,
            LedgerAccount.account_type == AccountType.USER_AVAILABLE,
        )
    )
    assert available.balance == Decimal("0.00")
    assert available.balance >= 0
    assert ledger.reconcile(db).is_balanced


def test_concurrent_requests_with_one_idempotency_key_post_once(
    registered_user, db
) -> None:
    """The unique index, not the pre-check, is what makes this safe.

    Both requests can read "no transaction with this key" before either writes.
    """
    user = _fetch_user(registered_user["email"])
    key = "concurrent-key-abcdef12"

    errors: list[Exception] = []

    def attempt() -> None:
        try:
            _top_up(user.id, "500.00", key)
        except Exception as exc:  # recorded, then asserted on below
            errors.append(exc)

    threads = [threading.Thread(target=attempt) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    db.expire_all()
    transactions = db.scalars(
        select(LedgerTransaction).where(LedgerTransaction.idempotency_key == key)
    ).all()

    assert len(transactions) == 1, f"{len(transactions)} transactions, errors={errors}"

    available = db.scalar(
        select(LedgerAccount).where(
            LedgerAccount.owner_user_id == user.id,
            LedgerAccount.account_type == AccountType.USER_AVAILABLE,
        )
    )
    assert available.balance == Decimal("500.00")
    assert ledger.reconcile(db).is_balanced


def test_opposing_transfers_do_not_deadlock(registered_user, client, db) -> None:
    """Two transfers touching the same accounts in opposite directions.

    Locks are taken in a single global order inside `lock_accounts()`, so these
    serialise instead of deadlocking.
    """
    first = _fetch_user(registered_user["email"])

    client.post(
        f"/api/v1/users/register",
        json={
            "full_name": "Second Party",
            "email": "second@example.com",
            "password": "TrustPay2026x",
        },
    )
    second = _fetch_user("second@example.com")

    _top_up(first.id, "1000.00")
    _top_up(second.id, "1000.00")

    def transfer(sender_id: uuid.UUID, receiver_id: uuid.UUID) -> None:
        with SessionLocal() as session:
            source = ledger.get_or_create_account(
                session,
                owner_user_id=sender_id,
                account_type=AccountType.USER_AVAILABLE,
            )
            destination = ledger.get_or_create_account(
                session,
                owner_user_id=receiver_id,
                account_type=AccountType.USER_AVAILABLE,
            )
            ledger.post(
                session,
                transaction_type=TransactionType.ADJUSTMENT,
                postings=[
                    ledger.PostingRequest(
                        account_id=source.id,
                        direction=PostingDirection.DEBIT,
                        amount=Decimal("50.00"),
                    ),
                    ledger.PostingRequest(
                        account_id=destination.id,
                        direction=PostingDirection.CREDIT,
                        amount=Decimal("50.00"),
                    ),
                ],
                description="Opposing transfer",
            )
            session.commit()

    threads = [
        threading.Thread(target=transfer, args=(first.id, second.id))
        for _ in range(5)
    ] + [
        threading.Thread(target=transfer, args=(second.id, first.id))
        for _ in range(5)
    ]

    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert not any(thread.is_alive() for thread in threads), "a transfer deadlocked"

    db.expire_all()
    # Equal numbers of transfers each way: both balances end where they started.
    for user_id in (first.id, second.id):
        account = db.scalar(
            select(LedgerAccount).where(
                LedgerAccount.owner_user_id == user_id,
                LedgerAccount.account_type == AccountType.USER_AVAILABLE,
            )
        )
        assert account.balance == Decimal("1000.00")

    assert ledger.reconcile(db).is_balanced
