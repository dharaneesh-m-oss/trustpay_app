"""Authentication contracts."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.users.schema import UserResponse


class LoginRequest(BaseModel):
    """JSON login.

    The OAuth2 password form (`username`/`password`) is still served at
    /auth/token so the interactive docs "Authorize" button keeps working, but
    the mobile client posts JSON against this model.
    """

    email: EmailStr
    password: str = Field(min_length=1, max_length=72)

    @field_validator("email")
    @classmethod
    def _lower(cls, value: str) -> str:
        return value.strip().lower()


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=16, max_length=512)


class LogoutRequest(BaseModel):
    refresh_token: str | None = Field(default=None, max_length=512)
    all_sessions: bool = False


class TokenResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds until the access token expires


class LoginResponse(TokenResponse):
    user: UserResponse


class SessionRevokedResponse(BaseModel):
    message: str
    sessions_revoked: int


class GoogleSignInRequest(BaseModel):
    """The ID token issued to the app by Google Sign-In."""

    id_token: str = Field(min_length=32, max_length=4096)
