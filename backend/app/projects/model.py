"""Project and membership models."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.money import MoneyColumn
from app.database.base import Base
from app.database.mixins import TimestampMixin, UUIDPrimaryKeyMixin
from app.projects.constants import MemberStatus, ProjectRole, ProjectStatus


def _pg_enum(enum_cls: type, name: str) -> Enum:
    return Enum(
        enum_cls,
        name=name,
        native_enum=True,
        values_callable=lambda e: [member.value for member in e],
        validate_strings=True,
    )


class Project(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "projects"

    title: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)

    client_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    receiver_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )

    #: Who was invited, when they do not have an account yet.
    #:
    #: Without this a client could only ever hire someone already on TrustPay,
    #: which made the product unusable for a first-time user: creating a project
    #: for an unregistered freelancer failed outright. The email is claimed and
    #: `receiver_id` is filled in the moment that person registers.
    invited_receiver_email: Mapped[str | None] = mapped_column(
        String(255), nullable=True, index=True
    )

    total_amount: Mapped[Decimal] = mapped_column(MoneyColumn, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)

    status: Mapped[ProjectStatus] = mapped_column(
        _pg_enum(ProjectStatus, "project_status"),
        nullable=False,
        default=ProjectStatus.DRAFT,
        server_default=ProjectStatus.DRAFT.value,
        index=True,
    )

    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    accepted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    #: Free text the client pasted for AI agreement analysis (spec section 25).
    agreement_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    milestones: Mapped[list["Milestone"]] = relationship(  # noqa: F821
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="Milestone.sequence",
    )
    members: Mapped[list["ProjectMember"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint("total_amount > 0", name="total_amount_is_positive"),
        CheckConstraint(
            "end_date IS NULL OR start_date IS NULL OR end_date >= start_date",
            name="end_date_after_start_date",
        ),
        # A client hiring themselves would make approval meaningless — they
        # would be both the party releasing the money and the one receiving it.
        CheckConstraint(
            "receiver_id IS NULL OR receiver_id <> client_id",
            name="client_and_receiver_differ",
        ),
        Index("ix_projects_client_id_status", "client_id", "status"),
    )

    def role_of(self, user_id: uuid.UUID) -> ProjectRole | None:
        if user_id == self.client_id:
            return ProjectRole.CLIENT
        if self.receiver_id and user_id == self.receiver_id:
            return ProjectRole.RECEIVER
        return None

    def involves(self, user_id: uuid.UUID) -> bool:
        return self.role_of(user_id) is not None


class ProjectMember(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Invitation record. Keeps the history of who was invited and what they
    decided, which `Project.receiver_id` alone cannot express."""

    __tablename__ = "project_members"

    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    #: NULL while the invitation is still only an email address.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )

    #: Set for an invitation sent to someone without an account yet.
    invited_email: Mapped[str | None] = mapped_column(
        String(255), nullable=True, index=True
    )

    role: Mapped[ProjectRole] = mapped_column(
        _pg_enum(ProjectRole, "project_role"), nullable=False
    )
    status: Mapped[MemberStatus] = mapped_column(
        _pg_enum(MemberStatus, "project_member_status"),
        nullable=False,
        default=MemberStatus.PENDING,
        server_default=MemberStatus.PENDING.value,
    )

    invited_by_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    responded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    project: Mapped[Project] = relationship(back_populates="members")

    __table_args__ = (
        # Still prevents the same person joining twice; NULLs are distinct in
        # PostgreSQL, so pending email invitations do not collide.
        UniqueConstraint(
            "project_id", "user_id", name="uq_project_members_project_id_user_id"
        ),
        UniqueConstraint(
            "project_id",
            "invited_email",
            name="uq_project_members_project_id_invited_email",
        ),
        CheckConstraint(
            "user_id IS NOT NULL OR invited_email IS NOT NULL",
            name="member_has_user_or_email",
        ),
    )
