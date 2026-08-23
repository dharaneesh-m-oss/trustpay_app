"""User model."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Enum, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.constants import UserRole, UserStatus
from app.database.base import Base
from app.database.mixins import TimestampMixin, UUIDPrimaryKeyMixin


def _pg_enum(enum_cls: type, name: str) -> Enum:
    """Store the enum's *value* (not the member name) in a native PG enum type."""
    return Enum(
        enum_cls,
        name=name,
        native_enum=True,
        values_callable=lambda e: [member.value for member in e],
        validate_strings=True,
    )


class User(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "users"

    full_name: Mapped[str] = mapped_column(String(120), nullable=False)

    # Stored lower-cased so uniqueness is genuinely case-insensitive; two people
    # must not be able to register A@x.com and a@x.com as different accounts.
    email: Mapped[str] = mapped_column(
        String(255), nullable=False, unique=True, index=True
    )

    # Nullable now, required before a receiver can be sent a cancellation OTP
    # (spec section 15) — the OTP has to reach a verified contact.
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True, unique=True)

    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    """Null for accounts that only ever sign in with Google.

    Storing an unusable placeholder hash instead would be worse: it makes a
    passwordless account indistinguishable from one whose password nobody
    remembers, and invites a password-reset flow that sets a password on an
    account the owner believes has none."""

    google_subject: Mapped[str | None] = mapped_column(
        String(64), nullable=True, unique=True, index=True
    )
    """Google's stable user id. Matched on before email, because an email can be
    reassigned by a workspace admin while `sub` cannot."""

    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    role: Mapped[UserRole] = mapped_column(
        _pg_enum(UserRole, "user_role"),
        nullable=False,
        default=UserRole.USER,
        server_default=UserRole.USER.value,
    )
    status: Mapped[UserStatus] = mapped_column(
        _pg_enum(UserStatus, "user_status"),
        nullable=False,
        default=UserStatus.ACTIVE,
        server_default=UserStatus.ACTIVE.value,
        index=True,
    )

    email_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    phone_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Brute-force protection state (spec section 31: rate limiting).
    failed_login_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    locked_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        CheckConstraint(
            "failed_login_attempts >= 0", name="failed_login_attempts_non_negative"
        ),
        CheckConstraint("char_length(full_name) >= 2", name="full_name_min_length"),
    )

    @property
    def is_admin(self) -> bool:
        return self.role == UserRole.ADMIN

    @property
    def is_email_verified(self) -> bool:
        return self.email_verified_at is not None
