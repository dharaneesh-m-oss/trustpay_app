"""User request/response contracts."""

from __future__ import annotations

import re
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.core.constants import UserRole, UserStatus

# Loose E.164: optional +, 8-15 digits. Deliberately permissive about country
# formats while still refusing anything an SMS gateway could not dial.
_PHONE_RE = re.compile(r"^\+?[1-9]\d{7,14}$")


def _normalize_email(value: str) -> str:
    return value.strip().lower()


class _EmailNormalizer(BaseModel):
    @field_validator("email", check_fields=False)
    @classmethod
    def _lower_email(cls, value: str) -> str:
        return _normalize_email(value)


class UserRegisterRequest(_EmailNormalizer):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=10, max_length=72)
    phone: str | None = Field(default=None, max_length=20)

    @field_validator("full_name")
    @classmethod
    def _clean_name(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if len(cleaned) < 2:
            raise ValueError("Please enter your full name.")
        return cleaned

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = re.sub(r"[\s\-()]", "", value)
        if not _PHONE_RE.match(cleaned):
            raise ValueError("Please enter a valid phone number.")
        return cleaned


class UserResponse(BaseModel):
    """The public shape of a user. `password_hash` is structurally absent — it
    cannot leak through a response model that has no field for it."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    email: EmailStr
    phone: str | None
    role: UserRole
    status: UserStatus
    created_at: datetime


class UserProfileResponse(UserResponse):
    email_verified_at: datetime | None
    phone_verified_at: datetime | None
    last_login_at: datetime | None


class UserUpdateRequest(BaseModel):
    """Email is intentionally not updatable here.

    Changing the address an account signs in with — and to which security
    notifications are sent — through an ordinary profile PUT is an account
    takeover path. It has its own endpoint that requires the current password.
    """

    full_name: str = Field(min_length=2, max_length=120)
    phone: str | None = Field(default=None, max_length=20)

    _clean_name = field_validator("full_name")(UserRegisterRequest._clean_name.__func__)  # type: ignore[attr-defined]
    _check_phone = field_validator("phone")(UserRegisterRequest._check_phone.__func__)  # type: ignore[attr-defined]


class ChangeEmailRequest(_EmailNormalizer):
    new_email: EmailStr
    current_password: str = Field(min_length=1, max_length=72)

    @field_validator("new_email")
    @classmethod
    def _lower_new_email(cls, value: str) -> str:
        return _normalize_email(value)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=72)
    new_password: str = Field(min_length=10, max_length=72)

    @field_validator("new_password")
    @classmethod
    def _not_same(cls, value: str, info) -> str:
        current = info.data.get("current_password")
        if current and value == current:
            raise ValueError("New password must be different from the current one.")
        return value


class MessageResponse(BaseModel):
    message: str
