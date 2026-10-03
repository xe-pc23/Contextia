# Mobile validation: Simulator and hardware

## Current approach — 2026-10-03

The owner assigned physical-device testing to another member on 2026-10-03. Local development uses
the React Native / Expo development build on the iOS Simulator. The member records actual hardware
results using [the iPhone handoff](IOS_DEVICE_HANDOFF.md); the owner does not need to pair their own
iPhone with this Mac for that work. Android work remains paused at the owner's request.
No credentials or messages have been sent to another member.

The local Simulator Debug build succeeded with Xcode 26.6, iOS 26.5 runtime and iPhone 17.
Its bundle ID is `com.contextia.dev`, version `0.0.1`. The initial React Native screen ran
through localhost Metro. After live dev configuration, an ad hoc signed rebuild
(`CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-`) restored Simulator application identity
and removed the SecureStore startup `-34018` error seen with signing disabled. Simulator signing
does not require an Apple development team. After the Mac was unlocked, native PKCE sign-in,
simulated GPS, a neutral nonempty Calendar event, dev evaluation, owned detail/chat and saved
preferences were observed. Explicit sign-out returned to the sign-in screen and removed private UI.
Expo Go is not a substitute.
Proof: [Simulator initial screen](hackathon/evidence/task5-simulator-start.png).

