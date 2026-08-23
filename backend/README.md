# TrustPay Backend

**Trust. Protected.**

FastAPI service for TrustPay's programmable trust layer. This document covers
running it locally, the conventions every module follows, and the security
decisions the foundation depends on.

> TrustPay is **not** a bank, a licensed payment institution, or a custodian of
> funds. With `DEMO_MODE=true` every monetary movement is recorded in a
> simulated internal ledger and no real money moves. The payments module is
> shaped so a regulated payment or escrow provider can be integrated behind it
> later without reworking the domain.

---

## Requirements

| Component | Version used |
|---|---|
| Python | 3.14.2 |
| PostgreSQL | 16 (Docker container `trustpay-postgres`) |

PostgreSQL is required, not optional. The domain depends on `SELECT … FOR UPDATE`
row locks, `NUMERIC` money, native enums and `JSONB` — SQLite silently ignores
the first and emulates the rest.

---

## Running the database

The database runs as a container inside WSL2:

```bash
wsl -e bash -lc "docker start trustpay-postgres"
```

To create it from scratch:

```bash
wsl -e bash -lc "docker run -d --name trustpay-postgres --restart unless-stopped -e POSTGRES_USER=trustpay -e POSTGRES_PASSWORD=trustpay_dev_pw -e POSTGRES_DB=trustpay -p 5432:5432 -v trustpay_pgdata:/var/lib/postgresql/data postgres:16-alpine"
```

### If Windows cannot reach the database

Two WSL2 settings in `%USERPROFILE%\.wslconfig` are required, and both were
added while setting this up:

```ini
[wsl2]
networkingMode=mirrored     # the NAT relay accepted connections without forwarding data

[experimental]
hostAddressLoopback=true
vmIdleTimeout=-1            # otherwise WSL tears the VM (and the database) down when idle
```

Changes need `wsl --shutdown` to take effect. Symptom of the idle timeout: the
container reports `Up 1 second` every time you look at it, and connections that
worked a minute ago time out.

---

## Running the API

```bash
cd backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
```

Copy `.env.example` to `.env` and generate a secret:

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

Apply migrations, then start the server:

```bash
cd backend && .venv/Scripts/python.exe -m alembic upgrade head
```

```bash
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
```

Interactive documentation: <http://127.0.0.1:8000/docs>

---

## Tests

```bash
cd backend && .venv/Scripts/python.exe -m pytest
```

Tests run against a separate `trustpay_test` database on the same server, and
truncate every table between cases. Create it once with:

```bash
wsl -e bash -lc "docker exec trustpay-postgres psql -U trustpay -d postgres -c 'CREATE DATABASE trustpay_test OWNER trustpay'"
```

---

## Module layout

Each domain module holds the same file set, and dependencies flow one way:

```
router.py       HTTP binding only — no business rules, no error translation
service.py      business logic; owns the transaction boundary; commits once
repository.py   queries and staged writes; never commits
model.py        SQLAlchemy mapping
schema.py       Pydantic request/response contracts
constants.py    enums and domain constants
exceptions.py   TrustPayError subclasses for this domain
```

Shared foundations:

| Path | Purpose |
|---|---|
| `app/config/settings.py` | every tunable value, sourced from the environment |
| `app/core/exceptions.py` | error hierarchy; each carries a code, a safe message and an HTTP status |
| `app/core/money.py` | `Decimal` money helpers and the `NUMERIC(18,2)` column type |
| `app/core/identifiers.py` | UUIDv7 primary keys |
| `app/core/context.py` | caller IP and user agent, passed into services |
| `app/security/password.py` | bcrypt hashing and password policy |
| `app/security/tokens.py` | JWT access tokens, opaque refresh tokens |
| `app/audit/` | append-only audit log |
| `app/database/registry.py` | imports every model so Alembic sees the full metadata |

---

## Security decisions

**Access tokens are JWTs; refresh tokens are not.** An access token is
short-lived (15 minutes) and self-contained, so authorising a request costs no
database round trip. A refresh token is 48 random bytes, stored only as a
SHA-256 digest — a JWT refresh token cannot be revoked without a denylist, and
leaked digests are useless to an attacker.

