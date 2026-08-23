"""User endpoints.

Handlers do three things only: bind the request, call a service, shape the
response. There is no business logic and no error translation here — services
raise TrustPayError subclasses that the application-wide handler renders.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user, get_request_context
from app.core.context import RequestContext
from app.dependencies.database import get_db
from app.users import service as users_service
from app.users.model import User
from app.users.schema import (
    ChangeEmailRequest,
    ChangePasswordRequest,
    MessageResponse,
    UserProfileResponse,
    UserRegisterRequest,
    UserResponse,
    UserUpdateRequest,
)

router = APIRouter(prefix="/users", tags=["Users"])


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a TrustPay account",
)
def register(
    payload: UserRegisterRequest,
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
) -> User:
    return users_service.register_user(db, payload, context)


@router.get(
    "/me",
    response_model=UserProfileResponse,
    summary="Get the signed-in user's profile",
)
def get_me(current_user: User = Depends(get_current_user)) -> User:
    # The dependency already loaded the user; re-querying would be a wasted trip.
    return current_user


@router.put(
    "/me",
    response_model=UserProfileResponse,
    summary="Update name and phone number",
)
def update_me(
    payload: UserUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
) -> User:
    return users_service.update_profile(db, current_user, payload, context)


@router.post(
    "/me/email",
    response_model=UserProfileResponse,
    summary="Change the sign-in email address (requires the current password)",
)
def change_email(
    payload: ChangeEmailRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
) -> User:
    return users_service.change_email(db, current_user, payload, context)


@router.post(
    "/me/password",
    response_model=MessageResponse,
    summary="Change password and sign out every session",
)
def change_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    context: RequestContext = Depends(get_request_context),
) -> MessageResponse:
    revoked = users_service.change_password(db, current_user, payload, context)
    return MessageResponse(
        message=(
            "Password changed. "
            f"{revoked} active session(s) were signed out for your security."
        )
    )
