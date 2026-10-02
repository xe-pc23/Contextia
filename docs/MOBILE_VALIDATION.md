# Mobile validation: Simulator and hardware

## Current approach — 2026-10-03

The owner cannot attach an iPhone to this Mac. Local development uses the React Native / Expo
development build on the iOS Simulator. A member with a device can perform the hardware checks below.
No credentials or messages have been sent to another member.

The local Simulator Debug build succeeded with Xcode 26.6, iOS 26.5 runtime and iPhone 17.
Its bundle ID is `com.contextia.dev`, version `0.0.1`. The initial React Native screen ran
through localhost Metro. After live dev configuration, an ad hoc signed rebuild
(`CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-`) restored Simulator application identity
and removed the SecureStore startup `-34018` error seen with signing disabled. Simulator signing
does not require an Apple development team. The Cognito sign-in form was submitted, but the Mac
locked before the result could be inspected. Login, collection and API execution remain open.
Expo Go is not a substitute.
Proof: [Simulator initial screen](hackathon/evidence/task5-simulator-start.png).

The Task 7 Debug native rebuild also succeeded and installed on the iPhone 17 Simulator,
including Sensors, SQLite, Notifications and TaskManager. Native SDK resolution/compilation is
verified; configured login, collection and OS notification display remain open because no accessible
Simulator window was available. Both native projects prebuild successfully. Android is configured
with minSdk 26 for Health Connect; APK compilation awaits SDK installation/license consent.

The implementation has opportunistic location callbacks and durable local recommendation-ID claims.
Headless authentication is read-only: an expired access token skips evaluation until the app refreshes
it in the foreground. Existing installations must sign in again or refresh before validating the new
after-first-unlock SecureStore accessibility. Android background step reads require the separate
Health Connect background grant. A foreground fallback primitive exists, but no native fallback
sensor subscription is enabled. These limits must be included in hardware results.

## Run locally

1. Use Node 24.13.1 and pnpm 10.29.3; run `pnpm install --frozen-lockfile`.
2. Install Xcode and an iOS Simulator runtime from Xcode Settings → Components.
3. Copy `apps/mobile/.env.example` to ignored `apps/mobile/.env.local`. Fill the **public dev**
   API base URL, Cognito issuer and **MobileClientId** from the dev CDK outputs. Use
   `contextia-dev://auth/callback` for the redirect. Tokens and passwords do not belong in this file.
4. Follow the native preparation commands in [Mobile README](../apps/mobile/README.md).
5. Start Metro with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer NODE_OPTIONS=--dns-result-order=ipv4first pnpm --filter @contextia/mobile dev --localhost --max-workers 2`.
   IPv4 preference avoids binding only `::1` when the development client connects to `127.0.0.1`.
6. From another terminal run `EXPO_PUBLIC_STAGE=dev DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer pnpm --filter @contextia/mobile ios` and choose an iPhone Simulator. Initial native compilation can take several minutes.
7. Sign in with a dedicated test account supplied privately by the owner. Use neutral Calendar test
   events and a simulated location (Simulator Features → Location → Custom Location).

Record the app commit, `/health` backend version, stage, simulated device/OS, permission decisions,
evaluation outcome and screenshot of the app. Never capture a password, token, Apple Account screen,
private calendar event or push token.

## Hardware handoff

The member checks out the reviewed `codex/local-delivery` commit and uses their own local signing setup.
For an iPhone, build with their own Apple development team and connected device using
`EXPO_PUBLIC_STAGE=dev pnpm --filter @contextia/mobile ios --device` after native preparation.
Personal Team provisioning is local development signing; it does not create an install link
for every other iPhone. The simulator `.app` cannot be installed on an iPhone.

For an already paired iPhone, Xcode can use a compatible wireless connection. Follow Apple's current
[device connection instructions](https://developer.apple.com/documentation/xcode/managing-your-simulated-and-physical-devices-in-device-hub)
for initial pairing and Developer Mode. Availability depends on device/OS and network conditions;
the member's local build is the fallback when those conditions are unavailable.

Supply public dev configuration and dedicated test-account credentials via the agreed private
handoff channel. The owner does not share their Apple Account password or AWS credentials.

## Record actual results

| Check | Simulator | iPhone hardware | Android hardware |
|---|---|---|---|
| Native build | Passed locally | Open | Open |
| Sign in, refresh, sign out | Open | Open | Open |
| Foreground GPS | Simulated location only | Open | Open |
| Calendar allow / deny; neutral title/time/location | Open | Open | Open |
| Dev API evaluation and result/detail | Open | Open | Open |
| Saved preferences | Open | Open | Open |
| Today's steps | Hardware required | Open | Open — Health Connect |
| Local notification / recommendation ID dedup | Open | Open | Open |
| Tap notification → owned detail; sign-out clears pending/last response | Open | Open | Open |
| Background location callback | Hardware required | Open | Open |
| Remote push acceptance / OS display | Hardware required | Open | Open |
| Map / route deep link | Open | Open | Open |

For each row, record `passed`, `failed` with a reproducible symptom, or `not available`.
An unavailable sensor stays unknown; do not treat it as zero steps. Background callbacks depend
on the OS and do not promise a fixed interval. Provider acceptance does not prove notification display.
Hardware rows remain open until the member returns the device, OS, commit and observed result.
