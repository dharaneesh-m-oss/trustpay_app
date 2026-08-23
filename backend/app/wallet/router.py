"""Wallet endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_active_user, get_request_context
from app.config.settings import settings
from app.core.context import RequestContext
from app.dependencies.database import get_db
from app.users.model import User
from app.wallet import service as wallet_service
from app.wallet.schema import (
    TopUpRequest,
    TransactionPage,
    TransactionResponse,
    WalletBalanceResponse,
    WithdrawRequest,
)

router = APIRouter(prefix="/wallet", tags=["Wallet"])


def _to_balance_response(balances: wallet_service.WalletBalances) -> WalletBalanceResponse:
    wallet = balances.wallet
    return WalletBalanceResponse(
        wallet_id=wallet.id,
        currency=wallet.currency,
        available=balances.available,
        protected=balances.protected,
        pending_settlement=balances.pending_settlement,
        total=balances.total,
        is_frozen=wallet.is_frozen,
        kyc_verified=wallet.kyc_verified_at is not None,
        demo_mode=settings.DEMO_MODE,
    )


@router.get(
    "",
    response_model=WalletBalanceResponse,
    summary="Available, protected and pending balances",
)
def get_wallet(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> WalletBalanceResponse:
    return _to_balance_response(wallet_service.get_balances(db, current_user))


@router.post(
    "/top-up",
    response_model=WalletBalanceResponse,
    summary="Add money (simulated while DEMO_MODE is on)",
)
def top_up(
    payload: TopUpRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
) -> WalletBalanceResponse:
    wallet_service.top_up(
        db,
        current_user,
        payload.amount,
        idempotency_key=payload.idempotency_key,
        description=payload.description,
        context=context,
    )
    return _to_balance_response(wallet_service.get_balances(db, current_user))


@router.post(
    "/withdraw",
    response_model=WalletBalanceResponse,
    summary="Withdraw available funds",
)
def withdraw(
    payload: WithdrawRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
) -> WalletBalanceResponse:
    wallet_service.withdraw(
        db,
        current_user,
        payload.amount,
        idempotency_key=payload.idempotency_key,
        description=payload.description,
        context=context,
    )
    return _to_balance_response(wallet_service.get_balances(db, current_user))


@router.get(
    "/transactions",
    response_model=TransactionPage,
    summary="Transaction history",
)
def list_transactions(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> TransactionPage:
    transactions, total = wallet_service.list_transactions(
        db, current_user, limit=limit, offset=offset
    )

    items = []
    for transaction in transactions:
        direction, net = wallet_service.describe_for_user(db, transaction, current_user)
        items.append(
            TransactionResponse(
                id=transaction.id,
                transaction_type=transaction.transaction_type,
                status=transaction.status,
                amount=transaction.amount,
                currency=transaction.currency,
                description=transaction.description,
                created_at=transaction.created_at,
                project_id=transaction.project_id,
                milestone_id=transaction.milestone_id,
                sender_user_id=transaction.sender_user_id,
                receiver_user_id=transaction.receiver_user_id,
                is_simulated=transaction.is_simulated,
                direction_for_user=direction,
                net_effect=net,
            )
        )

    return TransactionPage(items=items, total=total, limit=limit, offset=offset)
