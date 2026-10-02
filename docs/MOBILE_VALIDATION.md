# Mobile validation: Simulator and hardware

## Current approach — 2026-10-03

The owner cannot attach an iPhone to this Mac. Local development uses the React Native / Expo
development build on the iOS Simulator. A member with a device can perform the hardware checks below.
No credentials or messages have been sent to another member.

The local unsigned Simulator Debug build succeeded with Xcode 26.6, iOS 26.5 runtime and iPhone 17.
Its bundle ID is `com.contextia.dev`, version `0.0.1`. This proves native compilation only;
The initial React Native screen also ran through localhost Metro; auth configuration was absent,
so login, collection and API execution remain open. Expo Go is not a substitute.
Proof: [Simulator initial screen](hackathon/evidence/task5-simulator-start.png).

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
| Background location callback | Hardware required | Open | Open |
| Remote push acceptance / OS display | Hardware required | Open | Open |
| Map / route deep link | Open | Open | Open |

For each row, record `passed`, `failed` with a reproducible symptom, or `not available`.
An unavailable sensor stays unknown; do not treat it as zero steps. Background callbacks depend
on the OS and do not promise a fixed interval. Provider acceptance does not prove notification display.
Hardware rows remain open until the member returns the device, OS, commit and observed result.
