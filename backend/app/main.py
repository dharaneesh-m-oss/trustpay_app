"""TrustPay API application.

Trust. Protected.

DISCLAIMER: TrustPay is not a bank, a licensed payment institution, or a
custodian of funds. While DEMO_MODE is enabled every monetary movement is
recorded in a simulated internal ledger and no real money is transferred. The
architecture is shaped so a regulated payment or escrow provider can be
integrated behind the payments module later without reworking the domain.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.auth.router import router as auth_router
from app.config.settings import settings
from app.core.exceptions import TrustPayError
from app.core.logging import configure_logging, get_logger
from app.admin.router import router as admin_router
from app.ai.router import router as ai_router
from app.cancellation.router import router as cancellation_router
from app.disputes.router import router as disputes_router
from app.ledger.router import router as ledger_router
from app.notifications.router import router as notifications_router
from app.projects.router import milestone_router, router as projects_router
from app.users.router import router as users_router
from app.wallet.router import router as wallet_router

configure_logging()
logger = get_logger(__name__)

REQUEST_ID_HEADER = "X-Request-ID"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    logger.info(
        "application_starting",
        environment=settings.ENVIRONMENT,
        demo_mode=settings.DEMO_MODE,
        version=settings.APP_VERSION,
    )
    # Schema creation is Alembic's job (`alembic upgrade head`). Doing it here
    # would let the running app silently disagree with the migration history.
    yield
    logger.info("application_stopping")


app = FastAPI(
    title=f"{settings.APP_NAME} API",
    description=__doc__,
    version=settings.APP_VERSION,
    lifespan=lifespan,
    docs_url="/docs" if not settings.is_production else None,
    redoc_url="/redoc" if not settings.is_production else None,
    openapi_url="/openapi.json" if not settings.is_production else None,
)

if settings.cors_origin_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[REQUEST_ID_HEADER],
    )


@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    """Attach a request id to every log line and every error response.

    When a user reports "my payment failed", the id on their error screen leads
    straight to the log entries for that one request.
    """
    request_id = request.headers.get(REQUEST_ID_HEADER) or str(uuid.uuid4())

    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(
        request_id=request_id,
        method=request.method,
        path=request.url.path,
    )
    request.state.request_id = request_id

    response = await call_next(request)
    response.headers[REQUEST_ID_HEADER] = request_id
    return response


def _error_response(
    request: Request,
    *,
    status_code: int,
    code: str,
    message: str,
    details: dict | None = None,
) -> JSONResponse:
    payload: dict = {"code": code, "message": message}
    if details:
        payload["details"] = details
    payload["request_id"] = getattr(request.state, "request_id", None)
    return JSONResponse(status_code=status_code, content={"error": payload})


@app.exception_handler(TrustPayError)
async def trustpay_error_handler(request: Request, exc: TrustPayError) -> JSONResponse:
    logger.info("domain_error", code=exc.code, status=exc.status_code)
    response = _error_response(
        request,
        status_code=exc.status_code,
        code=exc.code,
        message=exc.message,
        details=exc.details or None,
    )
    if exc.status_code == status.HTTP_401_UNAUTHORIZED:
        response.headers["WWW-Authenticate"] = "Bearer"
    return response


@app.exception_handler(RequestValidationError)
async def validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Turn pydantic's field errors into something a user can act on.

    The raw error list leaks internal model structure, so only the field name
    and the human-readable reason survive.
    """
    fields: dict[str, str] = {}
    for error in exc.errors():
        location = [str(part) for part in error["loc"] if part not in ("body", "query")]
        fields[".".join(location) or "request"] = error.get("msg", "Invalid value.")

    return _error_response(
        request,
        status_code=422,  # Unprocessable Content; the Starlette constant was renamed
        code="VALIDATION_ERROR",
        message="Some of the information provided is not valid.",
        details={"fields": fields},
    )


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    codes = {
        401: "NOT_AUTHENTICATED",
        403: "NOT_AUTHORIZED",
        404: "NOT_FOUND",
        405: "METHOD_NOT_ALLOWED",
        429: "RATE_LIMITED",
    }
    response = _error_response(
        request,
        status_code=exc.status_code,
        code=codes.get(exc.status_code, "HTTP_ERROR"),
        message=str(exc.detail),
    )
    if exc.status_code == status.HTTP_401_UNAUTHORIZED:
        response.headers["WWW-Authenticate"] = "Bearer"
    return response


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Last line of defence.

    The traceback goes to the logs; the client gets a generic message and the
    request id. Stack traces in an API response are a disclosure vulnerability.
    """
    logger.exception("unhandled_exception", error=type(exc).__name__)
    return _error_response(
        request,
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        code="INTERNAL_ERROR",
        message="Something went wrong on our side. Please try again.",
    )


app.include_router(users_router, prefix=settings.API_PREFIX)
app.include_router(auth_router, prefix=settings.API_PREFIX)
app.include_router(wallet_router, prefix=settings.API_PREFIX)
app.include_router(ledger_router, prefix=settings.API_PREFIX)
app.include_router(projects_router, prefix=settings.API_PREFIX)
app.include_router(milestone_router, prefix=settings.API_PREFIX)
app.include_router(cancellation_router, prefix=settings.API_PREFIX)
app.include_router(disputes_router, prefix=settings.API_PREFIX)
app.include_router(notifications_router, prefix=settings.API_PREFIX)
app.include_router(ai_router, prefix=settings.API_PREFIX)
app.include_router(admin_router, prefix=settings.API_PREFIX)


@app.get("/", tags=["System"], summary="Service banner")
def root() -> dict[str, object]:
    return {
        "service": settings.APP_NAME,
        "tagline": "Trust. Protected.",
        "version": settings.APP_VERSION,
        "demo_mode": settings.DEMO_MODE,
        "api": settings.API_PREFIX,
    }


@app.get("/health", tags=["System"], summary="Liveness and database check")
def health() -> dict[str, object]:
    from sqlalchemy import text

    from app.database.session import engine

    database_ok = True
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception:  # pragma: no cover - reported, not raised
        logger.exception("health_check_database_failed")
        database_ok = False

    return {
        "status": "healthy" if database_ok else "degraded",
        "database": "up" if database_ok else "down",
        "environment": settings.ENVIRONMENT,
    }
