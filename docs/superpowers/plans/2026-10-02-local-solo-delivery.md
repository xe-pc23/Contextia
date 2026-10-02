# Contextia Local Solo Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. The primary agent implements and integrates locally; fresh subagents review each completed slice and the final branch. Do not create Codex Cloud tasks or environments.

**Goal:** Complete the existing Contextia v1.1 specification as a reproducible, live AWS application with a public judge console and verified mobile behavior, using this local workspace.

**Architecture:** Preserve the pnpm workspace and the dependency direction contracts → domain/provider ports → API → Web/Mobile. Web preview and Mobile proactive requests use the same backend evaluation pipeline. Make one locally owned integration branch the source of truth, then promote a validated SHA through dev and prod.

**Tech Stack:** Node.js 24.13.1, pnpm 10.29.3, strict TypeScript, Zod, React/Vite, Expo development builds, Lambda Node.js 24.x, CDK, Cognito, DynamoDB, Amazon Location, Open-Meteo, Bedrock, GitHub Actions OIDC.

**Spec:** `docs/SPEC.md`; subordinate contracts and gates: `docs/API.md`, `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`, `docs/TEST_STRATEGY.md`, `docs/DEMO.md`. Read `docs/README_IMPLEMENTATION.md` and `AGENTS.md` first. This plan changes delivery order, not product behavior.

## Global Constraints

