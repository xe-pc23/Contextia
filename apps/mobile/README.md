# Mobile — Phase 0

Expo/React Native/strict TypeScript shell with `expo-dev-client`. The app imports the canonical delivery schema and displays unconnected status; it acquires no GPS, calendar, steps or notification permission yet. Authentication and API evaluation are pending.

Versions follow the official Expo SDK 57 TypeScript template: Expo 57.0.26, React 19.2.3 and React Native 0.86.3. Use the repository's Node 24 and pnpm 10. The SDK's default Metro setup supports this pnpm monorepo; no manual hoisting/resolver workaround is configured.

The repository pins the tested Node 24.13.1; the minimum supported Node 24 release is 24.3.0. Shell commands and package scripts use POSIX environment assignments, tested on macOS. Linux/WSL can use the same command syntax; native Windows cmd.exe/PowerShell execution has not been verified.

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter @contextia/contracts build
pnpm dev:mobile
pnpm --filter @contextia/mobile build
```

`build` exports iOS/Android JavaScript/Hermes assets into `apps/mobile/dist`; it does **not** compile an APK/IPA or prove native behavior. Native directories are generated locally and ignored; configuration/plugins are the source of truth.

## Development builds

Set up Xcode/iOS Simulator (macOS) or Android Studio/SDK and its supported JDK. For a real iPhone, enable Developer Mode and configure signing; for Android, enable USB debugging. `expo-dev-client` is already installed.

```bash
EXPO_PUBLIC_STAGE=dev pnpm --filter @contextia/mobile ios --device
EXPO_PUBLIC_STAGE=dev pnpm --filter @contextia/mobile android --device
pnpm dev:mobile
```

Choose the relevant platform, install the development app, then connect it to Metro. The run commands generate native projects if missing. Regenerate and rebuild after changing native modules/configuration; preserve any deliberate native changes before a clean prebuild. Stage is dev by default; prod uses distinct app names, schemes and application IDs via `EXPO_PUBLIC_STAGE=prod`. D must supply the corresponding Cognito callback configuration before authentication is enabled. These identifiers are scaffolding values, not an app-store registration.

## Next task and permissions

E Phase 1 implements the development-build Cognito flow and a foreground GPS/calendar prototype. Add only the required Expo modules through D's dependency/lockfile workflow. Configure usage descriptions/config plugins before a new native build and request permission at the point of use. Permission denial must remain a valid state.

- Calendar transport is limited to id/title/start/end/location/allDay; project fields before calling `ContextInputSchema`, and never transmit attendees, email addresses, notes or meeting URLs.
- Background location and remote notifications need development-build and device verification; Expo Go is not proof. Background callbacks are opportunistic, not exactly every five minutes.
- Steps use `StepSource`: Android historical Expo Pedometer queries cannot implement today's count; Health Connect or a marked lower-confidence foreground fallback is required in the later phase.
- Device tokens stay out of logs; foreground results and background local/server notification paths must not double-notify a recommendation ID.

Phase 0 verifies source types and native-platform JS exports only. No iOS/Android device test has been run in this task. Record the later real-device matrix in `docs/TEST_STRATEGY.md`.

References: [SDK compatibility](https://docs.expo.dev/versions/latest/), [pnpm monorepos](https://docs.expo.dev/guides/monorepos/), [development builds](https://docs.expo.dev/develop/development-builds/introduction/), [permissions](https://docs.expo.dev/guides/permissions/).
