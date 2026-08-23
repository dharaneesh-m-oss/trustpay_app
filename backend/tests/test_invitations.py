"""Inviting someone who is not on TrustPay yet.

The bug these cover: creating a project for a receiver without an account
failed with 404, and creating one without a receiver left the project in DRAFT
where it could never be funded. A first-time user therefore could not produce a
usable project at all.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config.settings import settings
from app.ledger import service as ledger
from app.projects.model import Project, ProjectMember
from app.users.model import User

API = settings.API_PREFIX


def _register(client: TestClient, name: str, email: str) -> None:
    response = client.post(
        f"{API}/users/register",
        json={"full_name": name, "email": email, "password": "TrustPay2026x"},
    )
    assert response.status_code == 201, response.text


def _headers(client: TestClient, email: str) -> dict[str, str]:
    token = client.post(
        f"{API}/auth/login", json={"email": email, "password": "TrustPay2026x"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _payload(receiver_email: str | None) -> dict:
    return {
        "title": "Brand identity",
        "description": "Logo and brand guidelines for a new company.",
        "receiver_email": receiver_email,
        "total_amount": "15000.00",
        "milestones": [
            {
                "title": "Concepts",
                "description": "Three logo directions.",
                "completion_criteria": "Deliver 3 distinct logo concepts as PDF for review.",
                "amount": "6000.00",
            },
            {
                "title": "Final artwork",
                "description": "Refine the chosen direction.",
                "completion_criteria": "Deliver final logo files in SVG and PNG plus a one-page guide.",
                "amount": "9000.00",
            },
        ],
    }


def test_can_invite_someone_who_has_not_registered_yet(client: TestClient) -> None:
    _register(client, "Nina Client", "nina@example.com")
    headers = _headers(client, "nina@example.com")

    response = client.post(
        f"{API}/projects", json=_payload("newcomer@example.com"), headers=headers
    )

    assert response.status_code == 201, response.text
    body = response.json()
    # The project is genuinely waiting on that person, not stuck in DRAFT.
    assert body["status"] == "AWAITING_ACCEPTANCE"
    assert body["receiver"] is None
    assert body["invited_receiver_email"] == "newcomer@example.com"


def test_the_invitation_is_claimed_when_that_person_registers(
    client: TestClient, db
) -> None:
    _register(client, "Nina Client", "nina@example.com")
    client_headers = _headers(client, "nina@example.com")

    project_id = client.post(
        f"{API}/projects", json=_payload("newcomer@example.com"), headers=client_headers
    ).json()["id"]

    # The receiver signs up afterwards.
    _register(client, "New Comer", "newcomer@example.com")
    receiver_headers = _headers(client, "newcomer@example.com")

    # They can now see the project waiting for them.
    listed = client.get(f"{API}/projects", headers=receiver_headers).json()
    assert listed["total"] == 1
    assert listed["items"][0]["id"] == project_id
    assert listed["items"][0]["your_role"] == "RECEIVER"

    # And they were told about it.
    feed = client.get(f"{API}/notifications", headers=receiver_headers).json()
    assert any(
        item["notification_type"] == "PROJECT_INVITATION" for item in feed["items"]
    )

    # The membership row now points at a real account.
    db.expire_all()
    member = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.role == "RECEIVER",
        )
    )
    assert member.user_id is not None
    assert member.invited_email is None

    stored = db.scalar(select(Project).where(Project.id == project_id))
    assert stored.receiver_id == member.user_id
    assert stored.invited_receiver_email is None


def test_the_whole_flow_works_end_to_end_after_a_late_signup(
    client: TestClient, db
) -> None:
    """The dead end is gone: invite → they join → accept → fund → release."""
    _register(client, "Nina Client", "nina@example.com")
    client_headers = _headers(client, "nina@example.com")
    client.post(f"{API}/wallet/top-up", json={"amount": "20000.00"}, headers=client_headers)

    created = client.post(
        f"{API}/projects", json=_payload("newcomer@example.com"), headers=client_headers
    ).json()

    _register(client, "New Comer", "newcomer@example.com")
    receiver_headers = _headers(client, "newcomer@example.com")

    accepted = client.post(
        f"{API}/projects/{created['id']}/accept", headers=receiver_headers
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "ACTIVE"

    milestone_id = created["milestones"][0]["id"]
    funded = client.post(
        f"{API}/milestones/{milestone_id}/fund", json={}, headers=client_headers
    )
    assert funded.status_code == 200, funded.text

    client.post(
        f"{API}/milestones/{milestone_id}/submit",
        json={"note": "Three concepts delivered."},
        headers=receiver_headers,
    )
    released = client.post(
        f"{API}/milestones/{milestone_id}/approve", json={}, headers=client_headers
    )
    assert released.status_code == 200, released.text

    assert client.get(f"{API}/wallet", headers=receiver_headers).json()["available"] == "6000.00"
    assert ledger.reconcile(db).is_balanced


def test_a_draft_project_can_be_given_a_receiver_later(client: TestClient) -> None:
    _register(client, "Nina Client", "nina@example.com")
    headers = _headers(client, "nina@example.com")

    draft = client.post(f"{API}/projects", json=_payload(None), headers=headers).json()
    assert draft["status"] == "DRAFT"

    invited = client.post(
        f"{API}/projects/{draft['id']}/invite",
        json={"receiver_email": "somebody.new@example.com"},
        headers=headers,
    )
    assert invited.status_code == 200, invited.text
    assert invited.json()["status"] == "AWAITING_ACCEPTANCE"
    assert invited.json()["invited_receiver_email"] == "somebody.new@example.com"


def test_you_still_cannot_invite_yourself(client: TestClient) -> None:
    _register(client, "Nina Client", "nina@example.com")
    headers = _headers(client, "nina@example.com")

    response = client.post(
        f"{API}/projects", json=_payload("nina@example.com"), headers=headers
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "CANNOT_INVITE_SELF"


def test_an_unrelated_signup_claims_nothing(client: TestClient) -> None:
    _register(client, "Nina Client", "nina@example.com")
    headers = _headers(client, "nina@example.com")
    client.post(f"{API}/projects", json=_payload("newcomer@example.com"), headers=headers)

    _register(client, "Someone Else", "unrelated@example.com")
    other = _headers(client, "unrelated@example.com")

    assert client.get(f"{API}/projects", headers=other).json()["total"] == 0
