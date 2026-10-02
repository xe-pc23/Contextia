# Mobile — React Native

React Native / Expo SDK 57 / strict TypeScript client for Cognito, dashboard, preferences,
recommendation history/detail/chat, native context collection, and optional background suggestions.
Every API boundary uses `packages/contracts`. Test doubles exist only under `test/`.

## Local development

Use Node 24.13.1 and pnpm 10.29.3. Copy `.env.example` to ignored `.env.local` and fill
public dev outputs: API URL, Cognito issuer, **MobileClientId**, and `contextia-dev://auth/callback`.
Never put credentials or tokens in these variables. Prod uses separate resources and
`contextia-prod://auth/callback`.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm cdk:synth
```

`pnpm build` exports iOS/Android JavaScript/Hermes assets. Native compilation and executed
capabilities are recorded separately in [Mobile validation](../../docs/MOBILE_VALIDATION.md).
Expo Go does not prove Calendar, background location or remote notifications.

### iOS Simulator

Xcode 26.6, iOS 26.5 runtime and CocoaPods 1.17.0 are installed locally. From repository root:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer EXPO_PUBLIC_STAGE=dev \
  pnpm --filter @contextia/mobile exec expo prebuild --platform ios --no-install --skip-dependency-update react,react-native
cd apps/mobile/ios
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer COCOAPODS_DISABLE_STATS=1 pod install
```

Run Pods from the `ios` directory. Check ignored `.xcode.env.local` points at Node 24.13.1.
Start Metro from the repository root:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer NODE_OPTIONS=--dns-result-order=ipv4first \
  pnpm --filter @contextia/mobile dev --localhost --max-workers 2
```

Run `EXPO_PUBLIC_STAGE=dev pnpm --filter @contextia/mobile ios` to choose a Simulator.
Ad hoc Simulator signing (`CODE_SIGN_IDENTITY=-`) avoids the SecureStore identity error observed
with signing disabled; no Personal Team is needed for a Simulator. Hardware uses the member's
local Apple team and `pnpm --filter @contextia/mobile ios --device`.

### Android

Install Android Studio/SDK under the owner's accepted SDK license and use a supported JDK.
Health Connect requires Android API 26 minimum; `expo-build-properties` sets this in the committed
configuration. Its bundled Expo lifecycle listener registers the permission delegate through
autolinking. Do not manually patch generated MainActivity.

```bash
EXPO_PUBLIC_STAGE=dev pnpm --filter @contextia/mobile android --device
```

The owner approved the Android SDK license/install on 2026-10-03. This Mac now has Temurin JDK 21,
Android SDK 36, Build Tools 36.0.0, NDK 27.1.12297006 and CMake 3.30.5. The arm64 Debug APK
compiled successfully. Generate the ignored Android project from a fresh checkout before compiling;
run this from the repository root:

```bash
EXPO_PUBLIC_STAGE=dev pnpm --filter @contextia/mobile exec expo prebuild \
  --platform android --no-install --skip-dependency-update react,react-native
cd apps/mobile/android
```

Then compile from `apps/mobile/android`:

```bash
EXPO_PUBLIC_STAGE=dev \
  JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home \
  ANDROID_HOME=/Users/xe/Library/Android/sdk \
  ./gradlew :app:assembleDebug -Pandroid.cmakeVersion=3.30.5 \
    -PreactNativeArchitectures=arm64-v8a --max-workers=2 --console=plain