**Refresh tokens rotate, and reuse is treated as compromise.** Each refresh
consumes the presented token and issues a new one in the same `family_id`.
Presenting an already-consumed token means the credential exists in two places,
so the entire family is revoked and both parties must sign in again.

**`get_current_user` returns a `User`, not an email.** Ownership checks compare
`project.client_id == current_user.id`; a string identifier would be unusable
for that, and every handler would re-query anyway. The role is read from the
database rather than trusted from the token, so a demoted admin loses access
immediately instead of when their token expires.

**Login does not leak which accounts exist.** An unknown address and a wrong
password return the same code, the same message, and comparable latency (an
unknown address still burns a bcrypt verification).

**Lockout counters are updated under a row lock.** Concurrent attempts serialise
on `SELECT … FOR UPDATE` instead of racing and overwriting each other.

**Services own transactions, repositories do not commit.** One business
operation — release a payment, write two ledger entries, update a milestone, log
an audit row — must commit exactly once or not at all.

**Errors never reach a user raw.** Every failure is rendered as
`{"error": {"code", "message", "request_id"}}`. Tracebacks go to the logs; the
`X-Request-ID` header ties a user's error screen to the log lines behind it.

**passlib is deliberately absent.** passlib 1.7.4 reads `bcrypt.__about__`,
removed in bcrypt 4.1, so the pairing raises on the first hash it computes. The
`bcrypt` library is called directly instead.

---

## The ledger

Money never moves by updating a balance. Every movement is a **transaction**
made of at least two **postings** whose debits and credits are equal, written
through the single primitive `ledger.service.post()`.

Accounts are split by purpose, because "available", "protected" and "pending
settlement" are different states of money that one balance field cannot express:

| Account | Increases on | Holds |
|---|---|---|
| `USER_AVAILABLE` | credit | spendable balance |
| `USER_PROTECTED` | credit | funds committed to a milestone |
| `USER_PENDING_SETTLEMENT` | credit | funds awaiting settlement |
| `SYSTEM_EXTERNAL_SOURCE` | debit | the boundary with the outside world |
| `SYSTEM_FEES` | credit | platform revenue |

Each flow is the same primitive with different postings:

```
Top up            DEBIT  external source    CREDIT client available
Withdraw          DEBIT  client available   CREDIT external source
Fund milestone    DEBIT  client available   CREDIT client protected
Release payment   DEBIT  client protected   CREDIT receiver available
Refund            DEBIT  client protected   CREDIT client available
```

`GET /api/v1/ledger/reconciliation` (admin) proves the books balance two ways:
global debits must equal global credits, and every cached account balance must
equal the balance recomputed from that account's own postings.

**The wallet stores no balances.** `docs/07_Database_Design.md` puts
`available_balance` and `locked_balance` on the wallet table; that contradicts
spec sections 8 and 30, and two copies of one number is precisely how a wallet
starts disagreeing with the history that produced it. The wallet row carries
identity, currency, KYC state and freeze state — the numbers come from the
ledger.

### Concurrency

`ledger.post()` locks every account it touches with `SELECT … FOR UPDATE`,
ordered by id so opposing transfers serialise instead of deadlocking. The locked
rows are re-read with `populate_existing=True`: without it SQLAlchemy returns
the instance already in the session's identity map, so the lock is taken but the
*stale* balance is what gets incremented, and concurrent writers silently
overwrite each other. `tests/test_ledger_concurrency.py` drives real parallel
sessions and is what catches this — the single-threaded test client cannot.

### Idempotency

Financial mutations accept an `idempotency_key`. Replaying a key with the same
request returns the original transaction; replaying it with *different* details
returns 409, because that is a bug rather than a retry. The unique index is the
real enforcement — two concurrent requests can both pass a pre-check, and only
one can win the insert.

---

## Status

Implemented: configuration, error handling, structured logging, audit log,
users, authentication, sessions, wallets, double-entry ledger, reconciliation,
transaction history, migrations, and 61 tests.

Next: projects and milestones, then escrow funding and payment release — both of
which post through the ledger primitive that already exists.
