# Going live

Everything in this document is a credential or an account that only you can
create. The code that uses each one is written and tested; none of it is
scaffolding waiting to be filled in.

Where a step cannot be done at all without a registered business, that is said
plainly rather than left to be discovered.

---

## 1. Google Sign-In

**What works without it:** nothing — the button is hidden until a client id is
present, because a sign-in button that cannot work is worse than no button.

Create the clients at <https://console.cloud.google.com/apis/credentials>:

**a. Android client** — *Create credentials → OAuth client ID → Android*

| Field | Value |
|---|---|
| Package name | `com.trustpay.app` |
| SHA-1 fingerprint | `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` |

That SHA-1 belongs to the **debug keystore** this APK is signed with. If you
generate a release keystore later, its SHA-1 is different and must be added as a
second Android client, or Google will reject sign-ins from the new build with no
useful error.

**b. Web client** — *Create credentials → OAuth client ID → Web application*.
No redirect URIs are needed. This one's id is the audience the server verifies
against, so both sides must use the same value.

Then set:

```bash
# backend/.env
GOOGLE_CLIENT_ID=<web client id>
GOOGLE_ANDROID_CLIENT_ID=<android client id>
```

```bash
# mobile, at build time
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<web client id>
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=<android client id>
```

The ID token is verified server-side against Google's published keys —
signature, audience, issuer, expiry and `email_verified`. The app checks
nothing, because anything the app checks a modified app can skip.

---

## 2. Payments — the part that needs a business

This is the hard gate, and no code removes it.

Accepting UPI into a wallet and paying out to bank accounts in India requires a
**payment aggregator** account. Getting one requires:

- a registered business entity (proprietorship is enough for many providers),
- PAN, and GST where applicable,
- a settlement bank account in the business's name,
- KYC and a policy review by the provider.

Separately, holding customer balances is a **Prepaid Payment Instrument** under
RBI rules. For a project or a pilot this is normally handled by settling to the
recipient rather than holding balances — worth understanding before this runs
with other people's money.

Until credentials exist, `/payments/status` reports `collections_enabled: false`
and the app hides the buttons. Nothing pretends to work.

### Razorpay setup

<https://dashboard.razorpay.com> → Settings → API Keys:

```bash
# backend/.env
RAZORPAY_KEY_ID=rzp_live_xxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxx
RAZORPAY_WEBHOOK_SECRET=xxxxxxxx
MERCHANT_VPA=yourbusiness@okhdfcbank
MERCHANT_NAME=TrustPay
```

**The webhook is mandatory, not optional.** It is the only thing that credits a
wallet. Add it under Settings → Webhooks:

- URL: `https://<your-api-host>/api/v1/payments/webhook`
- Events: `payment.captured`, `payment.failed`, `order.paid`,
  `payout.processed`, `payout.failed`, `payout.reversed`
- Secret: the same value as `RAZORPAY_WEBHOOK_SECRET`

Without the secret set, every webhook is rejected — including genuine ones. That
is deliberate: absent a secret no signature can be trusted, so none is accepted.

### Payouts (withdrawals)

Two destinations are supported, and both need the same credentials:

- **Bank account** — account number plus IFSC, settled over IMPS. Verified by a
  penny drop: a real one-rupee validated transfer that returns the registered
  account holder's name.
- **UPI ID** — a VPA from BHIM, GPay, PhonePe or a bank's own app, settled over
  UPI in seconds. Verified by a directory lookup, which costs a fraction of a
  penny drop because no money moves.

There is no separate "BHIM integration" to add. BHIM is one UPI client among
many; a UPI ID created in it is the same address as one created anywhere else,
and the provider is what makes paying to it possible.

Payouts need **RazorpayX** on top of the above, with its own activation:

```bash
RAZORPAY_PAYOUT_ACCOUNT=<your RazorpayX virtual account number>
```

Until this is set, a bank account or UPI ID can be added but stays `PENDING`
and cannot receive a payout. Establishing ownership needs the provider — a penny
drop for a bank account, a directory lookup for a UPI ID — and neither can be
done from our side. An account cannot be honestly called "verified" without one,
so it is not.

---

## 3. Hosting

The app needs the API on a public URL. Both of these have free tiers and need no
card:

1. **Database** — <https://neon.tech> or <https://supabase.com>. Create a
   project and copy the connection string. Paste it exactly as given: the app
   rewrites `postgres://` and `postgresql://` to the psycopg driver and adds
   `sslmode=require` itself, so there is nothing to hand-edit.

   **On Supabase, take the Session pooler string, not the direct one.**
   *Project Settings → Database → Connection string*, then pick **Session
   pooler** and substitute your password for `[YOUR-PASSWORD]`.

   The direct connection (`db.<ref>.supabase.co`) is IPv6-only on new projects,
   and Render's free tier makes IPv4 outbound connections — so it fails with a
   network error that looks like a wrong password. The *transaction* pooler
   (port 6543) connects but breaks later: it hands each statement to whichever
   backend is free, so psycopg's automatically prepared statements vanish
   between calls and queries start failing minutes in, under load. The app
   disables statement preparation when it detects that port, so 6543 works too —
   but the session pooler is the one to use.

2. **API** — <https://render.com> → **New → Blueprint**, and pick this repo.
   `render.yaml` at the root describes the service, so the build and start
   commands are already set. `SECRET_KEY` is generated by Render; the rest are
   marked `sync: false` and are yours to fill in.

Environment variables on Render:

```bash
DATABASE_URL=<neon connection string>
SECRET_KEY=<see below>
ENVIRONMENT=production
DEMO_MODE=false
CORS_ORIGINS=https://your-app-host
```

Generate the secret — do not invent one, and do not reuse the development value:

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

Then rebuild the app pointed at it:

```bash
cd mobile
EXPO_PUBLIC_API_URL=https://<your-api-host>/api/v1 npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
```

**Free-tier warning worth knowing in advance:** Render's free instances sleep
after inactivity, and the first request afterwards takes 30–60 seconds. That is
survivable for a demo and not for real payments, because a sleeping instance
misses nothing — webhooks are retried — but users will see timeouts.

---

## 4. Before real money

- [ ] Generate a **release keystore** and sign with it. The debug key is public;
      anyone can produce a signature-compatible build of this app.
- [ ] Add the release SHA-1 as a second Google Android client.
- [ ] Set `DEMO_MODE=false` so the wallet stops describing itself as simulated.
- [ ] Replace the account-number encryption with KMS-backed envelope
      encryption. The current scheme derives its key from `SECRET_KEY`, which is
      fine against a database dump and not against a leaked application secret.
      This is flagged in `app/payments/service.py` where it happens.
- [ ] Put the webhook behind HTTPS only, and confirm the provider's retry
      behaviour matches what the idempotency guard expects.
- [ ] Decide the PPI question above with someone who knows the regulations.

---

## What is already real, with no credentials

- **IFSC verification** against the public bank registry — a typo'd code is
  caught in the form, with the real bank and branch shown.
- **Name matching** between the profile and the account holder, tolerant of how
  Indian bank records actually store names (initials, expanded surnames, swapped
  order) without letting two different people match.
- **UPI deep links** that genuinely open GPay, PhonePe, Paytm and BHIM with the
  amount and reference filled in. What they cannot do without a provider is
  confirm that anything was paid.
- **Webhook signature verification**, tested against forged, truncated and
  tampered payloads.
- **The escrow, ledger, disputes and Trust Score**, all of which work today.
