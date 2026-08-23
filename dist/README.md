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

## Connecting it to the backend

The app talks to the FastAPI backend over your local network, so three things
have to be true.

**1. The backend is running, listening on every interface:**

```bash
cd backend
./.venv/Scripts/python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`--host 0.0.0.0` is not optional. The default binds to localhost, which the
phone cannot reach.

**2. Windows Firewall lets port 8000 in.** Run once, as Administrator:

```bash
New-NetFirewallRule -DisplayName "TrustPay API 8000" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow -Profile Private
```

Without this the phone gets no answer at all, which looks identical to the
backend being down.

**3. The app is pointed at the right address.** The phone and the computer must
be on the same Wi-Fi. `ipconfig` shows the computer's IPv4 address.

That address is **a setting inside the app**, not a compile-time constant. If
the app cannot reach the server, the sign-in screen offers **Check server
address**; there is also a permanent **Server settings** link at the bottom of
that screen. Type the IP — just `10.0.0.5`, the port and path are filled in for
you — and tap **Test and save**. It verifies the address answers as TrustPay
before storing it, so a typo fails loudly instead of silently.

This matters because the address changes on its own: during development it
moved four times in one afternoon on a single network. It used to be baked into
the bundle, which meant a rebuild every time. It no longer is.

This build ships pointing at `http://10.215.14.115:8000/api/v1` by default —
that was the machine's address when it was built, and it is only a starting
guess. Change it in the app whenever it goes stale.

## One thing to know before you distribute it

**It is signed with the Android debug key.** That is enough to install and run,
and it is what a build without a private release keystore produces. It is *not*
suitable for the Play Store, and anyone can produce a signature-compatible
build. Generate a real keystore before this goes to anyone else.

## What is in it

The full app: onboarding, sign-in, the milestone escrow workflow (fund →
submit → approve → release), receiver-verified cancellation with OTP, disputes,
notifications, the AI Trust Score, and the wallet pocket with the balance behind
biometric or PIN unlock.
