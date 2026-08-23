"""Project persistence."""

from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.projects.model import Project, ProjectMember


def add(db: Session, project: Project) -> Project:
    db.add(project)
    db.flush()
    return project


def add_member(db: Session, member: ProjectMember) -> ProjectMember:
    db.add(member)
    db.flush()
    return member


def get(db: Session, project_id: uuid.UUID) -> Project | None:
    return db.scalar(
        select(Project)
        .where(Project.id == project_id)
        .options(selectinload(Project.milestones))
    )


def _visible_to(user_id: uuid.UUID):
    """A project is visible only to its client and its receiver.

    Applied as a WHERE clause rather than a post-fetch check so an unauthorised
    project never leaves the database in the first place.
    """
    return or_(Project.client_id == user_id, Project.receiver_id == user_id)


def list_for_user(
    db: Session, user_id: uuid.UUID, *, limit: int, offset: int
) -> list[Project]:
    return list(
        db.scalars(
            select(Project)
            .where(_visible_to(user_id))
            .options(selectinload(Project.milestones))
            .order_by(Project.created_at.desc())
            .limit(limit)
            .offset(offset)
        ).all()
    )


def count_for_user(db: Session, user_id: uuid.UUID) -> int:
    return int(
        db.scalar(
            select(func.count()).select_from(Project).where(_visible_to(user_id))
        )
        or 0
    )


def get_member(
    db: Session, project_id: uuid.UUID, user_id: uuid.UUID
) -> ProjectMember | None:
    return db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
    )


def count_by_status(db: Session, user_id: uuid.UUID, statuses: list) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(Project)
            .where(_visible_to(user_id), Project.status.in_(statuses))
        )
        or 0
    )
