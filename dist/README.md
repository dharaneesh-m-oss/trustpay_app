# TrustPay — Android builds

Signed release APKs, built from this repository.

| File | Size | For |
|---|---|---|
| [`trustpay-arm64-v8a.apk`](trustpay-arm64-v8a.apk) | ~42 MB | **Almost every phone from ~2017 onward.** Start here. |
| [`trustpay-armeabi-v7a.apk`](trustpay-armeabi-v7a.apk) | ~36 MB | Older 32-bit devices, if the one above refuses to install. |

`versionName` 1.0.0 · `minSdkVersion` 24 (Android 7.0) · `targetSdkVersion` 36 ·
package `com.trustpay.app`

## Installing

1. Download the arm64 APK onto the phone.
2. Open it. Android will ask you to allow installing from this source — that
   prompt appears for any app not from the Play Store.
3. Install and open.

There is no step 4. No server to start, no IP to enter, no firewall rule, no
Wi-Fi requirement. The app runs entirely on the phone and works in aeroplane
mode.

## Getting in

Tap **Open the demo account** on the sign-in screen. It arrives with a wallet
balance and a sample project already part-finished — one milestone released, one
protected and waiting on review, one not yet funded — so every screen has
something real in it.

You can also create your own account with **Create an account**. It is stored on
the device; any email works, since nothing is sent anywhere.

### Seeing both sides

Escrow needs two parties, and this is one phone. A second account is included —
`aarti@trustpay.app`, password `demo1234` — who is the receiver on the sample
project. Sign out and back in as her to submit work, approve a cancellation
code, or watch a payment arrive. That is how you walk a milestone end to end:

1. As the demo account (client), fund a milestone.
2. Sign in as Aarti and submit the work.
3. Sign back in as the client and approve — the money moves to her.

## What is real here, and what is not

**Real.** The money logic is not a mock. Every movement is a double-entry
transaction whose postings must sum to zero, balances are derived from those
postings rather than stored alongside them, and amounts are integer paise so
nothing drifts. The rules that make escrow mean anything are enforced, not
decorative:

- A client cannot pull protected funds back alone. Cancelling a funded milestone
  needs a code that goes to the receiver, and only the receiver can enter it.
- A disputed milestone cannot be released or refunded by either side.
- Milestones follow a fixed state machine; anything else is refused with a
  reason rather than quietly allowed.

`npm run test:offline` in `mobile/` exercises all of it — 43 checks, including
that the ledger balances and that no code path creates or destroys money.

**Not real.** This is one device keeping its own records:

- Nothing is authoritative against another person. Aarti is an account on your
  phone, not someone else's app.
- The escrow is simulated. No funds are held by anyone, and no payment method is
  involved.
- The Trust Score is a fixed linear scorecard, not the trained model the server
  version used. It is still fully attributable — the explanation screen shows
  the exact contribution of each feature — but it is not a fitted model, and the
  app says so.
- The assistant and the agreement review answer from built-in checks, not a
  language model. Every response is labelled `rules` in the UI rather than
  passed off as AI.

## One thing to know before you distribute it

**It is signed with the Android debug key.** That is enough to install and run,
and it is what a build without a private release keystore produces. It is *not*
suitable for the Play Store, and anyone can produce a signature-compatible
build. Generate a real keystore before this goes to anyone else.

## What is in it

Onboarding, sign-in, the milestone escrow workflow (fund → submit → approve →
release), receiver-verified cancellation with OTP, disputes, notifications, the
Trust Score with its explanation, the assistant, and the wallet pocket with the
balance behind biometric or PIN unlock.

## The backend is still here

`backend/` still holds the full FastAPI server — double-entry ledger, auth,
escrow, disputes, the trained Trust Score model and the Claude integration, with
101 passing tests. Nothing was deleted. If you later want two people on two
phones transacting for real, that server is what you deploy, and the app's data
layer goes back to pointing at it.
