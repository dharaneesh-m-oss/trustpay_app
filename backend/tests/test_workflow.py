"""The three flows that define TrustPay (spec section 53).

Flow A — create, fund, submit, approve, release.
Flow B — fund, request cancellation, receiver verifies, refund.
Flow C — dispute, AI summary, admin resolution.

Every one of these ends by asserting the ledger still reconciles. A workflow
that produces the right screens but leaves the books unbalanced has not worked.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config.settings import settings
from app.core.constants import UserRole
from app.ledger import service as ledger
from app.milestones.model import Milestone
from app.users.model import User

API = settings.API_PREFIX


# ------------------------------------------------------------------ fixtures


def _register(client: TestClient, name: str, email: str) -> dict:
    response = client.post(
        f"{API}/users/register",
        json={"full_name": name, "email": email, "password": "TrustPay2026x"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _login(client: TestClient, email: str) -> dict[str, str]:
    response = client.post(
        f"{API}/auth/login", json={"email": email, "password": "TrustPay2026x"}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def parties(client: TestClient) -> dict:
    """A client with money and a receiver, ready to transact."""
    _register(client, "Priya Client", "priya@example.com")
    _register(client, "Rahul Receiver", "rahul@example.com")

    client_headers = _login(client, "priya@example.com")
    receiver_headers = _login(client, "rahul@example.com")

    client.post(
        f"{API}/wallet/top-up", json={"amount": "50000.00"}, headers=client_headers
    )

    return {
        "client_headers": client_headers,
        "receiver_headers": receiver_headers,
        "client_email": "priya@example.com",
        "receiver_email": "rahul@example.com",
    }


def _project_payload(**overrides) -> dict:
    today = date.today()
    payload = {
        "title": "Website Development",
        "description": "A marketing website with four delivery stages.",
        "receiver_email": "rahul@example.com",
        "total_amount": "20000.00",
        "start_date": today.isoformat(),
        "end_date": (today + timedelta(days=60)).isoformat(),
        "milestones": [
            {
                "title": "Design",
                "description": "Wireframes and visual design for all pages.",
                "completion_criteria": "Deliver Figma files for 5 pages, reviewed and approved by the client.",
                "amount": "5000.00",
                "due_date": (today + timedelta(days=15)).isoformat(),
            },
            {
                "title": "Development",
                "description": "Build the site from the approved designs.",
                "completion_criteria": "Deliver a working staging site with all 5 pages implemented and responsive.",
                "amount": "9000.00",
                "due_date": (today + timedelta(days=35)).isoformat(),
            },
            {
                "title": "Testing",
                "description": "Cross-browser and device testing.",
                "completion_criteria": "Provide a test report covering 3 browsers with all issues resolved.",
                "amount": "3000.00",
                "due_date": (today + timedelta(days=50)).isoformat(),
            },
            {
                "title": "Deployment",
                "description": "Deploy to production.",
                "completion_criteria": "Site is live on the client domain with SSL and passes a smoke test.",
                "amount": "3000.00",
                "due_date": (today + timedelta(days=60)).isoformat(),
            },
        ],
    }
    payload.update(overrides)
    return payload


def _create_project(client: TestClient, parties: dict, **overrides) -> dict:
    response = client.post(
        f"{API}/projects",
        json=_project_payload(**overrides),
        headers=parties["client_headers"],
    )
    assert response.status_code == 201, response.text
    return response.json()


# ------------------------------------------------------------ project rules


def test_milestone_amounts_must_equal_the_project_total(
    client: TestClient, parties
) -> None:
    """Section 10's critical validation."""
    payload = _project_payload(total_amount="25000.00")  # milestones still sum to 20000
    response = client.post(
        f"{API}/projects", json=payload, headers=parties["client_headers"]
    )

    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "VALIDATION_ERROR"
    assert "20000" in str(body["details"])


def test_zero_and_negative_milestones_are_refused(client: TestClient, parties) -> None:
    for bad_amount in ("0.00", "-500.00"):
        payload = _project_payload()
        payload["milestones"][0]["amount"] = bad_amount
        response = client.post(
            f"{API}/projects", json=payload, headers=parties["client_headers"]
        )
        assert response.status_code == 422, bad_amount


