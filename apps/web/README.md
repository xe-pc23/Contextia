# Web Scenario Console — Phase 2-C

React/Vite/strict TypeScript console for judges. It edits synthetic device context and sends it to the same `POST /v1/context/evaluate` endpoint used by mobile, fixed to `mode="simulation"` and `deliveryMode="preview"`.

**Current state:** all five input presets, multiple calendar-event editing, request validation, the API client, provider/delivery diagnostics, and sent-context inspection are implemented. The API URL, Cognito login, and MapLibre map are **not connected yet**. Until then the screen says so and the Run button is disabled.

**Phase 1-B is still pending.** This branch starts at the common integration commit `bbdee8e` on `feature/phase0-d-platform`; it does not incorporate the unmerged B provider branch. Five presets are available for input editing, but live provider/persistence behavior and the five-scenario backend integration are unverified. Test transports and synthetic API responses exist only under `test/`. The product renders only validated responses from the shared backend.

## Structure

```text
src/
├── App.tsx                     # layout, editor state, run wiring
├── main.tsx                    # mounts App as "unconnected" until D's config exists
├── scenario/
│   ├── form.ts                 # editor state, reducer, buildScenarioRequest (contract-validated)
│   ├── time.ts                 # datetime-local <-> RFC 3339 with an IANA timezone offset
│   ├── presets.ts              # all five input presets; injectable local date
│   ├── presetInputs.json        # input-only snapshots; canonical parity checked in tests
│   └── *Editor.tsx             # location, clock, steps, calendar, preferences editors
├── execution/
│   ├── scenarioApiClient.ts    # POST /v1/context/evaluate, request + response validation
│   ├── runState.ts / useScenarioRun.ts
│   └── RunControls.tsx
├── result/                     # decision, ≤3 cards, used signals, provider status, delivery, debug context
└── map/MapPanel.tsx            # placeholder until MapLibre is available
```

## Behavior

- **Presets** expose `upcoming-transit`, `step-goal`, `free-time`, `weather-adaptation`, and `early-arrival`. `createPresetInput(id, now)` validates the input-only `presetInputs.json` snapshot, uses today's local date in the preset's IANA timezone, preserves its fixed daytime scenario time, and shifts calendar events by the same elapsed time. Event offsets and durations are preserved. The clock is injectable for tests. Loading a preset changes only the editor; Run submits the displayed scenario time, including manual edits, rather than advancing the simulated timeline while the page is open. Reload a preset to move it to today's date. Weather is fetched by the backend for the selected position; the weather preset guarantees neither rain nor a recommendation.
- **Fixture separation:** `src/` does not import `@contextia/test-fixtures`, whose index includes mock provider responses. The Web snapshots were generated from `getScenarioInput`; tests compare all five snapshots with the canonical inputs on the fixture date and build the product to verify that test-fixture modules and synthetic provider facts are excluded. If A changes a canonical input, update its Web snapshot to satisfy the parity test. The shared fixture package and exports are untouched.
- **Request building:** `buildScenarioRequest` turns editor strings into a `ScenarioContextInput` and validates it with `ScenarioContextInputSchema`. Validation errors appear under the field that caused them, in Japanese. Scenario time and event times are entered as wall time in the chosen IANA timezone and sent with that zone's offset. For DST-skipped or repeated local times, the Temporal "compatible" rule is applied. The same instant is used for `capturedAt`, `scenarioTime`, and `location.capturedAt`. The step goal is sent as both `activity.stepGoal` and `preferencesOverride.stepGoal`. A blank step count is sent as `stepsToday: null`, with no goal claim. Calendar events carry only `id`, `title`, `startAt`, `endAt`, `location`, and `allDay`.
- **API client** (`createScenarioApiClient`):
  - It refuses non-HTTPS base URLs; HTTP is allowed only for localhost.
  - Before sending, it validates the request against the simulation/preview schema, so a real/proactive body can never be sent. It also requires a Cognito access token, sent as `Authorization: Bearer`. Requests use `credentials: "omit"` and time out after 30 s.
  - Responses are shown only if they pass `ContextEvaluateResponseSchema` (which allows at most 3 recommendations, all five provider keys, and HTTP(S)-only action URLs) and report `delivery.mode="preview"`.
  - Errors are mapped from the standard error envelope or HTTP status. Raw bodies are not shown.
