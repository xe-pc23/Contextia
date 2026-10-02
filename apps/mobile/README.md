# Mobile — React Native

Expo / React Native / strict TypeScript foreground client. Cognito sign-in connects the Dashboard, saved preferences, recommendation history/detail, and **今評価** to the shared backend API. Production evaluation uses device data and shared Zod contracts; test doubles exist only under `test/`.

## Local validation update — 2026-10-03

The owner cannot attach an iPhone directly to this Mac. Use the iOS Simulator for local native compilation,
sign-in, UI, permission and simulated-location checks, then hand actual hardware capabilities to a member
with a development-build device. Simulator results do not mark physical GPS, steps, background or remote push passed.
Xcode 26.6 is installed at `/Applications/Xcode.app`; CocoaPods 1.17.0 dependency installation completed.
The iOS 26.5 runtime is available. The owner has a Personal Team; a simulator build needs no signing team.

From the repository root, generate the ignored native project:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer EXPO_PUBLIC_STAGE=dev \
  pnpm --filter @contextia/mobile exec expo prebuild --platform ios --no-install --skip-dependency-update react,react-native
cd apps/mobile/ios
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer COCOAPODS_DISABLE_STATS=1 pod install
```

Run CocoaPods from `apps/mobile/ios`; `--project-directory` from the repository root does not give the
Podfile's Node subprocess the correct Expo resolution directory. Do not combine `--pnpm` with `--no-install`.
Check ignored `.xcode.env.local` uses the repository Node 24 executable rather than Homebrew's Node 25.
Debug builds require Metro; native compilation alone is not an executed app check.
See [Simulator and member hardware checklist](../../docs/MOBILE_VALIDATION.md) for the current validation matrix.

Dashboard now uses the backend's normalized `weather` reading for condition/temperature, labels forecast
coverage and observation time, and displays missing/null temperature explicitly. It makes no direct weather call.

## Development environment

Use the repository's Node 24.13.1 / pnpm 10.29.3 toolchain. The existing Expo SDK 57 dependencies are unchanged: Expo 57.0.26, React 19.2.3, React Native 0.86.3, and the previously integrated AuthSession / Calendar / Crypto / Location / SecureStore modules. No package or root lockfile update is required for this slice.

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm cdk:synth
```

`pnpm --filter @contextia/mobile build` exports iOS/Android JavaScript/Hermes assets into `apps/mobile/dist`. It does not compile an APK/IPA or verify native behavior.

## Stage-specific configuration

Copy `.env.example` to the ignored `apps/mobile/.env`, then fill in the **public application configuration** supplied by D. Never put AWS credentials, access/refresh tokens, or a client secret in these variables.

```text
EXPO_PUBLIC_STAGE=dev
EXPO_PUBLIC_API_BASE_URL=https://<http-api-host>
EXPO_PUBLIC_COGNITO_ISSUER=https://cognito-idp.ap-northeast-1.amazonaws.com/<user-pool-id>
EXPO_PUBLIC_COGNITO_CLIENT_ID=<mobile-public-app-client-id>
EXPO_PUBLIC_COGNITO_REDIRECT_URI=contextia-dev://auth/callback
```

The API base URL omits `/v1`, may include a stage path, and must use HTTPS without credentials, a query, or a fragment. Missing/invalid API or Cognito config shows an explicit unconnected state; the app does not fabricate recommendations.

For prod, use separate API / pool / mobile client values and `contextia-prod://auth/callback`. The callback default is now `contextia-{stage}://auth/callback`, matching the integrated CDK. D must allowlist this exact URI for both callback and sign-out, with authorization-code grant, PKCE, and the `openid` scope. The mobile client must have no secret.

SecureStore keys are isolated by stage and mobile client. The Phase 1 unscoped session key is not reused, so sign in again after upgrading. Tokens are never shown or logged. A valid access token is acquired at each API call; expired tokens refresh once for concurrent callers. Sign-out invalidates and aborts pending API work immediately, and queued credential writes cannot recreate a cleared session.

