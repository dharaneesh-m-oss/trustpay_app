"""Ledger persistence.

Nothing here commits. The ledger is a primitive used *inside* other services'
transactions — funding a milestone writes ledger postings, updates a milestone
and records an audit row, and all of it commits together or not at all.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, selectinload

from app.ledger.constants import AccountType, PostingDirection
from app.ledger.model import LedgerAccount, LedgerPosting, LedgerTransaction


# ------------------------------------------------------------------ accounts


def get_account(
    db: Session,
    *,
    owner_user_id: uuid.UUID | None,
    account_type: AccountType,
    currency: str,
) -> LedgerAccount | None:
    return db.scalar(
        select(LedgerAccount).where(
            LedgerAccount.owner_user_id.is_(None)
            if owner_user_id is None
            else LedgerAccount.owner_user_id == owner_user_id,
            LedgerAccount.account_type == account_type,
            LedgerAccount.currency == currency,
        )
    )


def list_accounts_for_user(
    db: Session, user_id: uuid.UUID, currency: str
) -> list[LedgerAccount]:
    return list(
        db.scalars(
            select(LedgerAccount).where(
                LedgerAccount.owner_user_id == user_id,
                LedgerAccount.currency == currency,
            )
        ).all()
    )


def add_account(db: Session, account: LedgerAccount) -> LedgerAccount:
    db.add(account)
    db.flush()
    return account


def lock_accounts(
    db: Session, account_ids: list[uuid.UUID]
) -> dict[uuid.UUID, LedgerAccount]:
    """Lock every account a transaction touches, in a deterministic order.

    Ordering by id is not cosmetic. Two concurrent transfers touching the same
    pair of accounts in opposite orders will deadlock; taking locks in a single
    global order makes that impossible.

    `populate_existing` is not optional either. If the session already loaded an
    account earlier in this transaction — which it always has, because
    `get_or_create_account` runs first — the ORM would hand back the cached
    instance and its stale `balance`, while the SELECT … FOR UPDATE quietly took
    the lock. Every concurrent writer would then compute its new balance from
    the same outdated number and overwrite the others: the lock held, and the
    updates were still lost.
    """
    ordered = sorted(set(account_ids), key=str)
    accounts = db.scalars(
        select(LedgerAccount)
        .where(LedgerAccount.id.in_(ordered))
        .order_by(LedgerAccount.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).all()
    return {account.id: account for account in accounts}


# -------------------------------------------------------------- transactions


def add_transaction(db: Session, transaction: LedgerTransaction) -> LedgerTransaction:
    db.add(transaction)
    db.flush()
    return transaction


def add_posting(db: Session, posting: LedgerPosting) -> LedgerPosting:
    db.add(posting)
    db.flush()
    return posting


def get_transaction(
    db: Session, transaction_id: uuid.UUID
) -> LedgerTransaction | None:
    return db.scalar(
        select(LedgerTransaction)
        .where(LedgerTransaction.id == transaction_id)
        .options(selectinload(LedgerTransaction.postings))
    )


def get_by_idempotency_key(db: Session, key: str) -> LedgerTransaction | None:
    return db.scalar(
        select(LedgerTransaction)
        .where(LedgerTransaction.idempotency_key == key)
        .options(selectinload(LedgerTransaction.postings))
    )


def _user_transactions_query(user_id: uuid.UUID) -> Select:
    """Every transaction that touched any of this user's accounts.

    Joining through postings rather than filtering on sender/receiver means a
    user still sees their own internal movements — funding a milestone moves
    money between two of their own accounts and has no counterparty.
    """
    owned_accounts = select(LedgerAccount.id).where(
        LedgerAccount.owner_user_id == user_id
    )
    return (
        select(LedgerTransaction)
        .where(
            LedgerTransaction.id.in_(
                select(LedgerPosting.transaction_id).where(
                    LedgerPosting.account_id.in_(owned_accounts)
                )
            )
        )
        .order_by(LedgerTransaction.created_at.desc())
    )


def list_transactions_for_user(
    db: Session, user_id: uuid.UUID, *, limit: int, offset: int
) -> list[LedgerTransaction]:
    return list(
        db.scalars(
            _user_transactions_query(user_id)
            .options(selectinload(LedgerTransaction.postings))
            .limit(limit)
            .offset(offset)
        ).all()
    )


def count_transactions_for_user(db: Session, user_id: uuid.UUID) -> int:
    return int(
        db.scalar(
            select(func.count()).select_from(
                _user_transactions_query(user_id).subquery()
            )
        )
        or 0
    )


# ----------------------------------------------------------- reconciliation


def account_posting_totals(
    db: Session, account_id: uuid.UUID
) -> tuple[Decimal, Decimal]:
    """Total debits and credits posted to one account.

    Recomputing a balance from these is the authoritative answer;
    `LedgerAccount.balance` is only a cache of it.
    """
    debits = db.scalar(
        select(func.coalesce(func.sum(LedgerPosting.amount), 0)).where(
            LedgerPosting.account_id == account_id,
            LedgerPosting.direction == PostingDirection.DEBIT,
        )
    )
    credits = db.scalar(
        select(func.coalesce(func.sum(LedgerPosting.amount), 0)).where(
            LedgerPosting.account_id == account_id,
            LedgerPosting.direction == PostingDirection.CREDIT,
        )
    )
    return Decimal(debits or 0), Decimal(credits or 0)


def totals_by_direction(db: Session) -> tuple[Decimal, Decimal]:
    """Global debit and credit totals. In a sound ledger these are equal."""
    debits = db.scalar(
        select(func.coalesce(func.sum(LedgerPosting.amount), 0)).where(
            LedgerPosting.direction == PostingDirection.DEBIT
        )
    )
    credits = db.scalar(
        select(func.coalesce(func.sum(LedgerPosting.amount), 0)).where(
            LedgerPosting.direction == PostingDirection.CREDIT
        )
    )
    return Decimal(debits or 0), Decimal(credits or 0)


def all_accounts(db: Session) -> list[LedgerAccount]:
    return list(db.scalars(select(LedgerAccount)).all())
