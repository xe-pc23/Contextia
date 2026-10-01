# Web Scenario Console — Phase 1 (lane C, in progress)

React/Vite/strict TypeScript console for judges. It edits synthetic device context and sends it to the same `POST /v1/context/evaluate` endpoint used by mobile, fixed to `mode="simulation"` and `deliveryMode="preview"`.

**Current state:** input editing, the step-goal preset, request validation, the API client, and result rendering are implemented and tested. The API URL, Cognito login, and MapLibre map are **not connected yet** (waiting on lane D, see below). Until then the screen says so, the Run button is disabled, and no recommendation is ever shown. There are no fake providers or canned AI results in the product path.

## Structure

```text
src/
├── App.tsx                     # layout, editor state, run wiring
├── main.tsx                    # mounts App as "unconnected" until D's config exists
├── scenario/
│   ├── form.ts                 # editor state, reducer, buildScenarioRequest (contract-validated)
│   ├── time.ts                 # datetime-local <-> RFC 3339 with an IANA timezone offset
│   ├── presets.ts              # Phase 1 preset list (step-goal only)
│   └── *Editor.tsx             # location, clock, steps, calendar, preferences editors
├── execution/
│   ├── scenarioApiClient.ts    # POST /v1/context/evaluate, request + response validation
│   ├── runState.ts / useScenarioRun.ts
│   └── RunControls.tsx
├── result/                     # decision, ≤3 cards, used signals, provider status, delivery, debug context
└── map/MapPanel.tsx            # placeholder until MapLibre is available
```

## Behavior

- **Presets** call `getScenarioInput` and fill only the editor. Mock provider data and AI text from fixtures are never used. Phase 1 exposes only `step-goal`.
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
  - Status, latency, and code for each of the five providers, with a warning when a provider is degraded.
  - Preview delivery diagnostics: `wouldSuppress` and the guard codes.
  - Identifiers, plus a toggle that shows the exact validated context that was sent.

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
- `scenarioForm.test.ts`: preset round-trip, map-position updates, coordinate/steps/time/timezone/interest validation, calendar add/update/remove, the 31-day rule, and the 100-event cap.
- `scenarioApiClient.test.ts`: endpoint rules, bearer header, never sending invalid or proactive input, response schema rejection (more than 3 cards, non-preview delivery, unknown fields, unsafe URLs, non-JSON bodies), the error envelope, network errors, and timeouts.
- `resultPanel.test.tsx` and `app.test.tsx`: static rendering of every state, using `react-dom/server`.

Test doubles live only under `test/`. Interactive DOM tests (clicking the map, typing into inputs) need a DOM environment that is not yet in the lockfile. Those interactions are covered by pure reducer tests plus a manual Chromium check. Playwright E2E is Phase 3.

## Pending requests to lane D

C does not edit the root lockfile or CDK. The Console needs the following from D.

1. **Dependencies for `apps/web`** (lockfile update by D):
   - `zod` 4.6.5 as a direct dependency. This is the same version as contracts. It is needed to parse the runtime config and the Cognito token response.
   - `maplibre-gl` 6.x (current 6.11.2), for the interactive map.
   - Optional devDependencies for interactive component tests: `jsdom`, `@testing-library/react`, and `@testing-library/user-event`.
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

## Next steps (C, after D delivers)

Load and validate `config.json`, add Cognito sign-in/out, render MapLibre with two-way sync between map clicks and coordinate inputs, connect the evaluator, and run the dev smoke (login → step-goal preview → real Places + Bedrock → rerun shows `wouldSuppress`), recording the commit SHA. The end-to-end smoke has **not** been run yet because the API is not connected.