Transient refresh failures (network loss, timeout, missing endpoint, or malformed response) preserve saved credentials and return no access token. A later operation can refresh again without another sign-in; expired tokens are never sent. The Cognito adapter maps `invalid_grant` to an explicit refresh rejection, which clears the session. Credential storage failure also clears the session. An API HTTP 401 invalidates the session only if both its session signal and access token are still current, so a late 401 cannot erase a newer login or refreshed token. It returns unauthenticated without automatically replaying GET, PUT, or POST operations.

## Foreground behavior

- Sign-in fetches `/v1/me` and the recent recommendation list. Failed/missing routes show their actual error state.
- **端末の情報を読み取る** collects context locally. **今評価** collects it again and sends it to `/v1/context/evaluate`; it does not reuse an old GPS fix from the screen.
- LocationSource / CalendarSource / StepSource / ClockSource are injected into ContextCollector. Native prompts occur only on the collection/evaluation operation.
- Requests are fixed to `mode="real"`, `deliveryMode="proactive"`. Simulation, preview, scenario time, and preference overrides are not sent from this client.
- GPS denial or unavailability prevents evaluation. Calendar denial becomes an empty calendar plus a visible permission state. Failed step readings remain unknown and preserve other usable sources.
- StepSource exists, but the production Phase 2 implementation deliberately returns unavailable. Unknown steps are `null`, never zero or a claimed achieved goal. Native iOS / Android sources belong to Phase 3.
- Calendar reads cover the device-local current day through the end of the next three days, using the existing 31-day native query margin and overlap projection.
- Native calendar IDs are hashed. Only `id`, `title`, `startAt`, `endAt`, `location`, and optional `allDay` enter the request. Attendees, email, description, notes, meeting URL, organizer, and calendar IDs are discarded.
- Every request and response is parsed with the shared contracts. More than three recommendations, unsafe action URLs, unknown fields, and a preview response to a real request are rejected.
- Each new evaluation sends an Expo Crypto UUID as `Idempotency-Key`, validated with `EvaluationHeadersSchema`. UUID generation failure prevents the request. Other routes do not receive this evaluation header.
- Native collection has a 45-second wait limit; API operations have a 30-second limit including token acquisition and response reading. Authentication refresh / token exchange have a 12-second limit. API failures never automatically retry mutating requests.
- Evaluation is single-flight. A successful silent response replaces the previous recommendation instead of leaving old cards visible. Provider failures remain visible while successful data is retained.
- Foreground results are displayed in the app; there is no local/push notification path in this phase, even for a `notify` decision.
- Settings validate the full saved preference schema before PUT and show saved values only after acknowledgement. Failed writes preserve the previous saved profile.
- Recommendation history supports cursor pagination, and detail IDs are URI-encoded. Successful evaluation requests a first-page refresh; if an initial/page request is already running, refresh requests are coalesced and run after it completes, including after a failed read. Logout discards queued refreshes. A replaced/closed detail or logged-out evaluation cannot display a late response.
- Map actions open the supplied URL, or a coordinate-based map link when the response supplies a MAP place without a URL. No train times are synthesized when route/action data is missing.

## API / contract handoff to A and D

The mobile client calls these existing contracts:

| Route | Shared response schema |
|---|---|
| `GET /v1/me` | `GetMeResponseSchema` |
| `PUT /v1/me/preferences` | `UpdatePreferencesResponseSchema` |
| `POST /v1/context/evaluate` | `ContextEvaluateResponseSchema` |
| `GET /v1/recommendations?limit=20&cursor=...` | `ListRecommendationsResponseSchema` |
| `GET /v1/recommendations/{id}` | `GetRecommendationResponseSchema` |

At implementation base `bbdee8e`, Lambda's live evaluation composition is not injected, so the evaluate route returns `503 EVALUATION_UNAVAILABLE`; profile/preferences/history/detail routes are not implemented yet. D must compose the real provider/repository ports, create/read the user's profile, connect these Phase 2 routes, and supply the stage-specific build config before live mobile validation. Mobile source changes do not complete that backend work.