- `SPEC.md` > `API.md` / `DATA_MODEL.md` > `ARCHITECTURE.md` > implementation. Report a conflict; do not invent behavior.
- Use `contextia-{stage}-*` names; isolate `dev` and `prod` in account `634512763705`, Region `ap-northeast-1`. Confirm account and Region before any live change.
- The Scenario Console always sends `deliveryMode="preview"`: same evaluation/providers/model, no notification or daily quota increment, and `wouldSuppress` diagnostics. Never add a public guard bypass.
- Keep Zod validation at API and model boundaries, AWS SDK inside adapters, selected Places data under Storage intent, and provider failure states explicit. No fabricated transit/weather facts.
- Do not log or commit tokens, secrets, raw private context, or forbidden calendar fields. Use GitHub OIDC, private S3, CloudFront OAC, and stage-specific roles.
- Do not count offline tests as live AWS or Expo Go/JS export as native proof. Record each live result with stage, deployed SHA, time, and evidence.
- Before each slice is called complete, run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm cdk:synth`; review its diff with a fresh subagent. Fix findings and rerun affected checks.

## Starting Snapshot and File Map

On 2026-10-02, this checkout is `feature/phase0-d-platform` at `7b3091b` and is 45 commits behind its local `origin/feature/phase0-d-platform` tracking ref. It has pre-existing `.DS_Store` changes and an untracked `error.log`; preserve both. Local `main` at `7f99ff3` is specification-only. The latest locally visible integrated implementation is `f9d7945` (`codex/cloud-readiness-plan`), descended from Phase 2 A/B/D integration `6a588cb`. Web Phase 2 `a4d32fc`, Mobile Phase 2 `8da1e2e`, and AWS MCP evidence `a777e16` are separate. These are local ref observations, not a claim about current remote or CI state.

| Area | Existing files to carry forward or change |
|---|---|
| Contracts/domain | `packages/contracts/src/**`, `packages/domain/src/**`, `packages/test-fixtures/scenarios/**` — canonical schemas, five detectors, deterministic guards and fixtures |
| Providers | `packages/providers/src/ports/**`, `packages/providers/src/adapters/**` — Places/Geocode/Routes/Weather/Bedrock/DynamoDB; add notification adapters in Phase 3 |
| API | `apps/api/src/application/**`, `apps/api/src/runtime.ts`, `apps/api/src/handler.ts` — one evaluation path, account/chat routes, then device endpoints |
| Web | `apps/web/src/main.tsx`, `App.tsx`, `execution/**`, `scenario/**`, `result/**`, `map/**` — merge Phase 2 console, add Cognito session/runtime configuration and interaction checks |
| Mobile | `apps/mobile/src/auth/**`, `context/**`, `screens/**`, `api/**`, `application/**` — merge foreground app, then step sources, notification and background behavior |
| Deployment/evidence | `infra/cdk/src/**`, `.github/workflows/**`, `scripts/**`, `docs/DEMO.md`, `docs/hackathon/AGENT_LOG.md`, `README.md` — stage isolation, deploy/smoke, ship evidence |

## Review Focus

1. A stale branch or merge drops provider/contract work: Task 1 proves ancestry and all five commands on one SHA.
2. Web preview leaks delivery side effects: Tasks 2 and 3 test repeated preview, `wouldSuppress`, quota/notification invariance.
3. Missing/ambiguous live provider data becomes a guessed fact: Tasks 3 and 4 exercise failures and reject fabricated route/weather details.
4. Another user reads recommendation/chat or a token reaches logs: Tasks 3 and 6 test JWT ownership and log redaction.
5. Native behavior is inferred from a JS bundle: Tasks 5 and 7 record development-build results separately for iOS and Android.

## Task 1 — Establish one current local integration baseline

**Files:** inspect/merge `apps/web/**`, `apps/mobile/**`, shared contracts, lockfile; update `AGENTS.md`, `README.md`, `docs/README.md`, and `docs/hackathon/AGENT_LOG.md` with the local delivery mode and selected SHA.

**Produces:** One local `codex/` integration branch containing A/B/C/D/E Phase 2 changes and an exact baseline SHA. Later tasks use only that SHA or descendants.

- [x] Fetch and compare remote heads, PRs, CI, and worktrees. Preserve the current checkout's `.DS_Store` and `error.log`; do not reset them. Start from the newest validated A/B/D integration ancestor, not specification-only `main`.
- [x] Carry this local plan into the integration branch. Replace the 2026-10-02 Codex Cloud delivery-mode note in `AGENTS.md` and the current-plan links in `README.md`/`docs/README.md`; keep the older Cloud plan as historical record.
- [x] Reconcile `a777e16` AWS MCP evidence into `docs/hackathon/AGENT_LOG.md` without losing newer log rows. The secret-free screenshot proof remains a separate open gate.
- [x] Bring in `a4d32fc` Web and `8da1e2e` Mobile changes sequentially. Resolve shared-contract conflicts against `SPEC.md` and `API.md`; do not import a branch's unrelated deletions of newer contract/evidence files.
- [x] Run targeted Web preset/result tests and Mobile auth/context/controller tests. Confirm five fixture inputs reach `deliveryMode="preview"` in Web and the Mobile request remains proactive.
- [x] Run the five repository commands. Record actual test count and integrated SHA. Ask a fresh subagent to review merge omissions, contract drift, and privacy fields; address findings.

**Gate:** Both Phase 2 client changes are present, one integrated SHA passes all five checks, and no user files were overwritten.

## Task 2 — Connect the public Web Console to real auth and API

**Files:** `apps/web/src/main.tsx`, new focused `apps/web/src/auth/**` and runtime-config module, `apps/web/src/execution/scenarioApiClient.ts`, `apps/web/test/**`, `infra/cdk/src/core-stack.ts`, `scripts/smoke-checks.ts`.

**Produces:** Judge sign-in through the Web Cognito app client, an authenticated Scenario Console, and stage-derived API/config values. The Web must never show fixture prose as a live result.

- [x] Write failing Web tests for signed-out, login callback/session expiry, invalid runtime config, 401 recovery, five editable presets, map/coordinate sync, and a repeated preview with `wouldSuppress` shown.
- [x] Implement the smallest Cognito authorization-code/PKCE session flow. Preserve one stage-neutral Web build; read the existing CDK-generated `/config.json` at runtime. Keep tokens out of logs and URLs after callback processing.
- [x] Make `main.tsx` construct a real schema-validating evaluator only for an authenticated session; retain a clear disconnected/error state otherwise.
- [x] Run targeted Web tests, browser interaction checks with test doubles, and the five repository commands. Have a fresh subagent review auth state, token handling, preview semantics, and runtime stage config.

**Gate:** Web auth/API behavior passes against test doubles and the built artifact reads stage-derived runtime configuration; Task 3 proves real sign-in and preview after dev deployment. No hard-coded endpoint/model ID or fake recommendation remains in the production path.

## Task 3 — Prove the first live dev vertical slice

**Files:** `infra/cdk/src/**`, `.github/workflows/**`, `scripts/smoke.ts`, `scripts/smoke-checks.ts`, `apps/api/src/runtime.ts`, `docs/hackathon/AGENT_LOG.md`.

**Produces:** Live dev `STEP_GOAL_REST`: Cognito → API Gateway/Lambda → Places V2 + Bedrock → schema-valid response → Web, with DynamoDB persistence and preview invariants.

- [x] Check the local AWS profiles' account/Region, CDK diff, bootstrap qualifier, OIDC role trust, GitHub `dev`/`prod` environments, required non-secret variables, and Bedrock model access. Make needed CDK/workflow changes before live deployment. Record any service-level blocker precisely.
- [x] Change `scripts/smoke.ts` so dev gate mode fails when either test-user token is absent. Enable password auth on the existing dev Web Cognito client only for two dedicated smoke users; mint short-lived tokens on each workflow run from protected `dev` environment credentials without printing them. Keep the prod Web client on PKCE. Assert `/me`, schema-valid evaluation, a DynamoDB write, and cross-user recommendation denial. Public-only smoke remains a separate diagnostic, never a passed dev gate.
- [x] Use the validated local dev profile for the first core deployment that creates the OIDC roles; then exercise the dev workflow through OIDC. Record deployed SHA and outputs. Run public HTTPS/asset/health smoke and authenticated `/me`/step-goal evaluation.
- [x] Run the same preview twice. Verify the second response is visible, `wouldSuppress` identifies duplicate guards, no push is sent, and the daily notification count is unchanged. Test a valid proactive request separately in dev.
- [ ] Test another user's detail/chat access denial, token/redaction in structured logs, a provider timeout, and model-schema failure. Keep successful provider evidence if one fails. Exercise proactive guard/counter behavior with a dedicated dev test user; remote notification delivery is completed in Task 6.
- [x] Run the five commands and live smoke on the deployed SHA; have a fresh subagent review the CDK diff, IAM trust, persistence intent, and execution evidence.

**Gate:** A dated dev URL and SHA have real Web sign-in, Places and Bedrock evidence, mandatory authenticated smoke, and preview side-effect evidence. Offline or public-only smoke does not pass this gate.

## Task 4 — Complete and verify five scenarios and follow-up

**Files:** `packages/domain/src/triggers/**`, `packages/providers/src/adapters/{geocoding,routes,weather,bedrock,places}.ts`, `apps/api/src/application/**`, `apps/web/src/**`, corresponding tests and `docs/DEMO.md`.

**Produces:** All five editable Web scenarios use the same backend, with live Geocode/Routes/Weather where required; recommendation-scoped chat uses only persisted permitted facts.

- [x] Use existing five fixtures to write any missing regression tests for positive, negative, boundary, candidate exclusion, duplicate behavior, at most three recommendations, and correct used signals. Pin ambiguous geocodes, unavailable transit, out-of-range forecast, and unknown selected place/route IDs.
- [x] Repair only concrete adapter/orchestration gaps found by those tests; preserve `SingleUse` discovery and `GetPlace(IntendedUse=Storage)` for persisted selections.
- [x] Add the `docs/DEMO.md` §8 fault selector for weather or routes only in dev, accepting only the authenticated Web demo client and rejecting the selector in prod. Test the forced provider status and visible Web degradation while other valid candidates continue.
- [x] Run authenticated dev smoke for all five presets and the reproducible dev-only provider-degraded case; weather-dependent scenarios may validly be silent under live conditions. Confirm chat ownership, two-hour expiry, and no raw provider payload persistence.
- [x] Run the five commands and a fresh subagent review of normalized facts, provider statuses, and `SPEC.md` coverage.

**Gate:** Five deterministic fixture paths pass, each required live provider path has at least one observed dev result or an explicitly documented coverage blocker, and the dev-only degraded case reports no fabricated transit/weather fact. Prod rejects fault injection.

## Task 5 — Prove Mobile foreground locally, then on a real device

**Files:** `apps/mobile/src/auth/**`, `context/**`, `api/**`, `application/**`, `screens/**`, `app.config.ts`, focused tests, `apps/mobile/README.md`, and `docs/TEST_STRATEGY.md` device table.

**2026-10-03 execution update:** The owner cannot connect an iPhone by cable. First run the React Native development build on the local iOS Simulator for login, UI, minimized calendar and simulated-location checks. Prepare a reproducible hardware checklist for another member; actual GPS, steps, background callbacks and push remain open until that member records device results. Wireless pairing can be used if available; it is not a prerequisite for local development.

**Produces:** A locally executed iOS Simulator development build and a hardware handoff, followed by at least one iOS or Android development build that signs in, collects actual foreground GPS and minimized calendar events, calls the deployed dev API, and displays the result.

- [x] Add failing tests for denied location/calendar access, permitted calendar fields only, expired Cognito session, API error display, and validated response rendering.
- [x] Complete the merged Mobile foreground flow and stage runtime configuration. Keep attendees, descriptions, tokens in logs, and unbounded GPS history out of requests/persistence.
- [ ] Run targeted Mobile tests and the five repository commands. Build a development client, then record device, OS, build ID, stage, backend SHA, GPS/calendar permission result, and evaluation result; Expo Go or JS export is insufficient.
- [x] Ask a fresh subagent to review client privacy, auth expiry, and the device evidence; fix findings.

**Gate:** One real device has a dated foreground GPS + calendar → authenticated dev API → result proof. The other OS remains open for Task 7.

## Task 6 — Finish delivery state, device API, and observability

**Files:** `packages/contracts/src/**` first for API changes, `packages/providers/src/ports/**` and `adapters/**`, `apps/api/src/handler.ts` and `application/**`, `infra/cdk/src/**`, tests and `docs/API.md`.

**Produces:** `/devices` registration/deletion, one delivery path per recommendation ID, bounded/atomic proactive state, and CloudWatch logs/metrics without private payloads.

- [x] Add failing contract/API/repository tests for device registration, token rotation/deletion, account ownership, idempotent dispatch, daily cap across local-day/DST boundaries, and DynamoDB failure before notification.
- [x] Pin the path table in tests and `docs/API.md`: preview → `preview`/no delivery; foreground Mobile → `ready`/in-app only; background Mobile → `ready`/local only; explicit server push → `sent` or `failed`/no local fallback; silent → `suppressed`. Public `/context/evaluate` produces the client path; only a trusted internal application command may choose server push. Reserve `client` or `remote` atomically before a recommendation becomes visible, and never change a `ready` client recommendation into a remote send later. Test a server send racing a Mobile local callback and a failed/retried server send: one recommendation ID must use one path. `sent` means provider acceptance, not OS display.
- [x] Implement both Expo Push and SNS adapters through the notification port and device API. Configuration selects exactly one remote adapter for each send; do not send through both for one recommendation ID. Preserve idempotency across retries without logging tokens.
- [x] Add structured metrics/logging for request/evaluation/provider/model counts and latency, with no auth/push token or raw context. Verify stage-specific log retention and API throttling.
- [x] Run the five commands and a fresh subagent review of concurrency, privacy, IAM, and the updated API contract.

**Gate:** Competing server/client paths deliver at most once per recommendation ID, counters remain correct, and logs/metrics are observable without private data.

## Task 7 — Finish Mobile native behavior on both platforms

**Files:** `apps/mobile/src/context/**`, `application/**`, `screens/**`, `app.config.ts`, tests, `apps/mobile/README.md`, and `docs/TEST_STRATEGY.md` device table.

**Produces:** Foreground dashboard/feed/detail/chat, iOS steps, feasible Android Health Connect steps, permission health, local notification deduplication, and opportunistic background callbacks.

- [x] Write failing tests for `StepSource` selection/confidence, permission denial, local notification dedup by recommendation ID, background callback behavior, and feed/detail/follow-up rendering.
- [x] Implement iOS Pedometer and Android Health Connect through `StepSource`; label foreground-only fallback lower-confidence. Implement background location callbacks without a fixed five-minute promise.
- [x] Connect dashboard, preferences, feed/detail/follow-up, and local notifications to the same authenticated API. Follow Task 6's path table; suppress local delivery for a `sent` or `failed` server path.
- [ ] Run the five commands, then make iOS and Android development builds. Record device, OS, build ID, stage, backend SHA, and each capability result separately, including login, GPS, calendar, steps, local notification, background callback, and map/deep link.
- [ ] Have a fresh subagent review native permission/privacy behavior and the device evidence; resolve findings.

**Gate:** The required iOS/Android device matrix has actual results. Unavailable devices or OS capabilities remain explicitly open rather than being marked passed.

## Task 8 — Release and submission audit

**Files:** `.github/workflows/**`, `infra/cdk/src/**`, `README.md`, `docs/DEMO.md`, `docs/hackathon/AGENT_LOG.md`, and only defect-related source/tests.

**Produces:** Validated `main`, manually triggered prod deployment, public judge URL, working demo account, and traceable hackathon evidence.

- [ ] Run the five checks on the release SHA; review `SPEC.md` acceptance items, stage isolation, OIDC trust, private S3/OAC, TTL, CloudWatch, provider/model config, and no committed secrets. Request a whole-branch subagent review and fix actionable findings.
- [ ] Merge the validated integration branch to `main` through the repository workflow. Check prod-only CDK diff and trigger the production workflow from `main`; verify deployed SHA matches the reviewed SHA.
- [ ] In a private browser session, open CloudFront URL, sign in with the judge account, edit coordinates/events, run a real scenario, inspect signals/provider diagnostics, and verify `/health`. Require authenticated prod smoke; a public-only pass is insufficient. Keep credentials only in the approved private handoff channel.
- [ ] Record Codex→AWS MCP interaction and a secret-free proof reference in `docs/hackathon/AGENT_LOG.md`; finish `docs/DEMO.md` Ship Gate, README URL, deployment SHA, and the exact device/test limits.

**Gate:** Public production Web and authenticated API work from an external browser, at least one live provider + Bedrock recommendation succeeds, all five fixtures pass, the dev-only degradation case is proven, the required iOS and Android development-build matrix has actual results, AWS agent proof exists, and unresolved risks are stated factually. A missing mandatory device result keeps the release gate open.

## Execution Order and Human Dependencies

Run Tasks 1–5 before broad Phase 3 work so the public vertical slice and one real Mobile foreground path are established early. Tasks 6 and 7 can proceed in separate local code slices, but the primary agent owns their contract/lockfile integration and the single release SHA. A fresh subagent reviews each slice; no subagent makes an independent product-scope decision.

The local AWS profiles and GitHub access should be used where available. If bootstrap, OIDC environment protection, model entitlement, judge credentials, or real devices require an action only the account owner can perform, finish all code and read-only checks first, then request the exact minimal action with the failing gate and evidence. Do not call the release complete while a mandatory live or native gate remains unverified.

## Execution evidence — 2026-10-03 04:10 JST

- Dev `ba15f30db006c56ca7702fd4f22570bb841e423b` was deployed through GitHub OIDC.
  [Run 37046597403](https://github.com/xe-pc23/Contextia/actions/runs/37046597403) passed validation,
  deployment and mandatory authenticated smoke. Public URL: https://d1grgebh7iqqmf.cloudfront.net/.
  Five previews, idempotency/state/quota invariants, live STEP_GOAL_REST Places/Bedrock and an actual
  scheduled transit card, owned chat and cross-user denial were observed. Weather-adaptation's model
  call timed out and remained explicitly degraded; this is not a claim all provider paths always succeed.
- Task 7 native code has Sensors/Health Connect step sources, saved-timezone day/DST handling,
  globally registered opportunistic TaskManager callbacks, read-only headless auth and bounded atomic
  SQLite claims. Native iOS Debug build/install passed. Android minSdk 26 is committed configuration;
  SDK/license and APK/device proof remain open. Foreground sensor fallback is a tested primitive
  without an enabled native subscription. Headless expired access tokens skip until foreground refresh.
- Current source passed the five commands (1,253 tests / 78 files). Independent native/provider/IAM
  reviews led to fixes for stale permission prompts, start/stop ordering, post-acceptance notification
  cleanup, minimum Android SDK and recovered-model validation metrics. Extended live fault, SRP,
  proactive counter and recent EMF checks are prepared for the next dev SHA.
- Tasks 3/4 full live UI evidence, Task 5/7 hardware matrix and Task 8 production release remain open.
  A Simulator build, SRP script or JS export does not close a native capability row.

## Release audit evidence — 2026-10-03 04:35 JST

- The next dev SHA `79ff4cd7986a79760f3186032f45361d4e9dbc63` passed OIDC validation/deployment,
  but [run 37052996485](https://github.com/xe-pc23/Contextia/actions/runs/37052996485) failed the
  mandatory positive step gate on a valid silent model decision. Extended fault/SRP/proactive/EMF
  checks were not reached; the prior successful run does not prove these new checks.
- Whole-branch reviews reproduced four defects: missing MapLibre worker asset, a route associated
  with the wrong place, provider-current opening flags applied to simulated time, and smoke profile
  creation overwriting a concurrent winner. Regression tests failed before each fix and passed after.
  Provider association is enforced during compact model hydration, API validation and storage;
  opening availability remains unknown for simulation; smoke creation is conditional.
- The corrected source passed lint, typecheck, 1,258 tests / 79 files, build and dev/prod CDK synth.
  Independent reviewers verified negative/positive provider pairs and profile race recovery. These
  fixes need dev deployment and live confirmation; browser/hardware/production gates stay open.

## Live UI and follow-up audit — 2026-10-03 04:57 JST

- Dev `53dfd72` passed OIDC validation/deploy and the first run's five-preview, step and real-transit
  checks. Weather-fault positive failed once; a standalone probe later passed but did not read quota.
  The CI retry failed fresh duplicate diagnostics while manual testing used the same identity.
  Run the next mandatory smoke without concurrent manual evaluations of its dedicated user.
- Actual dev browser PKCE callback, map rendering/clicking/coordinate editing, live step result and
  logout clearing results/disabling Run were observed. Secret-free map proof is
  `docs/hackathon/evidence/dev-map-53dfd72.jpg`. Mobile SRP resolved to the same owned profile as Web;
  neither browser evidence nor the SRP script closes the native matrix.
- Live UI exposed unclear Japanese prose and a selected Places card marked unused. Explicit resolved
  language/field meanings and historical-prose-as-data instructions address the prose failure without
  removing summaries or forcing notify. Selected validated cards establish `places` usage in both
  stored and returned signals; unrelated successful provider calls do not. Regression tests and
  read-only review cover these changes; live prose/provenance verification remains required.
- The prose/provenance slice passed all five commands with 1,263 tests / 79 files. Dev-only fault
  diagnostics are emitted before the assertion so a failed case still records fixed canonical status
  codes without leaking model prose or private context. Infrastructure configuration is unchanged.

## Successful extended dev evidence — 2026-10-03 05:10 JST

- `0e443f828d84441ac032c045a47e40bfdb5437c8` passed [run 37057828984](https://github.com/xe-pc23/Contextia/actions/runs/37057828984):
  validation, OIDC deploy, public SHA/assets/config, five previews, step/transit, fault degradation,
  owned chat/expiry/cross-user denial, replay/snapshot/quota invariants, Mobile SRP, one ready client
  reservation with one quota increment, duplicate/cap suppression and bounded recent EMF metric coverage.
  No concurrent manual evaluation used that identity during this run.
- Browser PKCE login, clean callback URL, live Japanese step recommendation and selected Places usage
  were observed. Evidence: `docs/hackathon/evidence/dev-preview-0e443f8.jpg` and
  `dev-diagnostics-0e443f8.jpg`; the earlier map proof covers click/editing and logout was verified.
- Real iOS/Android rows, authenticated Simulator UI, SNS and production remain open. Mac lock prevents
  native UI actions. MCP OAuth and local AWS login also expired; OIDC dev deployment remains usable.
  No hardware or production gate is closed by this script/browser evidence.

## Foreground native and privacy gate update — 2026-10-03 07:30 JST

- Native Simulator PKCE login, simulated public GPS, nonempty neutral Calendar collection → dev
  evaluation, owned detail/chat, settings save/readback and explicit logout passed. Evidence and the
  development Reload freeze investigation are in `docs/MOBILE_VALIDATION.md`. Refresh/denial,
  actual steps, background callbacks and OS notifications remain open; this is not hardware proof.
- Review found automatic 401/refresh rejection/access-only expiry left native notification cleanup
  behind. All session-clear paths now revoke eligibility immediately and serialize cleanup/credential
  deletion before a new login. Seven red regressions became green; focused native review passed
  45 tests. Explicit logout also cleared the visible private Simulator UI.
- The dev smoke now places distinct synthetic markers in successful/invalid owned chat probes,
  correlates their 200/400 API request IDs, checks strict structured request fields and scans every
  raw message for those markers and three transient tokens in an unfiltered complete bounded window.
  Direct JSON, Lambda JSON wrappers and TEXT prefixes are supported. Pagination gaps fail closed.
  Evidence stays in memory; raw logs and secrets are never printed. Live verification awaits this SHA.
- Independent review passed the 33 focused smoke tests. All five local gates passed with 1,289 tests
  / 80 files. No infrastructure/model/IAM configuration changed. Live timeout/model-schema evidence,
  AWS MCP OAuth proof, Android SDK/license, physical devices, SNS and owner-controlled prod remain open.

## Android build and live privacy gate update — 2026-10-03 07:50 JST

- Documentation head `6c5b165` passed Validate run `37073133679` and owner dev deployment run
  `37073130086`: all five commands, 1,289 tests / 80 files, exact-SHA public/authenticated checks,
  and bounded correlated request-log privacy/EMF coverage. The specified chat markers and three
  transient tokens were absent in the fully fetched bounded window; this is not an exhaustive
  guarantee about every private field or materialized CloudWatch metrics. No quota reset was used.
- Owner-approved Android SDK packages were installed under the accepted SDK license. The arm64
  Debug APK built successfully from `6c5b165`; independent APK manifest/ABI/signature inspection
  passed. `docs/MOBILE_VALIDATION.md` records the toolchain, artifact hash and Metro dependency.
  Android runtime/hardware results and the full Task 7 matrix remain open.
- AWS MCP `aws-mcp` needs normal OAuth reauthentication. Access to
  `us-east-1.oauth.signin.aws` was declined; the CLI flow was stopped. The owner is checking
  Settings → Browser before a fresh same-domain authorization request and will perform login/MFA.
  No alternate access path, browser-policy change or AWS permission addition was performed.
  After authentication, use a read-only MCP call to prove recovery. OIDC dev validation remained usable.