```

Use the pinned Node version above on PATH. The generated, ignored APK is
`android/app/build/outputs/apk/debug/app-debug.apk`. It uses a Debug certificate and requires
reachable Metro; it is not a standalone release build. Compilation/manifest/signature evidence is
in [Mobile validation](../../docs/MOBILE_VALIDATION.md). Android runtime/hardware checks remain open.
The local API 36 arm64 emulator has booted and the APK displayed Contextia's signed-out screen;
the same validation document records its Metro port mapping and the remaining native checks.
Rebuild native projects after changing modules or config plugins.

## Foreground flow and privacy

- Sign-in uses authorization code + PKCE with the public Mobile client. SecureStore keys include
  stage/client. Foreground access refresh is single-flight; revoked/stale requests cannot clear
  a newer session. Sign-out and automatic session expiry/rejection abort active API work immediately
  and invoke the same native eligibility/notification cleanup before a new login can persist.
- Fresh accounts initialize defaults only after `PROFILE_NOT_FOUND`, using create-only preferences;
  concurrent existing profiles are preserved. Failed preference writes remain visible.
- Collection/evaluation reads fresh GPS, minimized Calendar and steps through source interfaces.
  GPS denial prevents evaluation; Calendar denial becomes an empty calendar and an explicit status.
- Calendar IDs are hashed. Only ID, title, start/end, location and all-day enter requests.
  Attendees, email, description/notes, organizer and meeting URL are discarded.
- iOS reads Pedometer history since the saved profile timezone's day start. Android uses Health
  Connect Steps aggregate, never the iOS-only historical Pedometer call. No origins/measurements
  stays unknown, never fabricated zero. Genuine zero is valid when measurements exist.
- Native step sources report high confidence. A tested conservative foreground fallback primitive
  reports low confidence; no native foreground sensor subscription is enabled in this build.
- Requests are `mode="real"`, `deliveryMode="proactive"`, with fresh UUID idempotency keys.
  Foreground notify results appear in-app. Silent results replace old cards. No automatic mutation
  retry is performed after an uncertain network result.
- History/detail/chat use owned API routes and cancel stale screen work. Dashboard weather uses the
  normalized backend reading. Map links use supplied safe actions or supplied coordinates.

## Optional background suggestions and local notifications

Enable background suggestions explicitly in Settings. The app checks saved notification preferences
and requests foreground/background location and notification permission while visible. OS location
callbacks are opportunistic; no fixed interval is promised. Android shows its location service status.

The globally registered TaskManager callback uses only a recent latest GPS fix, minimized Calendar
and available step signals. It checks session, account, permission and preferences across asynchronous
work. Headless callbacks never request permission or refresh/write/delete credentials. An expired
access token skips evaluation until a foreground operation refreshes it. On Android, background Steps
also requires the OS Health Connect background-read grant; otherwise steps stay unknown.

New SecureStore writes use `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`. Upgrading an older installation
requires a new sign-in or foreground token refresh before locked-screen access can be verified.
Background reads do not erase credentials on a lock/storage error.

Only background `proactive/ready` responses can reserve a local notification. SQLite atomically claims
recommendation IDs in a stage/client/owned-user namespace, removes expired claims and caps live claims
at 100. A full store or uncertain scheduling failure fails closed; an unexpired ID is never evicted or
resent. Preview, foreground, silent, sent and failed responses do not schedule local delivery.

Foreground arrivals are hidden from the system notification list/banner. Notification taps open the
owned recommendation detail after sign-in. Logout clears eligibility, stops native updates, cancels
pending notifications, dismisses displayed notifications and clears the last tap response; late OS
acceptance is cleaned up again. Claims survive logout to preserve deduplication.

Remote delivery is a separate trusted backend command with an immutable client/remote reservation.
There is no mobile push registration flow or remote scheduling service in this build. SNS remains
unconfigured. Provider acceptance and actual OS display require separate hardware proof.

## Verification evidence — 2026-10-03

The Task 7 iOS Simulator Debug native build and install succeeded, including SQLite, Sensors,
Notifications and TaskManager. Configured native PKCE login, public simulated GPS, a neutral
nonempty Calendar event, dev evaluation, owned detail/chat, preference save/readback and explicit
sign-out were observed on 2026-10-03. The dated screenshots and development Reload/keyboard
troubleshooting are in [Mobile validation](../../docs/MOBILE_VALIDATION.md). Refresh, denial and
OS notification behavior still need their own native evidence.

The deployed dev API at `ba15f30` passed the authenticated Web five-scenario/ownership/preview gate;
this is backend proof, not a native login/sensor result. The extended SRP/proactive/fault/metrics gate
is tracked in [agent log](../../docs/hackathon/AGENT_LOG.md). All physical capability rows remain open
in [the handoff matrix](../../docs/MOBILE_VALIDATION.md).
