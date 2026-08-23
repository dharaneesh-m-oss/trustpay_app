"""Project and milestone contracts."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_serializer, field_validator, model_validator

from app.core.money import as_field_error, to_money
from app.milestones.constants import MilestoneStatus
from app.projects.constants import MAX_MILESTONES, MIN_MILESTONES, ProjectStatus


class MoneyModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    @field_serializer("*", when_used="json")
    def _serialise_decimals(self, value: object) -> object:
        return f"{value:.2f}" if isinstance(value, Decimal) else value


class MilestoneCreate(BaseModel):
    title: str = Field(min_length=3, max_length=150)
    description: str = Field(min_length=3, max_length=4000)
    completion_criteria: str = Field(min_length=3, max_length=2000)
    amount: Decimal
    due_date: date | None = None
    revision_limit: int = Field(default=2, ge=0, le=10)

    @field_validator("amount", mode="before")
    @classmethod
    def _reject_float(cls, value: object) -> object:
        return str(value) if isinstance(value, float) else value

    @field_validator("amount")
    @classmethod
    def _positive(cls, value: Decimal) -> Decimal:
        return as_field_error(value, "Milestone amount")


class ProjectCreate(BaseModel):
    title: str = Field(min_length=3, max_length=150)
    description: str = Field(min_length=3, max_length=4000)

    #: Invite by email. The receiver may not have an account yet in a later
    #: phase; today they must, and the service says so plainly if they do not.
    receiver_email: EmailStr | None = None

    total_amount: Decimal
    currency: str | None = Field(default=None, min_length=3, max_length=3)

    start_date: date | None = None
    end_date: date | None = None

    agreement_text: str | None = Field(default=None, max_length=20000)

    milestones: list[MilestoneCreate] = Field(
        min_length=MIN_MILESTONES, max_length=MAX_MILESTONES
    )

    @field_validator("total_amount", mode="before")
    @classmethod
    def _reject_float(cls, value: object) -> object:
        return str(value) if isinstance(value, float) else value

    @field_validator("total_amount")
    @classmethod
    def _positive(cls, value: Decimal) -> Decimal:
        return as_field_error(value, "Project total")

    @field_validator("receiver_email")
    @classmethod
    def _lower(cls, value: str | None) -> str | None:
        return value.strip().lower() if value else None

    @model_validator(mode="after")
    def _check_consistency(self) -> "ProjectCreate":
        # Section 10's critical validation. Checked here so a malformed project
        # never reaches the service, and again in the service so a caller that
        # bypasses the schema cannot slip past it.
        milestone_total = sum(
            (to_money(item.amount) for item in self.milestones), Decimal("0.00")
        )
        if milestone_total != to_money(self.total_amount):
            raise ValueError(
                f"Milestone amounts add up to {milestone_total:.2f}, "
                f"but the project total is {to_money(self.total_amount):.2f}."
            )

        titles = [item.title.strip().lower() for item in self.milestones]
        if len(set(titles)) != len(titles):
            raise ValueError("Each milestone needs a distinct name.")

        if self.end_date and self.start_date and self.end_date < self.start_date:
            raise ValueError("The completion date cannot be before the start date.")

        for index, item in enumerate(self.milestones, start=1):
            if item.due_date and self.end_date and item.due_date > self.end_date:
                raise ValueError(
                    f"Milestone {index} is due after the project's completion date."
                )

        return self


class ProjectInviteRequest(BaseModel):
    receiver_email: EmailStr

    @field_validator("receiver_email")
    @classmethod
    def _lower(cls, value: str) -> str:
        return value.strip().lower()


class PartySummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    email: EmailStr


class MilestoneResponse(MoneyModel):
    id: uuid.UUID
    project_id: uuid.UUID
    sequence: int
    title: str
    description: str
    completion_criteria: str
    amount: Decimal
    currency: str
    due_date: date | None
    status: MilestoneStatus
    status_label: str

    revision_limit: int
    revisions_used: int

    funded_at: datetime | None
    submitted_at: datetime | None
    released_at: datetime | None

    is_funded: bool
    is_released: bool


class SubmissionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    attempt: int
    note: str
    completion_percentage: int
    evidence: list
    review_note: str | None
    reviewed_at: datetime | None
    created_at: datetime


class ProjectResponse(MoneyModel):
    id: uuid.UUID
    title: str
    description: str
    status: ProjectStatus

    total_amount: Decimal
    currency: str

    #: Derived, not stored: the sum currently held against this project's
    #: milestones. Storing it would be a second copy of ledger truth.
    protected_amount: Decimal
    released_amount: Decimal

    start_date: date | None
    end_date: date | None
    created_at: datetime

    client: PartySummary
    receiver: PartySummary | None

    #: Set when the receiver was invited by email but has not registered
    #: yet, so the client can see the invitation is waiting on a signup.
    invited_receiver_email: str | None = None

    #: The signed-in user's role on this project, so the client can render the
    #: right actions without inferring it.
    your_role: str

    milestones_total: int
    milestones_completed: int


class ProjectDetailResponse(ProjectResponse):
    milestones: list[MilestoneResponse]
    agreement_text: str | None


class ProjectListResponse(BaseModel):
    items: list[ProjectResponse]
    total: int


class FundMilestoneRequest(BaseModel):
    idempotency_key: str | None = Field(default=None, min_length=8, max_length=128)


class SubmitMilestoneRequest(BaseModel):
    note: str = Field(min_length=3, max_length=4000)
    completion_percentage: int = Field(default=100, ge=0, le=100)
    evidence: list[dict] = Field(default_factory=list, max_length=20)


class ReviewMilestoneRequest(BaseModel):
    """Used for both approval and change requests; `note` is required for the
    latter, because "changes requested" with no explanation is useless to the
    receiver."""

    note: str | None = Field(default=None, max_length=4000)
    idempotency_key: str | None = Field(default=None, min_length=8, max_length=128)


class RequestChangesRequest(BaseModel):
    note: str = Field(min_length=3, max_length=4000)
