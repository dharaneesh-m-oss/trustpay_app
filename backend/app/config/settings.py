"""Application configuration.

Every tunable value lives here and is sourced from the environment. Nothing in
the codebase may hardcode a secret, a threshold, or a risk band — section 19 of
the product spec requires those to be configurable rather than scattered
through the application.
"""

from __future__ import annotations

from decimal import Decimal
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "staging", "production", "test"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    # ---------- Application ----------
    APP_NAME: str = "TrustPay"
    APP_VERSION: str = "0.2.0"
    ENVIRONMENT: Environment = "development"
    DEBUG: bool = False

    HOST: str = "127.0.0.1"
    PORT: int = 8000

    API_PREFIX: str = "/api/v1"

    # ---------- Database ----------
    DATABASE_URL: str
    """The Postgres URL.

    Accepts whatever a hosting provider hands you. Neon, Supabase, Render and
    Heroku all issue `postgresql://` (and Heroku still issues `postgres://`),
    while SQLAlchemy needs the driver named explicitly - `postgresql+psycopg://`
    for psycopg 3. Pasting the provider's URL unchanged would otherwise fail at
    startup with an error about psycopg2, a package this project does not use
    and which nobody would think to look for. See `_normalise_database_url`.
    """

    DB_ECHO: bool = False
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20

    # ---------- Security ----------
    SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    MAX_FAILED_LOGIN_ATTEMPTS: int = 5
    ACCOUNT_LOCKOUT_MINUTES: int = 15
    PASSWORD_MIN_LENGTH: int = 10

    # bcrypt hashes at most the first 72 bytes of a password; anything longer is
    # silently truncated, so we reject it at the boundary instead.
    PASSWORD_MAX_BYTES: int = 72
    BCRYPT_ROUNDS: int = 12

    # ---------- Money ----------
    # TrustPay is not a bank, a licensed payment institution, or a custodian.
    # DEMO_MODE keeps every financial movement inside the simulated ledger.
    DEMO_MODE: bool = True
    DEFAULT_CURRENCY: str = "INR"
    MONEY_PRECISION: int = 18
    MONEY_SCALE: int = 2

    # ---------- AI ----------
    #: When unset, every AI feature falls back to its deterministic analyser and
    #: says so in the response. Nothing breaks without a key.
    ANTHROPIC_API_KEY: str | None = None

    OPENAI_API_KEY: str | None = None
    OPENAI_MODEL: str = "gpt-4o"
    """Override if your account has a different model enabled."""

    AI_PROVIDER: Literal["auto", "claude", "openai", "rules"] = "auto"
    """Which engine answers.

    `auto` prefers Claude and falls back to OpenAI, so setting either key is
    enough. Naming one pins it, which is what you want when comparing them or
    when a bill should land on one account. `rules` switches models off entirely
    without removing the keys.
    """

    AI_ENABLED: bool = True
    AI_MODEL: str = "claude-opus-5"
    #: low | medium | high | xhigh | max — how hard the model thinks.
    AI_EFFORT: str = "high"
    #: Kept short: a payments screen cannot hang waiting on an analysis.
    AI_TIMEOUT_SECONDS: float = 30.0

    @property
    def ai_configured(self) -> bool:
        return bool(self.AI_ENABLED and (self.ANTHROPIC_API_KEY or self.OPENAI_API_KEY))

    @property
    def ai_provider(self) -> str:
        """The engine that will actually answer, given the keys present.

        Returns "rules" when nothing usable is configured, so callers can ask
        one question instead of re-deriving the precedence in three places.
        """
        if not self.AI_ENABLED or self.AI_PROVIDER == "rules":
            return "rules"
        if self.AI_PROVIDER == "claude":
            return "claude" if self.ANTHROPIC_API_KEY else "rules"
        if self.AI_PROVIDER == "openai":
            return "openai" if self.OPENAI_API_KEY else "rules"
        if self.ANTHROPIC_API_KEY:
            return "claude"
        if self.OPENAI_API_KEY:
            return "openai"
        return "rules"

    # ---------- Google Sign-In ----------
    GOOGLE_CLIENT_ID: str | None = None
    """The OAuth *web* client id. Tokens from the app are verified against it."""

    GOOGLE_ANDROID_CLIENT_ID: str | None = None
    """The Android client id, if the app requests tokens under its own."""

    @property
    def google_configured(self) -> bool:
        return bool(self.GOOGLE_CLIENT_ID or self.GOOGLE_ANDROID_CLIENT_ID)

    @property
    def google_audiences(self) -> list[str]:
        """Every client id a token may legitimately be issued for."""
        return [
            value
            for value in (self.GOOGLE_CLIENT_ID, self.GOOGLE_ANDROID_CLIENT_ID)
            if value
        ]

    # ---------- Payments ----------
    # Real money needs a payment aggregator account, which needs business KYC.
    # Absent these, the payment endpoints refuse rather than simulate: a wallet
    # that credits itself without a provider confirmation is not a wallet.
    RAZORPAY_KEY_ID: str | None = None
    RAZORPAY_KEY_SECRET: str | None = None
    RAZORPAY_WEBHOOK_SECRET: str | None = None

    RAZORPAY_PAYOUT_ACCOUNT: str | None = None
    """The RazorpayX virtual account payouts are funded from."""

    MERCHANT_VPA: str | None = None
    """The UPI address collections are addressed to."""

    MERCHANT_NAME: str = "TrustPay"

    MIN_PAYOUT_AMOUNT: Decimal = Decimal("100.00")
    PAYOUT_DAILY_LIMIT: Decimal = Decimal("50000.00")

    @property
    def payments_configured(self) -> bool:
        return bool(self.RAZORPAY_KEY_ID and self.RAZORPAY_KEY_SECRET)

    @property
    def payouts_configured(self) -> bool:
        return bool(self.payments_configured and self.RAZORPAY_PAYOUT_ACCOUNT)

    # ---------- CORS ----------
    CORS_ORIGINS: str = ""

    @field_validator("DATABASE_URL")
    @classmethod
    def _normalise_database_url(cls, value: str) -> str:
        """Name the driver, and require TLS on a hosted database."""
        url = value.strip()

        if url.startswith("postgres://"):
            # Heroku's historical scheme, which SQLAlchemy dropped support for.
            url = "postgresql://" + url[len("postgres://") :]

        if url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://") :]

        # A managed Postgres reached over the public internet without TLS would
        # put the password and every row on the wire in clear text. Providers
        # include this in the URL they give you; a hand-edited one may not.
        host = url.split("@")[-1].split("/")[0].lower()
        remote = not any(
            token in host for token in ("localhost", "127.0.0.1", "::1")
        )
        if remote and "sslmode=" not in url:
            separator = "&" if "?" in url else "?"
            url = f"{url}{separator}sslmode=require"

        return url

    @field_validator("SECRET_KEY")
    @classmethod
    def _reject_placeholder_secret(cls, value: str) -> str:
        weak = {
            "change_this_to_a_long_random_secret_key",
            "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET_KEY",
            "secret",
            "changeme",
        }
        if value in weak or value.lower().startswith("replace_me"):
            raise ValueError(
                "SECRET_KEY is still the placeholder value. Generate one with: "
                'python -c "import secrets; print(secrets.token_urlsafe(64))"'
            )
        if len(value) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters.")
        return value

    @field_validator("DEFAULT_CURRENCY")
    @classmethod
    def _currency_is_iso_4217(cls, value: str) -> str:
        if len(value) != 3 or not value.isalpha():
            raise ValueError("DEFAULT_CURRENCY must be a 3-letter ISO 4217 code.")
        return value.upper()

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def access_token_ttl_seconds(self) -> int:
        return self.ACCESS_TOKEN_EXPIRE_MINUTES * 60

    @property
    def refresh_token_ttl_seconds(self) -> int:
        return self.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