The Task 7 Debug native rebuild also succeeded and installed on the iPhone 17 Simulator,
including Sensors, SQLite, Notifications and TaskManager. Native SDK resolution/compilation is
verified. Configured foreground Simulator flows now have the evidence below; OS notification
display and physical sensor/background behavior remain open. Both native projects prebuild successfully.
After explicit owner SDK license/install approval, the Android arm64 Debug APK compiled successfully
on 2026-10-03. Android runtime and hardware capabilities remain open; compilation is separate evidence.

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
The current `expo-notifications` plugin generates the `aps-environment` entitlement. Use a signing
team/profile that supports Push Notifications; the current full native configuration is not assumed
to provision with a free Personal Team. Apple documents program-specific capability support in its
[iOS capability table](https://developer.apple.com/help/account/reference/supported-capabilities-ios/).
Do not use the Simulator's ad hoc signature or disable signing for a physical iPhone. The simulator
`.app` cannot be installed on an iPhone; local development signing does not create an install link
for every other iPhone.

For the physical iPhone, start Metro with `--lan`, use the member Mac's actual LAN IP address and keep
both devices on the same trusted LAN. The Simulator's `--localhost` flow does not provide a reachable
server to the iPhone. See the handoff for preparation, prioritized checks and the result template.

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
| Sign in, refresh, sign out | Sign-in/out passed; refresh open | Open | Open |
| Foreground GPS | Public simulated location collected | Open | Open |
| Calendar allow / deny; neutral title/time/location | Allow + nonempty event passed; deny open | Open | Open |
| Dev API evaluation and result/detail | Passed, including owned chat | Open | Open |
| Saved preferences | Save/readback passed; original restored | Open | Open |
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

## Android native compilation — 2026-10-03 07:46 JST

Source: `6c5b165f6aa4105ca65eb3fbd16aae0259d48fcd`, stage `dev`. Generated native files are
ignored; no vendor source was patched. The owner approved installation/license acceptance before
the SDK packages were installed. Temurin 21.0.11 on macOS arm64, SDK/compile/target 36,
Build Tools 36.0.0, NDK 27.1.12297006 and CMake 3.30.5 produced the APK with
`:app:assembleDebug -PreactNativeArchitectures=arm64-v8a --max-workers=2` (CMake override 3.30.5).
Gradle reported `BUILD SUCCESSFUL in 8m 8s`, 346 executed tasks.

Artifact: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`, 68,022,091 bytes.
SHA-256: `4467cdd609e0ac3b033502ad05a4b18a6db3d52106036e4ee40480682f97195f`.
The artifact and local build log `/tmp/contextia-android-debug.log` are not committed.

An independent read-only APK inspection with `aapt2` and `apksigner` verified:

- `com.contextia.dev`, version `0.0.1`/code 1, minSdk 26, target/compileSdk 36 and
  `contextia-dev` callback scheme.
- Health Connect steps/background-read permission, package visibility and permission rationale/usage
  entry points; foreground/background location, Calendar and notification permissions; unexported
  foreground location service with location service type.
- SecureStore cloud-backup/device-transfer exclusions and only `arm64-v8a` native libraries.
- Valid APK v2 signature using `CN=Android Debug`.

The Debug APK is debuggable, allows development cleartext traffic and has no embedded JavaScript
bundle. It needs reachable Metro and is not a standalone, universally compatible or production-signed
artifact. No emulator or Android device was installed/launched for this check. Health Connect runtime,
permission UI, background grant, native auth, sensors and OS notification delivery are still unverified.

## Android emulator preparation — 2026-10-03 08:23 JST

The stable official Emulator 37.2.12 and API 36 default `arm64-v8a` system image revision 2
were installed under the already accepted Android SDK license; no new license prompt was accepted.
The dedicated `contextia-dev-api36` AVD uses the built-in Pixel 8 profile, 2 GiB RAM and four cores.
Hypervisor.Framework acceleration passed. The emulator reported `sys.boot_completed=1`, SDK 36
and `arm64-v8a`. The APK above installed successfully, and package lookup found `com.contextia.dev`.
Metro returned `packager-status:running`; `adb reverse` listed the local port 8081 mapping.

The observed preparation commands, from the repository root, are:

```bash
CONTEXTIA_ANDROID_SDK="$HOME/Library/Android/sdk"
"$CONTEXTIA_ANDROID_SDK/emulator/emulator" -avd contextia-dev-api36 \
  -no-snapshot-load -no-snapshot-save -no-boot-anim
```

In another terminal, start Metro as described above, then install and connect the development build:

```bash
CONTEXTIA_ANDROID_SDK="$HOME/Library/Android/sdk"
"$CONTEXTIA_ANDROID_SDK/platform-tools/adb" -s emulator-5554 install \
  apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
"$CONTEXTIA_ANDROID_SDK/platform-tools/adb" -s emulator-5554 reverse tcp:8081 tcp:8081
```

Choose the actual emulator serial from `adb devices` if it differs. These results prove emulator
boot, installation and host Metro preparation. The owner's
[08:23 development-client screenshot](hackathon/evidence/android-devclient-6c5b165.png) shows
the native Expo launcher for the installed `Contextia dev` build. After the owner entered
`http://127.0.0.1:8081`, Metro bundled 971 modules and the owner's
[08:25 startup screenshot](hackathon/evidence/android-startup-6c5b165.png) showed Contextia's
Japanese signed-out screen behind the Expo menu. Metro served `fc58de4` (app source unchanged
from `6ecc2e7`); the APK is the `6c5b165` artifact above. A read-only bounded app-process log check
found `Running "main"`, zero ReactNativeJS error lines and zero `FATAL EXCEPTION` lines in 298
retrieved lines; raw logs were not printed or saved. This is startup evidence, not a complete
runtime error audit or authenticated backend proof.

The native screen-control tool could not bind this emulator's unbundled Qt executable; the owner
performed these UI actions and no substitute tool controlled the UI. Permission UI, PKCE,
Health Connect reads, notification and background rows remain open. The image contains
`com.android.healthconnect.controller`; package presence alone is not a permission/read result.
The owner was asked to close the Expo menu with its `×` and open sign-in. An empty Health Connect
store stays unavailable; it is not zero-step proof.

The owner then paused Android work to prioritize iPhone hardware testing under the deadline.
The emulator was stopped; its AVD/APK and startup evidence were preserved. No Android sign-in
success is claimed. The owner subsequently requested an iPhone/Mac update interruption; Metro
was stopped and the next native task is wireless iPhone availability and Personal Team signing.

## Foreground Simulator evidence — 2026-10-03 07:05–07:30 JST

Backend version: `5f82d7b63ce043e5a41aec1e4a579efb8cb3c843`, dev. Native binary was the
Task 7 `79ff4cd` build; Metro served the current local delivery working tree including the
automatic session-clear cleanup fix. Screenshot suffixes identify the backend version.

- [Sign-in](hackathon/evidence/simulator-auth-5f82d7b.jpg): PKCE completed and owned history loaded.
- [Evaluation](hackathon/evidence/simulator-evaluation-5f82d7b.jpg): real collection of the public
  Tokyo Station simulated coordinates `35.681236, 139.767125` returned an in-app proposal.
- [Calendar](hackathon/evidence/simulator-calendar-5f82d7b.jpg): a local neutral event,
  `Contextia Simulator validation`, 08:00–09:00 JST, `Tokyo Station`, was collected as one event.
  [Its evaluation](hackathon/evidence/simulator-calendar-evaluation-5f82d7b.jpg) used Calendar
  and displayed unavailable route/geocoding facts explicitly. Today's steps stayed unknown.
- [Settings](hackathon/evidence/simulator-settings-5f82d7b.jpg): low frequency was saved and
  re-fetched, then restored to normal and saved. No manual evaluation overlaps the next CI smoke.
- [Owned chat](hackathon/evidence/simulator-chat-5f82d7b.jpg) returned a Japanese reply and the
  supplied place card. [Sign-out](hackathon/evidence/simulator-signout-5f82d7b.jpg) cleared the
  visible location, events, history, result and chat. Pending/displayed OS notifications were not
  populated in this foreground test, so their cleanup is unit evidence only.

### Development reload and keyboard troubleshooting

Expo DevMenu's accessibility `Reload` stopped responding during this session. A two-second native
sample showed main waiting in DevMenu reload/RCTInstance/TurboModule initialization and another
thread waiting during NativeAnimated invalidation/module notification. The installed Expo module
observer dispatches on main; a circular wait is a supported hypothesis, not a proven vendor fix.
The device/Metro stayed responsive and the app later resumed with a new process. No device erase,
credential reset or dependency patch was performed. Subsequent foreground flows above passed.

For a repeat, preserve Metro and restart the app process instead of DevMenu `Reload`/Metro `r`:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun simctl launch --terminate-running-process <SIMULATOR_UDID> com.contextia.dev
```

Confirm the home/settings response after restart. If text does not reach the device, use Simulator
I/O → Input → Send Keyboard Input to Device; return that capture setting after testing. This fixed
the separate missing text-input symptom. Neither workaround proves every native freeze is resolved.
