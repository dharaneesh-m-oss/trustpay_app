"""Wallet persistence."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.wallet.model import Wallet


def get_by_user_id(db: Session, user_id: uuid.UUID) -> Wallet | None:
    return db.scalar(select(Wallet).where(Wallet.user_id == user_id))


def add(db: Session, wallet: Wallet) -> Wallet:
    db.add(wallet)
    db.flush()
    return wallet
