"""Model registry.

Importing this module imports every mapped class, which is what populates
`Base.metadata`. Alembic autogenerate and `create_all` both need that to be
complete — a model that is never imported is silently missing from migrations.
"""

from __future__ import annotations

from app.ai.model import AIAnalysis, RiskSignal, TrustScore
from app.audit.model import AuditLog
from app.auth.model import RefreshToken
from app.cancellation.model import CancellationRequest, OtpVerification
from app.database.base import Base
from app.disputes.model import Dispute, DisputeMessage
from app.ledger.model import LedgerAccount, LedgerPosting, LedgerTransaction
from app.milestones.model import Milestone, MilestoneSubmission
from app.notifications.model import Notification
from app.projects.model import Project, ProjectMember
from app.users.model import User
from app.wallet.model import Wallet

__all__ = [
    "Base",
    "AIAnalysis",
    "AuditLog",
    "CancellationRequest",
    "Dispute",
    "DisputeMessage",
    "LedgerAccount",
    "LedgerPosting",
    "LedgerTransaction",
    "Milestone",
    "MilestoneSubmission",
    "Notification",
    "OtpVerification",
    "Project",
    "ProjectMember",
    "RefreshToken",
    "RiskSignal",
    "TrustScore",
    "User",
    "Wallet",
]
