"""User domain errors."""

from __future__ import annotations

from app.core.exceptions import (
    AuthenticationError,
    ConflictError,
    DuplicateEmailError,
    NotFoundError,
)


class UserNotFoundError(NotFoundError):
    code = "USER_NOT_FOUND"
    message = "We could not find that account."


class EmailAlreadyRegisteredError(DuplicateEmailError):
    pass


class PhoneAlreadyRegisteredError(ConflictError):
    code = "PHONE_ALREADY_REGISTERED"
    message = "An account already exists with this phone number."


class IncorrectPasswordError(AuthenticationError):
    code = "INCORRECT_PASSWORD"
    status_code = 400
    message = "The current password you entered is incorrect."
