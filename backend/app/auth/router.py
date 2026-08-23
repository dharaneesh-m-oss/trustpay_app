"""Authentication endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.auth import service as auth_service
from app.auth.dependencies import get_current_user, get_request_context
from app.auth.schema import (
    LoginRequest,
    LoginResponse,
    LogoutRequest,
    RefreshRequest,
    SessionRevokedResponse,
    TokenResponse,
)
from app.core.context import RequestContext
from app.dependencies.database import get_db
from app.users.model import User
from app.users.schema import UserResponse

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post(
    "/login",
    response_model=LoginResponse,
    summary="Sign in with email and password",
)
def login(
    payload: LoginRequest,
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
) -> LoginResponse:
    session = auth_service.login(db, payload.email, payload.password, context)
    return LoginResponse(
        access_token=session.access_token,
        refresh_token=session.refresh_token,
        expires_in=session.expires_in,
        user=UserResponse.model_validate(session.user),
    )


@router.post(
    "/token",
    response_model=TokenResponse,
    summary="OAuth2 password grant (used by the interactive docs)",
    include_in_schema=True,
)
def login_oauth2_form(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
) -> TokenResponse:
    # OAuth2 calls the identifier field "username"; for TrustPay it is the email.
    session = auth_service.login(db, form_data.username, form_data.password, context)
    return TokenResponse(
        access_token=session.access_token,
        refresh_token=session.refresh_token,
        expires_in=session.expires_in,
    )


@router.post(
    "/refresh",
    response_model=TokenResponse,
    summary="Exchange a refresh token for a new token pair",
)
def refresh(
    payload: RefreshRequest,
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
) -> TokenResponse:
    session = auth_service.refresh_session(db, payload.refresh_token, context)
    return TokenResponse(
        access_token=session.access_token,
        refresh_token=session.refresh_token,
        expires_in=session.expires_in,
    )


@router.post(
    "/logout",
    response_model=SessionRevokedResponse,
    status_code=status.HTTP_200_OK,
    summary="Revoke the current session, or every session",
)
def logout(
    payload: LogoutRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
) -> SessionRevokedResponse:
    revoked = auth_service.logout(
        db,
        current_user,
        raw_refresh_token=payload.refresh_token,
        all_sessions=payload.all_sessions,
        context=context,
    )
    return SessionRevokedResponse(
        message="Signed out.", sessions_revoked=revoked
    )