- **Result panel:**
  - A notify or silent decision, with trigger, urgency, and a concise reason. No chain-of-thought is shown.
  - Up to 3 recommendation cards. Action links open with `rel="noopener noreferrer"`.
  - Used and unused signals.
  - Status, latency, and code for each of the five providers, with a warning for `degraded`, `unavailable`, `timeout`, or `error`. Successful provider facts and recommendation cards remain visible.
  - Preview delivery diagnostics: an explicit `wouldSuppress=true/false` and the guard codes. The client does not calculate guards or update notification counters.
  - Identifiers, plus a closed native toggle that shows the exact schema-validated context that was sent. The API does not return a separate backend-normalized context; the label identifies the sent request accurately. **SPEC FR-020's normalized-context requirement remains incomplete** and needs an A/D contract and API change; the sent request is not claimed as its replacement.
  - If inputs change after submission, a notice explains that the result belongs to the submitted context and that another Run is needed for the edited inputs.

## Commands

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm dev:web                         # http://127.0.0.1:5173
pnpm --filter @contextia/web build   # apps/web/dist
pnpm exec vitest run apps/web        # web tests only
```

## Tests

`apps/web/test` runs under the root Vitest config (node environment):

- `time.test.ts`: offset conversion, DST gap/overlap, invalid input.
- `presets.test.ts`: all canonical preset IDs and exact input-snapshot parity, local-date loading at fixed daytime hours (including overnight), preserved event offsets, local midnight/year rollover, fixture immutability, request round-trips, and each preset through calendar edits and manually edited time to the schema-validating API client using a test transport.
- `bundle.test.ts`: builds the actual production entry in memory and verifies that test-fixture modules and synthetic provider facts are excluded.
- `scenarioForm.test.ts`: preset round-trip, map-position updates, coordinate/steps/time/timezone/interest validation, calendar add/update/remove, the 31-day rule, and the 100-event cap.
- `scenarioApiClient.test.ts`: endpoint rules, bearer header, never sending invalid or proactive input, response schema rejection (more than 3 cards, non-preview delivery, unknown fields, unsafe URLs, non-JSON bodies), the error envelope, network errors, and timeouts.
- `resultPanel.test.tsx` and `app.test.tsx`: static rendering of every state, all six provider statuses, each delivery guard and combined guards without hiding preview cards, the sent-context toggle and edited-input notice, and all five preset controls using `react-dom/server`.

Test doubles live only under `test/`. Interactive DOM tests (clicking the map, typing into inputs) need a DOM environment that is not yet in the lockfile. Those interactions are covered by pure reducer tests plus a manual Chromium check. Playwright E2E is Phase 3.

### Initial validation — 2026-10-02 (`645e1ca`)

On the isolated `feature/c-phase2-console` worktree, with Node.js 24.13.1 and the repository's pnpm 10.29.3:

- `pnpm lint`: passed.
- `pnpm typecheck`: passed across all workspaces.
- `pnpm test`: 450 tests in 22 files passed; the Web subset is 121 tests in 6 files.
- `pnpm build`: passed, including Web and Mobile JS exports.
- `pnpm cdk:synth`: dev/prod offline synthesis passed; no AWS deployment.
- Chrome against the temporary local Web: switched all five presets and checked their device inputs and event offsets; added/edited/removed multiple events; verified an invalid coordinate error and its removal; opened the request-context toggle and checked simulation/preview and allowed calendar fields. Run stayed disabled and preset loading never initiated evaluation.

Provider/delivery result rendering is verified with schema-valid test responses, not live B adapters. Authenticated dev/prod smoke, persistence and notification-counter checks remain unperformed. Full Phase 2 integration is not complete.


### Review-fix validation — 2026-10-02

Node.js 24.13.1 / pnpm 10.29.3, on the same C-only worktree:

- The production-bundle regression reproduced the test-fixture module inclusion on `645e1ca`, then passed after replacing the runtime import with input-only snapshots.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (463 tests / 23 files), `pnpm build`, and dev/prod offline `pnpm cdk:synth` passed. The Web subset is 134 tests / 7 files.
- Regression coverage includes canonical input parity, overnight loads preserving daytime conditions, local midnight/year rollover, and each preset's manually edited scenario time reaching the API test transport.

These review fixes do not add live-provider, authenticated smoke or notification-counter proof; the integration work above remains pending.

## Pending requests to lane D

C does not edit the root lockfile or CDK. The Console needs the following from D.

1. **Dependencies for `apps/web`**:
   - D has already added direct dependencies `zod` 4.6.5 and `maplibre-gl` 6.11.2 with the lockfile update. Phase 2-C adds no dependencies and does not change the root lockfile.
   - Optional Phase 3 devDependencies for interactive component tests: `jsdom`, `@testing-library/react`, and `@testing-library/user-event`; any lockfile change remains D's responsibility.
   - No Cognito SDK is needed. Login will use Hosted UI Authorization Code + PKCE through `fetch` and Web Crypto (ARCHITECTURE §12).
2. **Runtime config** served at `/config.json`. The proposal is to generate it from stack outputs with CDK `BucketDeployment` + `Source.jsonData`, so one web build serves both stages (CI_CD.md §11–12). Serve it with no/short cache, like `index.html`.

   ```json
   {
     "stage": "dev",
     "apiBaseUrl": "https://{api-id}.execute-api.ap-northeast-1.amazonaws.com",
     "auth": {
       "cognitoDomain": "https://{prefix}.auth.ap-northeast-1.amazoncognito.com",
       "clientId": "{web app client id}",
       "redirectUri": "https://{cloudfront-domain}/",
       "scopes": ["openid", "email"]
     },
     "map": { "region": "ap-northeast-1", "styleName": "Standard", "apiKey": "{restricted map key}" }
   }
   ```

   `apiBaseUrl` excludes `/v1`; the client appends `v1/context/evaluate`. For local development, put a dev copy at `apps/web/public/config.json` (to be git-ignored).
3. **Cognito web app client:**
   - A public client (no secret) using the authorization code grant with PKCE. Scopes are `openid` and `email`.
   - Callback and sign-out URL: the CloudFront origin `/`. The dev client may also allow `http://127.0.0.1:5173/` and `http://localhost:5173/`; prod must not.
   - The API JWT authorizer must accept this client's access token.
