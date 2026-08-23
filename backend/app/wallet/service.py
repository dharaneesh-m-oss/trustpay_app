"""Wallet business logic.

The wallet is a *view* over a user's ledger accounts plus the operations that
move money across the system boundary: top up and withdraw. Movements that stay
inside TrustPay — funding a milestone, releasing a payment, refunding a
cancellation — belong to the escrow module and will call the same ledger
primitive.

These functions own their transaction: they call `ledger.service.post()`, write
an audit row, and commit once.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import service as audit
from app.config.settings import settings
from app.core.constants import AuditAction
from app.core.context import RequestContext
from app.core.money import ZERO, to_money
from app.ledger import repository as ledger_repo
from app.ledger import service as ledger
from app.ledger.constants import (
    NORMAL_BALANCE,
    AccountType,
    PostingDirection,
    TransactionType,
)
from app.ledger.model import LedgerTransaction
from app.users.model import User
from app.wallet import repository as wallet_repo
from app.wallet.constants import (
    LARGE_TRANSACTION_THRESHOLD,
    MAX_TOP_UP,
    MAX_WITHDRAWAL,
    MIN_TOP_UP,
    MIN_WITHDRAWAL,
)
from app.wallet.exceptions import (
    AmountLimitError,
    WalletFrozenError,
    WalletNotFoundError,
)
from app.wallet.model import Wallet


@dataclass(frozen=True, slots=True)
class WalletBalances:
    wallet: Wallet
    available: Decimal
    protected: Decimal
    pending_settlement: Decimal

    @property
    def total(self) -> Decimal:
        return self.available + self.protected + self.pending_settlement


# ---------------------------------------------------------------- lifecycle


def create_wallet_for_user(
    db: Session, user: User, currency: str | None = None
) -> Wallet:
    """Open a wallet and its ledger accounts. Stages; does not commit.

    Called from user registration so it joins that transaction — a user without
    a wallet is a broken state, and creating them separately would allow it.
    """
    currency = (currency or settings.DEFAULT_CURRENCY).upper()

    existing = wallet_repo.get_by_user_id(db, user.id)
    if existing is not None:
        return existing

    wallet = wallet_repo.add(db, Wallet(user_id=user.id, currency=currency))
    ledger.open_user_accounts(db, user.id, currency)
    return wallet


def get_wallet(db: Session, user: User) -> Wallet:
    wallet = wallet_repo.get_by_user_id(db, user.id)
    if wallet is None:
        raise WalletNotFoundError()
    return wallet


def get_balances(db: Session, user: User) -> WalletBalances:
    """Assemble the wallet view from the ledger.

    Reads the cached balances on the ledger accounts; `ledger.reconcile()`
    is what proves those caches match the postings.
    """
    wallet = get_wallet(db, user)
    accounts = {
        account.account_type: account
        for account in ledger_repo.list_accounts_for_user(db, user.id, wallet.currency)
    }

    def balance_of(account_type: AccountType) -> Decimal:
        account = accounts.get(account_type)
        return to_money(account.balance) if account else ZERO

    return WalletBalances(
        wallet=wallet,
        available=balance_of(AccountType.USER_AVAILABLE),
        protected=balance_of(AccountType.USER_PROTECTED),
        pending_settlement=balance_of(AccountType.USER_PENDING_SETTLEMENT),
    )


# ------------------------------------------------------------------ movements


def _assert_wallet_usable(wallet: Wallet) -> None:
    if wallet.is_frozen:
        raise WalletFrozenError()


def _assert_within_limits(
    amount: Decimal, minimum: Decimal, maximum: Decimal
) -> Decimal:
    amount = to_money(amount)
    if amount < minimum:
        raise AmountLimitError(f"The minimum amount is {minimum:.2f}.")
    if amount > maximum:
        raise AmountLimitError(f"The maximum amount is {maximum:,.2f}.")
    return amount


def top_up(
    db: Session,
    user: User,
    amount: Decimal,
    *,
    idempotency_key: str | None = None,
    description: str | None = None,
    context: RequestContext | None = None,
) -> LedgerTransaction:
    """Add money to the available balance.

    In DEMO_MODE this is a simulated deposit: the external-source account stands
    in for the payment provider that would fund it in production. The postings
    are identical either way, so wiring a real provider later changes who calls
    this, not what it records.
    """
    context = context or RequestContext()
    wallet = get_wallet(db, user)
    _assert_wallet_usable(wallet)

    amount = _assert_within_limits(amount, MIN_TOP_UP, MAX_TOP_UP)

    source = ledger.system_account(
        db, AccountType.SYSTEM_EXTERNAL_SOURCE, wallet.currency
    )
    available = ledger.get_or_create_account(
        db,
        owner_user_id=user.id,
        account_type=AccountType.USER_AVAILABLE,
        currency=wallet.currency,
    )

    try:
        transaction = ledger.post(
            db,
            transaction_type=TransactionType.TOP_UP,
            postings=[
                ledger.PostingRequest(
                    account_id=source.id,
                    direction=PostingDirection.DEBIT,
                    amount=amount,
                ),
                ledger.PostingRequest(
                    account_id=available.id,
                    direction=PostingDirection.CREDIT,
                    amount=amount,
                ),
            ],
            description=description or "Money added to wallet",
            currency=wallet.currency,
            initiated_by_user_id=user.id,
            receiver_user_id=user.id,
            idempotency_key=idempotency_key,
        )

        audit.record(
            db,
            action=AuditAction.WALLET_TOPPED_UP,
            actor_user_id=user.id,
            entity_type="ledger_transaction",
            entity_id=transaction.id,
            context={
                "amount": str(amount),
                "currency": wallet.currency,
                "simulated": settings.DEMO_MODE,
                "flagged_large": amount >= LARGE_TRANSACTION_THRESHOLD,
            },
            ip_address=context.ip_address,
            user_agent=context.user_agent,
        )
        db.commit()
    except IntegrityError as exc:
        # Two identical requests raced past the idempotency pre-check; the
        # unique index caught the second one. Return the winner's transaction.
        db.rollback()
        if idempotency_key:
            existing = ledger_repo.get_by_idempotency_key(db, idempotency_key)
            if existing is not None:
                return existing
        raise exc

    return transaction


def withdraw(
    db: Session,
    user: User,
    amount: Decimal,
    *,
    idempotency_key: str | None = None,
    description: str | None = None,
    context: RequestContext | None = None,
) -> LedgerTransaction:
    """Move money out of the available balance.

    Only *available* funds can be withdrawn. Protected money belongs to a
    milestone until it is released or refunded, and the ledger enforces that on
    its own: the postings below never touch the protected account, and the
    negative-balance guard refuses a withdrawal the available balance cannot
    cover.
    """
    context = context or RequestContext()
    wallet = get_wallet(db, user)
    _assert_wallet_usable(wallet)

    amount = _assert_within_limits(amount, MIN_WITHDRAWAL, MAX_WITHDRAWAL)

    # NOTE: production must also require wallet.kyc_verified_at here. It is not
    # enforced while DEMO_MODE is on because no KYC flow exists to satisfy it,
    # and a check nobody can pass would block the demo instead of protecting it.

    available = ledger.get_or_create_account(
        db,
        owner_user_id=user.id,
        account_type=AccountType.USER_AVAILABLE,
        currency=wallet.currency,
    )
    destination = ledger.system_account(
        db, AccountType.SYSTEM_EXTERNAL_SOURCE, wallet.currency
    )

    try:
        transaction = ledger.post(
            db,
            transaction_type=TransactionType.WITHDRAWAL,
            postings=[
                ledger.PostingRequest(
                    account_id=available.id,
                    direction=PostingDirection.DEBIT,
                    amount=amount,
                ),
                ledger.PostingRequest(
                    account_id=destination.id,
                    direction=PostingDirection.CREDIT,
                    amount=amount,
                ),
            ],
            description=description or "Money withdrawn from wallet",
            currency=wallet.currency,
            initiated_by_user_id=user.id,
            sender_user_id=user.id,
            idempotency_key=idempotency_key,
        )

        audit.record(
            db,
            action=AuditAction.WALLET_WITHDRAWN,
            actor_user_id=user.id,
            entity_type="ledger_transaction",
            entity_id=transaction.id,
            context={
                "amount": str(amount),
                "currency": wallet.currency,
                "simulated": settings.DEMO_MODE,
            },
            ip_address=context.ip_address,
            user_agent=context.user_agent,
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if idempotency_key:
            existing = ledger_repo.get_by_idempotency_key(db, idempotency_key)
            if existing is not None:
                return existing
        raise exc

    return transaction


# ----------------------------------------------------------------- statement


def list_transactions(
    db: Session, user: User, *, limit: int = 20, offset: int = 0
) -> tuple[list[LedgerTransaction], int]:
    transactions = ledger_repo.list_transactions_for_user(
        db, user.id, limit=limit, offset=offset
    )
    total = ledger_repo.count_transactions_for_user(db, user.id)
    return transactions, total


def describe_for_user(
    db: Session, transaction: LedgerTransaction, user: User
) -> tuple[str, Decimal]:
    """Return ("CREDIT"|"DEBIT"|"INTERNAL", signed change to available).

    Deliberately measured against the *available* account only. Funding a
    milestone moves money from available to protected: the user still owns it,
    but their statement should show it leaving their spendable balance, because
    that is what they experience.
    """
    wallet_currency = transaction.currency

    available = ledger_repo.get_account(
        db,
        owner_user_id=user.id,
        account_type=AccountType.USER_AVAILABLE,
        currency=wallet_currency,
    )
    if available is None:
        return "INTERNAL", ZERO

    net = ZERO
    for posting in transaction.postings:
        if posting.account_id != available.id:
            continue
        sign = (
            1
            if NORMAL_BALANCE[AccountType.USER_AVAILABLE] == posting.direction
            else -1
        )
        net += sign * to_money(posting.amount)

    if net > ZERO:
        return "CREDIT", net
    if net < ZERO:
        return "DEBIT", net
    return "INTERNAL", ZERO