def test_duplicate_milestone_names_are_refused(client: TestClient, parties) -> None:
    payload = _project_payload()
    payload["milestones"][1]["title"] = payload["milestones"][0]["title"]
    response = client.post(
        f"{API}/projects", json=payload, headers=parties["client_headers"]
    )
    assert response.status_code == 422


def test_end_date_before_start_date_is_refused(client: TestClient, parties) -> None:
    today = date.today()
    payload = _project_payload(
        start_date=today.isoformat(),
        end_date=(today - timedelta(days=5)).isoformat(),
    )
    response = client.post(
        f"{API}/projects", json=payload, headers=parties["client_headers"]
    )
    assert response.status_code == 422


def test_client_cannot_invite_themselves(client: TestClient, parties) -> None:
    payload = _project_payload(receiver_email=parties["client_email"])
    response = client.post(
        f"{API}/projects", json=payload, headers=parties["client_headers"]
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "CANNOT_INVITE_SELF"


def test_a_stranger_cannot_see_the_project(client: TestClient, parties) -> None:
    project = _create_project(client, parties)

    _register(client, "Nosy Stranger", "nosy@example.com")
    stranger = _login(client, "nosy@example.com")

    response = client.get(f"{API}/projects/{project['id']}", headers=stranger)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "NOT_PROJECT_MEMBER"


# ------------------------------------------------------------------- FLOW A


def test_flow_a_create_fund_submit_approve_release(
    client: TestClient, parties, db
) -> None:
    ch, rh = parties["client_headers"], parties["receiver_headers"]

    # 1. Create
    project = _create_project(client, parties)
    assert project["status"] == "AWAITING_ACCEPTANCE"
    assert len(project["milestones"]) == 4
    assert project["milestones"][0]["status"] == "DRAFT"

    # 2. AI analyses the agreement before money is committed
    analysis = client.get(f"{API}/projects/{project['id']}/analysis", headers=ch).json()
    assert analysis["risk_level"] in ("LOW", "MEDIUM", "HIGH")
    assert "disclaimer" in analysis

    # 3. Receiver accepts — milestones become fundable
    accepted = client.post(f"{API}/projects/{project['id']}/accept", headers=rh)
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "ACTIVE"
    assert accepted.json()["milestones"][0]["status"] == "PENDING_FUNDING"

    milestone_id = project["milestones"][0]["id"]

    # 4. Client funds the first milestone
    funded = client.post(
        f"{API}/milestones/{milestone_id}/fund", json={}, headers=ch
    )
    assert funded.status_code == 200, funded.text
    assert funded.json()["status"] == "FUNDED"
    assert funded.json()["is_funded"] is True

    wallet = client.get(f"{API}/wallet", headers=ch).json()
    assert wallet["available"] == "45000.00"
    assert wallet["protected"] == "5000.00"

    # The receiver has not been paid yet.
    assert client.get(f"{API}/wallet", headers=rh).json()["available"] == "0.00"

    # 5. Receiver submits proof
    submitted = client.post(
        f"{API}/milestones/{milestone_id}/submit",
        json={
            "note": "All five page designs are complete and shared.",
            "completion_percentage": 100,
            "evidence": [{"type": "link", "url": "https://figma.com/file/abc"}],
        },
        headers=rh,
    )
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["status"] == "SUBMITTED"

    # 6. Client asks for changes, receiver resubmits
    changed = client.post(
        f"{API}/milestones/{milestone_id}/request-changes",
        json={"note": "The pricing page needs the new tiers."},
        headers=ch,
    )
    assert changed.json()["status"] == "CHANGES_REQUESTED"

    resubmitted = client.post(
        f"{API}/milestones/{milestone_id}/submit",
        json={"note": "Pricing page updated with the new tiers.", "evidence": []},
        headers=rh,
    )
    assert resubmitted.status_code == 200
    assert resubmitted.json()["status"] == "SUBMITTED"
    assert resubmitted.json()["revisions_used"] == 1

    # 7. Client approves — payment releases atomically
    approved = client.post(
        f"{API}/milestones/{milestone_id}/approve", json={}, headers=ch
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "PAYMENT_RELEASED"

    # 8. The money actually moved
    client_wallet = client.get(f"{API}/wallet", headers=ch).json()
    receiver_wallet = client.get(f"{API}/wallet", headers=rh).json()

    assert client_wallet["available"] == "45000.00"
    assert client_wallet["protected"] == "0.00"
    assert receiver_wallet["available"] == "5000.00"

    # 9. Both parties can see it in their history
    receiver_history = client.get(f"{API}/wallet/transactions", headers=rh).json()
    assert receiver_history["total"] == 1
    assert receiver_history["items"][0]["transaction_type"] == "PAYMENT_RELEASE"
    assert receiver_history["items"][0]["net_effect"] == "5000.00"

    assert ledger.reconcile(db).is_balanced


def test_funding_requires_sufficient_available_balance(
    client: TestClient, parties
) -> None:
    ch, rh = parties["client_headers"], parties["receiver_headers"]
    project = _create_project(client, parties, total_amount="80000.00",
                              milestones=[{
                                  "title": "Everything",
                                  "description": "The whole job in one go.",
                                  "completion_criteria": "Deliver the complete project and pass client review.",
                                  "amount": "80000.00",
                              }])
    client.post(f"{API}/projects/{project['id']}/accept", headers=rh)

    response = client.post(
        f"{API}/milestones/{project['milestones'][0]['id']}/fund", json={}, headers=ch
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INSUFFICIENT_FUNDS"


def test_receiver_cannot_fund_and_client_cannot_submit(
    client: TestClient, parties
) -> None:
    ch, rh = parties["client_headers"], parties["receiver_headers"]
    project = _create_project(client, parties)
    client.post(f"{API}/projects/{project['id']}/accept", headers=rh)
    milestone_id = project["milestones"][0]["id"]

    # Receiver tries to fund the client's milestone.
    assert (
        client.post(f"{API}/milestones/{milestone_id}/fund", json={}, headers=rh).status_code
        == 403
    )

    client.post(f"{API}/milestones/{milestone_id}/fund", json={}, headers=ch)

    # Client tries to submit the receiver's work.
    forged = client.post(
        f"{API}/milestones/{milestone_id}/submit",
        json={"note": "I did my own work, pay me."},
        headers=ch,
    )
    assert forged.status_code == 403
    assert forged.json()["error"]["code"] == "NOT_PROJECT_RECEIVER"


def test_payment_cannot_be_released_twice(client: TestClient, parties, db) -> None:
    """Section 12: duplicate release prevention."""
    ch, rh = parties["client_headers"], parties["receiver_headers"]
    project = _create_project(client, parties)
    client.post(f"{API}/projects/{project['id']}/accept", headers=rh)
    milestone_id = project["milestones"][0]["id"]

    client.post(f"{API}/milestones/{milestone_id}/fund", json={}, headers=ch)
    client.post(
        f"{API}/milestones/{milestone_id}/submit", json={"note": "Done."}, headers=rh
    )
    first = client.post(f"{API}/milestones/{milestone_id}/approve", json={}, headers=ch)
    assert first.status_code == 200

    second = client.post(f"{API}/milestones/{milestone_id}/approve", json={}, headers=ch)
    assert second.status_code == 400
    assert second.json()["error"]["code"] == "PAYMENT_ALREADY_RELEASED"

    assert client.get(f"{API}/wallet", headers=rh).json()["available"] == "5000.00"
    assert ledger.reconcile(db).is_balanced


def test_cannot_approve_a_milestone_that_was_never_funded(
    client: TestClient, parties
) -> None:
    ch, rh = parties["client_headers"], parties["receiver_headers"]
    project = _create_project(client, parties)
    client.post(f"{API}/projects/{project['id']}/accept", headers=rh)

    response = client.post(
        f"{API}/milestones/{project['milestones'][0]['id']}/approve",
        json={},
        headers=ch,
    )
    assert response.status_code == 400
    # The funded check runs before the transition check, so the error names the
    # actual problem rather than the abstract state machine.
    assert response.json()["error"]["code"] == "MILESTONE_NOT_FUNDED"


def test_funding_is_idempotent(client: TestClient, parties, db) -> None:
    ch, rh = parties["client_headers"], parties["receiver_headers"]
    project = _create_project(client, parties)
    client.post(f"{API}/projects/{project['id']}/accept", headers=rh)
    milestone_id = project["milestones"][0]["id"]

    key = {"idempotency_key": "fund-milestone-0001"}
    first = client.post(f"{API}/milestones/{milestone_id}/fund", json=key, headers=ch)
    second = client.post(f"{API}/milestones/{milestone_id}/fund", json=key, headers=ch)

    assert first.status_code == 200
    # The second is refused as already funded rather than protecting twice.
    assert second.status_code == 400
    assert client.get(f"{API}/wallet", headers=ch).json()["protected"] == "5000.00"
    assert ledger.reconcile(db).is_balanced


def test_project_completes_when_every_milestone_is_released(
    client: TestClient, parties, db
) -> None:
    ch, rh = parties["client_headers"], parties["receiver_headers"]
    project = _create_project(client, parties)
    client.post(f"{API}/projects/{project['id']}/accept", headers=rh)

    for milestone in project["milestones"]:
        mid = milestone["id"]
        client.post(f"{API}/milestones/{mid}/fund", json={}, headers=ch)
        client.post(f"{API}/milestones/{mid}/submit", json={"note": "Done."}, headers=rh)
        client.post(f"{API}/milestones/{mid}/approve", json={}, headers=ch)

    detail = client.get(f"{API}/projects/{project['id']}", headers=ch).json()
    assert detail["status"] == "COMPLETED"
    assert detail["milestones_completed"] == 4
    assert detail["released_amount"] == "20000.00"

    assert client.get(f"{API}/wallet", headers=rh).json()["available"] == "20000.00"
    assert client.get(f"{API}/wallet", headers=ch).json()["available"] == "30000.00"
    assert ledger.reconcile(db).is_balanced


# ------------------------------------------------------------------- FLOW B


def _otp_from_notifications(client: TestClient, headers: dict) -> str:
    """Read the demo-delivered code out of the receiver's notification feed.

    This stands in for reading an SMS. Note what it demonstrates: the code is
    only ever available to the receiver, through their own authenticated feed.
    """
    feed = client.get(f"{API}/notifications", headers=headers).json()
    for item in feed["items"]:
        if item["notification_type"] == "OTP_SENT":
            match = re.search(r"\b(\d{6})\b", item["body"])
            if match:
                return match.group(1)
    raise AssertionError("No OTP notification was delivered to the receiver.")


def _funded_milestone(client: TestClient, parties: dict) -> tuple[dict, str]:
    ch, rh = parties["client_headers"], parties["receiver_headers"]
    project = _create_project(client, parties)
    client.post(f"{API}/projects/{project['id']}/accept", headers=rh)
    milestone_id = project["milestones"][0]["id"]
    client.post(f"{API}/milestones/{milestone_id}/fund", json={}, headers=ch)
    return project, milestone_id


def test_flow_b_cancellation_requires_receiver_verification(
    client: TestClient, parties, db
) -> None:
    ch, rh = parties["client_headers"], parties["receiver_headers"]
    _project, milestone_id = _funded_milestone(client, parties)

    # 1. Client requests cancellation
    request = client.post(
        f"{API}/cancellations",
        json={"milestone_id": milestone_id, "reason": "Requirements changed."},
        headers=ch,
    )
    assert request.status_code == 200, request.text
    body = request.json()
    assert body["status"] == "AWAITING_RECEIVER"

    # 2. The client is NEVER given the code, even in demo mode
    assert body["demo_code"] is None

    # 3. Funds stay protected while the request is open
    assert client.get(f"{API}/wallet", headers=ch).json()["protected"] == "5000.00"

    # 4. The receiver gets it, masked destination and all
    code = _otp_from_notifications(client, rh)
    assert len(code) == 6

    # 5. The receiver verifies, and the refund lands
    verified = client.post(
        f"{API}/cancellations/{body['id']}/verify",
        json={"code": code},
        headers=rh,
    )
    assert verified.status_code == 200, verified.text
    assert verified.json()["status"] == "CONFIRMED"

    wallet = client.get(f"{API}/wallet", headers=ch).json()
    assert wallet["protected"] == "0.00"
    assert wallet["available"] == "50000.00"  # fully refunded

    milestone = client.get(f"{API}/milestones/{milestone_id}", headers=ch).json()
    assert milestone["status"] == "CANCELLED"

    assert ledger.reconcile(db).is_balanced


def test_the_client_cannot_verify_their_own_cancellation(
    client: TestClient, parties, db
) -> None:
    """The single most important rule in section 15.

    Even holding the correct code — which they should never have — the client is
    refused, because authorisation is checked before the code is.
    """
    ch, rh = parties["client_headers"], parties["receiver_headers"]
    _project, milestone_id = _funded_milestone(client, parties)

    request = client.post(
        f"{API}/cancellations",
        json={"milestone_id": milestone_id, "reason": "I changed my mind."},
        headers=ch,
    ).json()

    code = _otp_from_notifications(client, rh)  # obtained out of band

    attempt = client.post(
        f"{API}/cancellations/{request['id']}/verify",
        json={"code": code},
        headers=ch,  # the CLIENT submits it
    )

    assert attempt.status_code == 403
    assert attempt.json()["error"]["code"] == "NOT_THE_VERIFIER"

    # Nothing moved.
    assert client.get(f"{API}/wallet", headers=ch).json()["protected"] == "5000.00"
    assert ledger.reconcile(db).is_balanced


def test_a_wrong_code_is_refused_and_attempts_are_counted(
    client: TestClient, parties
) -> None:
    ch, rh = parties["client_headers"], parties["receiver_headers"]
    _project, milestone_id = _funded_milestone(client, parties)

    request = client.post(
        f"{API}/cancellations",
        json={"milestone_id": milestone_id, "reason": "Testing."},
        headers=ch,
    ).json()

    first = client.post(
        f"{API}/cancellations/{request['id']}/verify",
        json={"code": "000000"},
        headers=rh,
    )
    assert first.status_code == 400
    assert first.json()["error"]["code"] == "OTP_INVALID"
    assert "remaining" in first.json()["error"]["message"]

    assert client.get(f"{API}/wallet", headers=ch).json()["protected"] == "5000.00"


def test_otp_is_single_use(client: TestClient, parties) -> None:
    ch, rh = parties["client_headers"], parties["receiver_headers"]
    _project, milestone_id = _funded_milestone(client, parties)

    request = client.post(
        f"{API}/cancellations",
        json={"milestone_id": milestone_id, "reason": "Testing."},
        headers=ch,
    ).json()
    code = _otp_from_notifications(client, rh)

    assert (
        client.post(
            f"{API}/cancellations/{request['id']}/verify",
            json={"code": code},
            headers=rh,
        ).status_code
        == 200
    )

    replay = client.post(
        f"{API}/cancellations/{request['id']}/verify",
        json={"code": code},
        headers=rh,
    )
    assert replay.status_code == 400
    assert replay.json()["error"]["code"] == "CANCELLATION_NOT_PENDING"


def test_otp_is_never_stored_in_plaintext(client: TestClient, parties, db) -> None:
    from app.cancellation.model import OtpVerification

    ch, rh = parties["client_headers"], parties["receiver_headers"]
    _project, milestone_id = _funded_milestone(client, parties)

    client.post(
        f"{API}/cancellations",
        json={"milestone_id": milestone_id, "reason": "Testing."},
        headers=ch,
    )
    code = _otp_from_notifications(client, rh)

    stored = db.scalars(select(OtpVerification)).all()
    assert stored
    for verification in stored:
        assert verification.code_hash != code
        assert verification.code_hash.startswith("$2b$")
        assert code not in verification.code_hash


def test_receiver_can_decline_and_funds_stay_protected(
    client: TestClient, parties, db
) -> None:
    ch, rh = parties["client_headers"], parties["receiver_headers"]
    _project, milestone_id = _funded_milestone(client, parties)

    request = client.post(
        f"{API}/cancellations",
        json={"milestone_id": milestone_id, "reason": "Changed my mind."},
        headers=ch,
    ).json()

    declined = client.post(
        f"{API}/cancellations/{request['id']}/decline",
        json={"reason": "I have already done most of the work."},
        headers=rh,
    )
    assert declined.status_code == 200
    assert declined.json()["status"] == "DECLINED"

    milestone = client.get(f"{API}/milestones/{milestone_id}", headers=ch).json()
    assert milestone["status"] == "FUNDED"
    assert client.get(f"{API}/wallet", headers=ch).json()["protected"] == "5000.00"
    assert ledger.reconcile(db).is_balanced


# ------------------------------------------------------------------- FLOW C


def test_flow_c_dispute_ai_summary_and_admin_resolution(
    client: TestClient, parties, db
) -> None:
    ch, rh = parties["client_headers"], parties["receiver_headers"]
    _project, milestone_id = _funded_milestone(client, parties)

    client.post(
        f"{API}/milestones/{milestone_id}/submit",
        json={"note": "Designs delivered as agreed."},
        headers=rh,
    )

    # 1. Client disputes
    dispute = client.post(
        f"{API}/disputes",
        json={
            "milestone_id": milestone_id,
            "reason": "QUALITY_NOT_AS_AGREED",
            "description": "Only three of the five agreed pages were delivered.",
        },
        headers=ch,
    )
    assert dispute.status_code == 201, dispute.text
    dispute_id = dispute.json()["id"]
    assert dispute.json()["status"] == "OPEN"

    # 2. Receiver responds
    responded = client.post(
        f"{API}/disputes/{dispute_id}/messages",
        json={"body": "Five pages were delivered; two are on a second Figma page."},
        headers=rh,
    )
    assert responded.status_code == 200

    # 3. AI summarises — and does NOT decide
    summary = client.post(f"{API}/disputes/{dispute_id}/ai-summary", headers=ch).json()
    assert summary["client_position"]
    assert summary["receiver_position"]
    assert "authorised person" in summary["disclaimer"]
    assert "outcome" not in summary
    assert "recommendation" not in summary

    # 4. A normal user cannot resolve it
    assert (
        client.post(
            f"{API}/disputes/{dispute_id}/resolve",
            json={"outcome": "RELEASE_TO_RECEIVER", "note": "Letting myself win."},
            headers=ch,
        ).status_code
        == 403
    )

    # 5. An admin can
    admin_user = db.scalar(select(User).where(User.email == parties["client_email"]))
    _register(client, "Admin Person", "admin@example.com")
    admin_row = db.scalar(select(User).where(User.email == "admin@example.com"))
    admin_row.role = UserRole.ADMIN
    db.commit()
    admin_headers = _login(client, "admin@example.com")

    resolved = client.post(
        f"{API}/disputes/{dispute_id}/resolve",
        json={
            "outcome": "SPLIT",
            "note": "Three of five pages verified; splitting proportionally.",
            "split_to_receiver": "3000.00",
        },
        headers=admin_headers,
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "RESOLVED"
    assert resolved.json()["outcome"] == "SPLIT"

    # 6. The split adds up exactly
    receiver_wallet = client.get(f"{API}/wallet", headers=rh).json()
    client_wallet = client.get(f"{API}/wallet", headers=ch).json()

    assert receiver_wallet["available"] == "3000.00"
    assert client_wallet["available"] == "47000.00"  # 45000 + 2000 returned
    assert client_wallet["protected"] == "0.00"

    assert ledger.reconcile(db).is_balanced


def test_a_dispute_freezes_release_and_cancellation(
    client: TestClient, parties
) -> None:
    ch, rh = parties["client_headers"], parties["receiver_headers"]
    _project, milestone_id = _funded_milestone(client, parties)

    client.post(
        f"{API}/milestones/{milestone_id}/submit", json={"note": "Done."}, headers=rh
    )
    client.post(
        f"{API}/disputes",
        json={
            "milestone_id": milestone_id,
            "reason": "WORK_INCOMPLETE",
            "description": "The work does not match what we agreed.",
        },
        headers=ch,
    )

    # Neither party can move the money while it is disputed.
    approve = client.post(f"{API}/milestones/{milestone_id}/approve", json={}, headers=ch)
    assert approve.status_code == 400
    assert approve.json()["error"]["code"] == "MILESTONE_IN_DISPUTE"
    assert (
        client.post(
            f"{API}/cancellations",
            json={"milestone_id": milestone_id, "reason": "Let me out."},
            headers=ch,
        ).status_code
        == 400
    )


def test_only_one_open_dispute_per_milestone(client: TestClient, parties) -> None:
    ch, rh = parties["client_headers"], parties["receiver_headers"]
    _project, milestone_id = _funded_milestone(client, parties)
    client.post(
        f"{API}/milestones/{milestone_id}/submit", json={"note": "Done."}, headers=rh
    )

    body = {
        "milestone_id": milestone_id,
        "reason": "WORK_INCOMPLETE",
        "description": "This is not what we agreed at all.",
    }
    assert client.post(f"{API}/disputes", json=body, headers=ch).status_code == 201
    second = client.post(f"{API}/disputes", json=body, headers=rh)
    assert second.status_code == 400
    assert second.json()["error"]["code"] == "DISPUTE_ALREADY_OPEN"
