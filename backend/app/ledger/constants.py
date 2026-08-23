"""Ledger vocabulary.

TrustPay keeps a double-entry ledger. Every movement of money is a transaction
made of at least two postings whose debits and credits are equal, so the books
balance by construction rather than by convention.

Account types are split by *purpose*, not lumped into one balance. Section 8 of
the spec is explicit about this: "available", "protected" and "pending
settlement" are different states of money and a single `balance` field cannot
represent them.
"""

from __future__ import annotations

from enum import StrEnum


class PostingDirection(StrEnum):
    DEBIT = "DEBIT"
    CREDIT = "CREDIT"


class AccountType(StrEnum):
    """The accounts money can sit in.

    USER_* accounts belong to a person. SYSTEM_* accounts belong to TrustPay and
    exist so every user-side entry has a counterpart — money never appears from
    nowhere.
    """

    # Held on behalf of a user (liability: TrustPay owes it to them).
    USER_AVAILABLE = "USER_AVAILABLE"
    USER_PROTECTED = "USER_PROTECTED"
    USER_PENDING_SETTLEMENT = "USER_PENDING_SETTLEMENT"

    # The boundary with the world outside the simulation. A top-up debits this
    # account; a withdrawal credits it back.
    SYSTEM_EXTERNAL_SOURCE = "SYSTEM_EXTERNAL_SOURCE"

    # Platform revenue. Unused until fees exist, defined now so fee postings do
    # not require a migration later.
    SYSTEM_FEES = "SYSTEM_FEES"


#: Which direction increases each account.
#:
#: User accounts are liabilities — TrustPay holds the money and owes it to the
#: user — so a CREDIT increases them. The external-source account is the
#: contra side and behaves the opposite way.
NORMAL_BALANCE: dict[AccountType, PostingDirection] = {
    AccountType.USER_AVAILABLE: PostingDirection.CREDIT,
    AccountType.USER_PROTECTED: PostingDirection.CREDIT,
    AccountType.USER_PENDING_SETTLEMENT: PostingDirection.CREDIT,
    AccountType.SYSTEM_EXTERNAL_SOURCE: PostingDirection.DEBIT,
    AccountType.SYSTEM_FEES: PostingDirection.CREDIT,
}

#: Account types that belong to a user and must never go negative.
USER_ACCOUNT_TYPES = frozenset(
    {
        AccountType.USER_AVAILABLE,
        AccountType.USER_PROTECTED,
        AccountType.USER_PENDING_SETTLEMENT,
    }
)

#: Account types owned by the platform rather than a person.
SYSTEM_ACCOUNT_TYPES = frozenset(
    {
        AccountType.SYSTEM_EXTERNAL_SOURCE,
        AccountType.SYSTEM_FEES,
    }
)


class TransactionType(StrEnum):
    """Why money moved. Shown to users, so the names are self-explanatory."""

    TOP_UP = "TOP_UP"
    WITHDRAWAL = "WITHDRAWAL"
    MILESTONE_FUNDING = "MILESTONE_FUNDING"
    PAYMENT_RELEASE = "PAYMENT_RELEASE"
    REFUND = "REFUND"
    FEE = "FEE"
    ADJUSTMENT = "ADJUSTMENT"


class TransactionStatus(StrEnum):
    """A posted transaction is already reflected in the balances.

    There is no PENDING state that has been written to the ledger: entries are
    only written once the movement is real. REVERSED means a later,
    compensating transaction undid this one — ledger rows are never edited or
    deleted, because an editable ledger is not a ledger.
    """

    POSTED = "POSTED"
    REVERSED = "REVERSED"


#: How each transaction type reads on a statement, from the perspective of the
#: user whose account the posting touched.
TRANSACTION_LABELS: dict[TransactionType, str] = {
    TransactionType.TOP_UP: "Money added",
    TransactionType.WITHDRAWAL: "Money withdrawn",
    TransactionType.MILESTONE_FUNDING: "Milestone funded",
    TransactionType.PAYMENT_RELEASE: "Payment released",
    TransactionType.REFUND: "Refund",
    TransactionType.FEE: "Platform fee",
    TransactionType.ADJUSTMENT: "Adjustment",
}
