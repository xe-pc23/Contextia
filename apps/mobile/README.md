# Mobile — Phase 1 E

Expo/React Native/strict TypeScript app using `expo-dev-client`. The Phase 1 E slice adds Cognito Hosted UI authentication with authorization code + PKCE, foreground location and calendar sources, and a schema-validated local `ContextInput` preview. It does not call the evaluation API; that connection belongs to Phase 2.

## Development environment

Versions follow the repository's Expo SDK 57 baseline: Expo 57.0.26, React 19.2.3 and React Native 0.86.3. Use Node 24 and pnpm 10 from the repository configuration.

The E lane adds these SDK-compatible modules to the mobile importer and root lockfile:

| Package | Version range | Purpose |
|---|---:|---|
| `expo-auth-session` | `~57.0.13` | Cognito OIDC authorization code + PKCE |
| `expo-calendar` | `~57.0.5` | Read local calendar events |
| `expo-crypto` | `~57.0.3` | Hash native calendar event IDs; AuthSession peer dependency |
| `expo-location` | `~57.0.20` | Foreground GPS |
| `expo-secure-store` | `~57.0.4` | Store Cognito access/refresh tokens on device |
| `zod` | `4.6.5` | Validate public Cognito configuration and stored token sessions |

The lockfile contains matching importer entries for these dependencies. Use a frozen install to verify the workspace dependency graph.

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm cdk:synth
```

`pnpm --filter @contextia/mobile build` exports iOS/Android JavaScript/Hermes assets into `apps/mobile/dist`; it does **not** compile an APK/IPA or prove native behavior.

## Native context behavior

Tap **端末の位置と予定を読み取る** to request permissions and collect context. Permission requests happen only at this point.

- Foreground location uses `expo-location`. No background permission or periodic schedule is requested.
- Calendar reads use the device-local day through the end of the next three days.
- The native query includes a 31-day margin around that window, and projection keeps only events that overlap the requested window.
- Calendar event IDs are SHA-256 hashed before projection. Only `id`, `title`, `startAt`, `endAt`, `location`, and optional `allDay` enter `ContextInput`; attendee data, email, description, notes, meeting URL, organizer, and calendar IDs are discarded.
- The shared `ContextInputSchema` validates the composed real/proactive input before the app displays it.
- If location permission is denied or a fix is unavailable, the app shows that state and creates no evaluation input. If calendar permission is denied, it keeps an empty calendar and can still produce a valid input when location is available.
- The context remains on the device in this phase. No context or token is logged or sent to the backend.

Expo Calendar is not supported in Expo Go in the current SDK; use a development build after changing native modules or config plugins. Regenerate and rebuild native projects after such changes. The app config sets foreground-only location usage text, iOS full calendar usage text, Android coarse/fine location and read-calendar permissions, and stage-specific app schemes/package IDs.

## Cognito configuration request for D

Set these public build-time variables separately for each stage:

```text
EXPO_PUBLIC_STAGE=dev|prod
EXPO_PUBLIC_COGNITO_ISSUER=https://cognito-idp.ap-northeast-1.amazonaws.com/<user-pool-id>
EXPO_PUBLIC_COGNITO_CLIENT_ID=<mobile-public-app-client-id>
EXPO_PUBLIC_COGNITO_REDIRECT_URI=contextia-dev://auth  # use contextia-prod://auth for prod
```

Configure a separate public mobile app client per stage with authorization-code grant, PKCE, the `openid` scope, and the matching callback URL. Do not create a client secret for the mobile app. The app stores only its access token, optional refresh token, and expiry in SecureStore; the login UI does not display tokens or user attributes.

## Development builds

Set up Xcode/iOS Simulator (macOS) or Android Studio/SDK and its supported JDK. For a real iPhone, enable Developer Mode and configure signing; for Android, enable USB debugging.

```bash
EXPO_PUBLIC_STAGE=dev pnpm --filter @contextia/mobile ios --device
EXPO_PUBLIC_STAGE=dev pnpm --filter @contextia/mobile android --device
pnpm dev:mobile
```

Build and install the development app, then connect it to Metro. `contextia-dev://auth` and `contextia-prod://auth` must be allowlisted in their respective Cognito clients.

## Real-device verification

| Capability | iOS | Android |
|---|---|---|
| Cognito login | Not verified in this task | Not verified in this task |
| Foreground GPS | Not verified in this task | Not verified in this task |
| Calendar read and field projection | Not verified in this task | Not verified in this task |
| ContextInput schema validation on device | Not verified in this task | Not verified in this task |

The current task environment has no visible Android SDK/ADB or iOS build toolchain/device, so no native build or real-device result is claimed. Run this matrix on at least one device before marking the Phase 1 E device gate complete. JavaScript export and unit tests do not prove native behavior.

## Scope boundaries

- API evaluation is Phase 2.
- `StepSource`, iOS Pedometer, Android Health Connect, notifications, and background callbacks are later phases.
- Android historical step totals must not use the iOS-only Expo Pedometer range query.
- Background callbacks, if added later, are opportunistic and do not promise execution every five minutes.
