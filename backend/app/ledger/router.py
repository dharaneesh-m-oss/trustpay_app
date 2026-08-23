"""Ledger endpoints.

Admin-only. The ledger is the accounting substrate; ordinary users see their
money through the wallet, not through raw postings.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.dependencies import require_admin
from app.dependencies.database import get_db
from app.ledger import service as ledger
from app.users.model import User
from app.wallet.schema import ReconciliationResponse

router = APIRouter(prefix="/ledger", tags=["Ledger"])


@router.get(
    "/reconciliation",
    response_model=ReconciliationResponse,
    summary="Verify that the books balance",
)
def reconciliation(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ReconciliationResponse:
    """Recompute every balance from the postings and compare.

    Two failures are possible and both matter: global debits not matching global
    credits (a transaction was written unbalanced), or a cached account balance
    disagreeing with its own postings (a balance was updated outside the ledger
    primitive).
    """
    report = ledger.reconcile(db)

    return ReconciliationResponse(
        is_balanced=report.is_balanced,
        total_debits=report.total_debits,
        total_credits=report.total_credits,
        accounts_checked=report.accounts_checked,
        discrepancies=[
            {
                "account_id": str(item.account_id),
                "account_type": item.account_type,
                "owner_user_id": str(item.owner_user_id) if item.owner_user_id else None,
                "cached_balance": str(item.cached_balance),
                "computed_balance": str(item.computed_balance),
                "difference": str(item.difference),
            }
            for item in report.discrepancies
        ],
    )