4. **API CORS:**
   - Allowed origins: the CloudFront origin, plus localhost:5173 in dev only.
   - Methods: `POST` and `OPTIONS`.
   - Headers: `authorization`, `content-type`, and `accept`.
   - No credentials.
5. **Preview authorization:** the Console always sends simulation/preview. The backend decides how to recognize the Console/demo context, for example by web client ID or a Cognito group.
6. **Map key:** an Amazon Location API key restricted to the `geo-maps` actions MapLibre needs, to the CloudFront referrer (dev may add localhost), with an expiry date. Use separate dev and prod keys.
7. **Normalized-context contract (A/D):** SPEC FR-020 requires a raw normalized context toggle. The existing response has no such field. A/D must define a schema for the actual evaluation context and return it to authorized preview clients, observing privacy limits. C can then render that response. This PR does not alter SPEC/API/contracts or synthesize a backend-normalized context from the request.

## Integration handoff (after Phase 1-B and D deliver)

Complete the pending Phase 1-C runtime-config, Cognito and MapLibre connections with D's settings. Integrate B's live adapters/persistence and A/D's five-detector pipeline through their owner PRs. Then run the dev smoke for each preset with the actual backend and record the deployed commit SHA. Repeating the same preview must keep content visible, diagnose duplicate delivery when applicable, and preserve notification counters. Weather depends on real conditions and coverage; unsupported transit must remain explicitly unavailable. These end-to-end/provider checks remain pending; frontend test doubles do not satisfy them.
