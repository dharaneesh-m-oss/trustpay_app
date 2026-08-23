# TrustPay — Android builds

Signed release APKs, built from this repository.

| File | Size | For |
|---|---|---|
| [`trustpay-arm64-v8a.apk`](trustpay-arm64-v8a.apk) | 42 MB | **Almost every phone from ~2017 onward.** Start here. |
| [`trustpay-armeabi-v7a.apk`](trustpay-armeabi-v7a.apk) | 36 MB | Older 32-bit devices, if the one above refuses to install. |

`versionName` 1.0.0 · `minSdkVersion` 24 (Android 7.0) · `targetSdkVersion` 36 ·
package `com.trustpay.app`

## Installing

1. Download the arm64 APK onto the phone.
2. Open it. Android will ask you to allow installing from this source — that
   prompt appears for any app not from the Play Store.
3. Install and open.

## Two things to know before you judge it

**It is signed with the Android debug key.** That is enough to install and run,
and it is what a build without a private release keystore produces. It is *not*
suitable for the Play Store, and anyone can produce a signature-compatible
build. Generate a real keystore before distributing this to anyone.

**It needs the backend, and the address is compiled in.** This build points at:

    http://10.205.167.115:8000/api/v1

That is a private LAN address. Sign-in and every screen that loads data will
fail unless:

- the FastAPI backend is running (`uvicorn app.main:app --host 0.0.0.0 --port 8000`), and
- the phone is on the same Wi-Fi, and
- the machine still holds that IP — **it changes when you rejoin the network**.

If the IP has moved, the APK must be rebuilt; the value is baked in at bundle
time and cannot be changed after the fact:

```bash
cd mobile
EXPO_PUBLIC_API_URL="http://<new-ip>:8000/api/v1" npx expo prebuild --platform android --clean
cd android && ./gradlew assembleRelease
```

For a build that works anywhere, deploy the backend to a public host and set
`EXPO_PUBLIC_API_URL` to that URL instead.

## What is in it

The full app: onboarding, sign-in, the milestone escrow workflow (fund →
submit → approve → release), receiver-verified cancellation with OTP, disputes,
notifications, the AI Trust Score, and the wallet pocket with the balance behind
biometric or PIN unlock.
