"""Double-entry posting.

`post()` is the only way money moves in TrustPay. Wallet top-ups, milestone
funding, payment release and refunds all reduce to a call here with a different
set of postings, which means the balancing rule, the negative-balance guard, the
locking order and the idempotency check are written once instead of being
re-implemented (and eventually got wrong) in each flow.

**This module does not commit.** It stages work on the caller's session so a
business operation — postings, milestone state change, audit row — commits as a
single atomic unit (spec section 13).
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config.settings import settings
from app.core.money import ZERO, require_positive, to_money
from app.ledger import repository as ledger_repo
from app.ledger.constants import (
    NORMAL_BALANCE,
    USER_ACCOUNT_TYPES,
    AccountType,
    PostingDirection,
    TransactionStatus,
    TransactionType,
)
from app.ledger.exceptions import (
    CurrencyMismatchError,
    DuplicateIdempotencyKeyError,
    InsufficientBalanceError,
    InvalidPostingError,
    LedgerAccountNotFoundError,
    TransactionAlreadyReversedError,
    UnbalancedTransactionError,
)
from app.ledger.model import LedgerAccount, LedgerPosting, LedgerTransaction


@dataclass(frozen=True, slots=True)
class PostingRequest:
    """One side of a movement."""

    account_id: uuid.UUID
    direction: PostingDirection
    amount: Decimal
    note: str | None = None


# ------------------------------------------------------------------ accounts


def get_or_create_account(
    db: Session,
    *,
    owner_user_id: uuid.UUID | None,
    account_type: AccountType,
    currency: str | None = None,
) -> LedgerAccount:
    """Fetch an account, creating it if this is the first use.

    The insert runs inside a SAVEPOINT. Two requests can both find no account
    and both try to create one — the shared system accounts make this routine,
    not theoretical — and the unique index rejects the loser. Without the
    savepoint that rejection would poison the caller's whole transaction, taking
    an unrelated top-up down with it; with it, only the insert is rolled back
    and the winner's row is then read normally.
    """
    currency = (currency or settings.DEFAULT_CURRENCY).upper()

    existing = ledger_repo.get_account(
        db,
        owner_user_id=owner_user_id,
        account_type=account_type,
        currency=currency,
    )
    if existing is not None:
        return existing

    try:
        with db.begin_nested():
            return ledger_repo.add_account(
                db,
                LedgerAccount(
                    owner_user_id=owner_user_id,
                    account_type=account_type,
                    currency=currency,
                    balance=ZERO,
                ),
            )
    except IntegrityError:
        conflicting = ledger_repo.get_account(
            db,
            owner_user_id=owner_user_id,
            account_type=account_type,
            currency=currency,
        )
        if conflicting is None:
            # The constraint that fired was not the one we expected.
            raise
        return conflicting


def open_user_accounts(
    db: Session, user_id: uuid.UUID, currency: str | None = None
) -> dict[AccountType, LedgerAccount]:
    """Create the three accounts every user needs, all at zero."""
    return {
        account_type: get_or_create_account(
            db,
            owner_user_id=user_id,
            account_type=account_type,
            currency=currency,
        )
        for account_type in (
            AccountType.USER_AVAILABLE,
            AccountType.USER_PROTECTED,
            AccountType.USER_PENDING_SETTLEMENT,
        )
    }


def system_account(
    db: Session, account_type: AccountType, currency: str | None = None
) -> LedgerAccount:
    return get_or_create_account(
        db, owner_user_id=None, account_type=account_type, currency=currency
    )


# ------------------------------------------------------------------ posting


def _signed_delta(
    account_type: AccountType, direction: PostingDirection, amount: Decimal
) -> Decimal:
    """How much this posting changes the account's balance.

    A posting in the account's normal direction increases it; the opposite
    direction decreases it. That single rule is why a credit adds to a user's
    available balance but subtracts from the external-source account.
    """
    return amount if NORMAL_BALANCE[account_type] == direction else -amount


def _fingerprint(
    transaction_type: TransactionType,
    currency: str,
    postings: list[PostingRequest],
) -> str:
    """Stable hash of what a request asked for.

    Used to tell "the client retried the same request" apart from "the client
    reused a key for something else" — the first should return the original
    result, the second is a bug worth surfacing.
    """
    payload = {
        "type": str(transaction_type),
        "currency": currency,
        "postings": sorted(
            [
                {
                    "account": str(posting.account_id),
                    "direction": str(posting.direction),
                    "amount": str(to_money(posting.amount)),
                }
                for posting in postings
            ],
            key=lambda item: (item["account"], item["direction"], item["amount"]),
        ),
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def post(
    db: Session,
    *,
    transaction_type: TransactionType,
    postings: list[PostingRequest],
    description: str,
    currency: str | None = None,
    initiated_by_user_id: uuid.UUID | None = None,
    sender_user_id: uuid.UUID | None = None,
    receiver_user_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    milestone_id: uuid.UUID | None = None,
    idempotency_key: str | None = None,
) -> LedgerTransaction:
    """Record one balanced transaction. Stages; does not commit.

    Validation happens before anything is written, so a rejected transaction
    leaves no partial state behind even before the caller rolls back.
    """
    currency = (currency or settings.DEFAULT_CURRENCY).upper()

    if len(postings) < 2:
        raise InvalidPostingError("A transaction needs at least two postings.")

    normalised = [
        PostingRequest(
            account_id=posting.account_id,
            direction=posting.direction,
            amount=require_positive(posting.amount, "Posting amount"),
            note=posting.note,
        )
        for posting in postings
    ]

    debit_total = sum(
        (p.amount for p in normalised if p.direction == PostingDirection.DEBIT),
        ZERO,
    )
    credit_total = sum(
        (p.amount for p in normalised if p.direction == PostingDirection.CREDIT),
        ZERO,
    )

    if debit_total != credit_total:
        raise UnbalancedTransactionError(
            details={"debits": str(debit_total), "credits": str(credit_total)}
        )
    if debit_total == ZERO:
        raise InvalidPostingError("A transaction must move a non-zero amount.")

    fingerprint = _fingerprint(transaction_type, currency, normalised)

    if idempotency_key:
        existing = ledger_repo.get_by_idempotency_key(db, idempotency_key)
        if existing is not None:
            # Same key, same request: hand back what was already recorded rather
            # than moving the money a second time.
            if existing.request_fingerprint == fingerprint:
                return existing
            raise DuplicateIdempotencyKeyError()

    # Lock every account before touching a balance. Deterministic ordering
    # inside lock_accounts() prevents deadlock between concurrent transfers.
    accounts = ledger_repo.lock_accounts(db, [p.account_id for p in normalised])

    missing = {p.account_id for p in normalised} - set(accounts)
    if missing:
        raise LedgerAccountNotFoundError(
            details={"accounts": sorted(str(item) for item in missing)}
        )

    for account in accounts.values():
        if account.currency != currency:
            raise CurrencyMismatchError(
                details={"expected": currency, "found": account.currency}
            )

    # Apply deltas in memory first: if any user account would go negative the
    # whole transaction is refused before a single row is written.
    projected: dict[uuid.UUID, Decimal] = {
        account_id: to_money(account.balance)
        for account_id, account in accounts.items()
    }

    for posting in normalised:
        account = accounts[posting.account_id]
        projected[posting.account_id] += _signed_delta(
            account.account_type, posting.direction, posting.amount
        )

    for account_id, balance in projected.items():
        account = accounts[account_id]
        if account.account_type in USER_ACCOUNT_TYPES and balance < ZERO:
            raise InsufficientBalanceError(
                details={
                    "account_type": str(account.account_type),
                    "available": str(to_money(account.balance)),
                    "short_by": str(-balance),
                }
            )

    transaction = ledger_repo.add_transaction(
        db,
        LedgerTransaction(
            transaction_type=transaction_type,
            status=TransactionStatus.POSTED,
            amount=debit_total,
            currency=currency,
            initiated_by_user_id=initiated_by_user_id,
            sender_user_id=sender_user_id,
            receiver_user_id=receiver_user_id,
            project_id=project_id,
            milestone_id=milestone_id,
            description=description[:255],
            idempotency_key=idempotency_key,
            request_fingerprint=fingerprint,
            is_simulated=settings.DEMO_MODE,
        ),
    )

    # Running balances are recorded per posting, in a stable order, so a
    # statement can show "balance after" without replaying history.
    running: dict[uuid.UUID, Decimal] = {
        account_id: to_money(account.balance)
        for account_id, account in accounts.items()
    }

    for posting in normalised:
        account = accounts[posting.account_id]
        running[posting.account_id] += _signed_delta(
            account.account_type, posting.direction, posting.amount
        )
        ledger_repo.add_posting(
            db,
            LedgerPosting(
                transaction_id=transaction.id,
                account_id=posting.account_id,
                direction=posting.direction,
                amount=posting.amount,
                balance_after=running[posting.account_id],
                note=posting.note,
            ),
        )

    # Update the cached balances in the same transaction as the postings.
    for account_id, balance in projected.items():
        accounts[account_id].balance = balance

    db.flush()
    return transaction


def reverse(
    db: Session,
    transaction: LedgerTransaction,
    *,
    description: str,
    initiated_by_user_id: uuid.UUID | None = None,
    idempotency_key: str | None = None,
) -> LedgerTransaction:
    """Undo a transaction by posting its mirror image.

    The original rows are left untouched. Correcting a ledger by editing history
    destroys the audit trail; correcting it by posting the opposite entry is
    what accountants actually do.
    """
    if transaction.reversed_by_transaction_id is not None:
        raise TransactionAlreadyReversedError()

    opposite = {
        PostingDirection.DEBIT: PostingDirection.CREDIT,
        PostingDirection.CREDIT: PostingDirection.DEBIT,
    }

    mirrored = [
        PostingRequest(
            account_id=posting.account_id,
            direction=opposite[posting.direction],
            amount=posting.amount,
            note=f"Reversal of {transaction.id}",
        )
        for posting in transaction.postings
    ]

    reversal = post(
        db,
        transaction_type=TransactionType.ADJUSTMENT,
        postings=mirrored,
        description=description,
        currency=transaction.currency,
        initiated_by_user_id=initiated_by_user_id,
        sender_user_id=transaction.receiver_user_id,
        receiver_user_id=transaction.sender_user_id,
        project_id=transaction.project_id,
        milestone_id=transaction.milestone_id,
        idempotency_key=idempotency_key,
    )

    transaction.status = TransactionStatus.REVERSED
    transaction.reversed_by_transaction_id = reversal.id
    db.flush()
    return reversal


# ----------------------------------------------------------- reconciliation


@dataclass(frozen=True, slots=True)
class AccountDiscrepancy:
    account_id: uuid.UUID
    account_type: str
    owner_user_id: uuid.UUID | None
    cached_balance: Decimal
    computed_balance: Decimal

    @property
    def difference(self) -> Decimal:
        return self.cached_balance - self.computed_balance


@dataclass(frozen=True, slots=True)
class ReconciliationReport:
    total_debits: Decimal
    total_credits: Decimal
    accounts_checked: int
    discrepancies: list[AccountDiscrepancy]

    @property
    def is_balanced(self) -> bool:
        return self.total_debits == self.total_credits and not self.discrepancies


def reconcile(db: Session) -> ReconciliationReport:
    """Prove the books balance.

    Two independent checks: global debits must equal global credits, and every
    cached account balance must equal the balance recomputed from that account's
    postings. A discrepancy means a bug, and it is better to find it here than
    in a user's statement.
    """
    total_debits, total_credits = ledger_repo.totals_by_direction(db)

    discrepancies: list[AccountDiscrepancy] = []
    accounts = ledger_repo.all_accounts(db)

    for account in accounts:
        debits, credits = ledger_repo.account_posting_totals(db, account.id)
        computed = (
            credits - debits
            if NORMAL_BALANCE[account.account_type] == PostingDirection.CREDIT
            else debits - credits
        )
        if to_money(computed) != to_money(account.balance):
            discrepancies.append(
                AccountDiscrepancy(
                    account_id=account.id,
                    account_type=str(account.account_type),
                    owner_user_id=account.owner_user_id,
                    cached_balance=to_money(account.balance),
                    computed_balance=to_money(computed),
                )
            )

    return ReconciliationReport(
        total_debits=to_money(total_debits),
        total_credits=to_money(total_credits),
        accounts_checked=len(accounts),
        discrepancies=discrepancies,
    )