FR-021 asks the Dashboard to show weather, but `EvaluationResultSchema` exposes only `providerStatus.weather`, not a weather snapshot. The app currently shows the actual weather acquisition status. **A/D handoff:** add the minimum normalized weather summary to the shared contract and API before claiming temperature/condition display complete. E has not added a response field or a separate weather provider call.

Server-side idempotency records and context fingerprint guards are D's Phase 2 API work. This client prevents concurrent evaluation, sends an evaluation UUID, and never automatically retries mutating operations. A fresh user evaluation collects new context and uses a new UUID; that alone does not prevent duplicate processing when the user repeats an operation after a timeout. Any future transport retry must reuse the original key and payload, and distinct evaluations still require the backend's fingerprint guards. Exactly-once backend processing is not claimed. No additional dependency, provider, device registration, notification, background permission, or AWS infrastructure is introduced.

## Development builds and live smoke

Use Xcode/signing on macOS for iOS, or Android Studio/SDK and its supported JDK for Android. Enable Developer Mode on a real iPhone or USB debugging on Android. Calendar requires a development build; Expo Go is not a native verification substitute. Rebuild native projects after changing modules or config plugins.

```bash
EXPO_PUBLIC_STAGE=dev pnpm --filter @contextia/mobile ios --device
EXPO_PUBLIC_STAGE=dev pnpm --filter @contextia/mobile android --device
pnpm dev:mobile
```

After D's dev integration, record the mobile commit, `/health` backend build ID, stage, device, OS, and development-build identifier without recording private context or credentials:

1. Verify the exact Cognito callback and sign-out allowlist, then sign in.
2. Fetch the real profile; change a preference, save, and re-fetch it.
3. Read actual GPS/calendar and confirm permission state and the next-event summary.
4. Tap **今評価**, confirm a schema-valid real/proactive result and provider statuses, then open its detail and an available map/action.
5. Repeat evaluation to exercise the real delivery guards; a silent result must not leave old cards in the latest-result panel.
6. Test location denial/GPS off, calendar denial, network loss, expired authentication, and sign-out during a pending evaluation.
7. Confirm one API request for repeated taps and that no foreground local/push notification is sent.

## Verification status

The earlier Phase 2-E task environment had no ADB or Xcode executable on PATH and no Android SDK environment configuration. The current local Xcode/Simulator status is recorded above. No APK/IPA compilation, connected device, Cognito live login, or deployed API smoke is claimed. JS export and deterministic tests are separate checks.

| Capability | iOS | Android |
|---|---|---|
| Cognito sign-in / refresh / sign-out | Not verified on device | Not verified on device |
| Foreground GPS | Not verified on device | Not verified on device |
| Calendar read / field minimization | Not verified on device | Not verified on device |
| Real context → API → result/detail | Blocked by dev API/config and device validation | Blocked by dev API/config and device validation |
| Saved preferences | Blocked by dev API/config and device validation | Blocked by dev API/config and device validation |
| Map / route / website action | Not verified on device | Not verified on device |

2026-10-02 validation in the isolated Phase 2-E worktree, Node 24.13.1 / pnpm 10.29.3: frozen dependency installation, `pnpm lint`, `pnpm typecheck`, `pnpm test` (512 tests in 26 files; 121 mobile tests), `pnpm build` (including iOS/Android JS exports), and `pnpm cdk:synth` (offline dev/prod) passed. No infrastructure was deployed. Root package manifests and lockfile are unchanged.

Unit coverage includes real-only API requests, privacy projection, notify/silent and provider failure, contract rejection, evaluation UUID headers, HTTP errors, bounded waits, cancellation, token-refresh single-flight, transient refresh recovery, explicit refresh rejection, current-session 401 cleanup without replay, stale 401 rejection, logout/write races, stage-isolated credential storage, collection failure, settings acknowledgement, pagination, post-evaluation history refresh races, and stale-detail rejection. These checks do not complete the device/live gates above.

## Phase 3 boundaries

iOS Pedometer, Android Health Connect, foreground sensor fallback, background Location/TaskManager callbacks, local/remote notifications, device registration, and recommendation follow-up UI are later work. Android historical steps must not use the iOS-only Pedometer historical query. Background callbacks are opportunistic and do not promise execution every five minutes.
