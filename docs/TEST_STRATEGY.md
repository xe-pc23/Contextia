# TEST_STRATEGY.md — Test & Quality Plan

Phase 0 contract tests are in `packages/contracts/test`; synthetic input/enrichment integrity tests are in `packages/test-fixtures/test`. Run them through the root Vitest configuration (source aliases work before build). They validate schemas and fixture integrity; they do not prove detector, live provider, authentication, Web or native behavior.

Phase 1 delivery guards are tested in `packages/domain/test/deliveryGuards.test.ts`.
Coverage includes all three daily-cap boundaries, disabled notifications, exact
fingerprint/trigger/anchor matching, configurable per-trigger policy, 5-minute
fingerprint and fallback 30-minute anchor windows at ±1 ms, clock rollback,
invalid state failure, complete preview diagnostics and
input-state immutability. Timezone cases include profile/client/UTC fallback,
Tokyo midnight independent of UTC midnight, year rollover, a non-hour offset,
and New York's 23/25-hour DST days through the next local midnight.

Review regression tests also reject malformed/missing/non-string persisted
`notificationDay`, datetime values and impossible calendar dates in both modes
even when the notification count has reached its cap. Valid leap days still
enforce the cap and reset it on the next valid day.

The step-goal anchor regression must verify suppression beyond 30 minutes and
through the remainder of the same local day, then release at the next local
midnight. Test the instant before/at midnight, profile/client/UTC fallback,
UTC and local dates that differ, and New York's 23/25-hour DST days. A changed
trigger or anchor must not match; other triggers retain the 30-minute fallback.
Cover numeric trigger overrides, invalid policy values, future matching times
and malformed matching timestamps. Preview must keep evaluation eligible while
reporting `RECENT_SAME_TRIGGER` / `wouldSuppress=true`, with input counts/anchors
unchanged.

Guard tests use an injected server clock and a separately recorded
`latestContextProcessedAt`. A repeated preview updates only processed-fingerprint
metadata in the test harness; both evaluations remain eligible, the second
reports `DUPLICATE_CONTEXT`, and notified counts/anchors remain unchanged.
This verifies domain policy. B/D integration must additionally prove persisted
processing metadata (Issue #5), atomic proactive rechecks using the same
per-trigger policy and resolved timezone, preview authorization and no actual
notification/counter update in a deployed request. Repository tests must also
prove concurrent requests allow only one step-goal delivery for a local-day
anchor, and retention/pruning preserves active day anchors until local midnight.
The existing seconds-only repository anchor window must be extended before
proactive integration; domain regression tests do not prove that adapter behavior.

For native Windows validation, use Node 24.13.1 and pnpm 10.29.3 with a concise
process-local PATH. `npm_config_shell_emulator=true` lets pnpm execute existing
POSIX-style Mobile build commands without changing scripts or the lockfile.
Ensure a native pnpm executable/shim on PATH for CDK's `spawnSync('pnpm')`.
The emulator is a validation-environment setting, not a new project dependency.

`packages/domain/test/stepGoalRest.test.ts` verifies the positive and two negative
fixtures, goal-1 / goal / goal+1, contract goal limits, conflicting reached flags,
missing activity/steps, nullable-goal fallback, low-confidence evidence and
consistent goal precedence in real/simulation modes. Normalization tests keep
simulation time separate from the server clock, use real clock injection, and
check date anchors at timezone/DST boundaries. Combined detector/guard tests
confirm same-day suppression after more than 30 minutes, release for the next
local-day candidate, and repeated preview candidate evaluation without consuming
notified counts or anchors. No external providers are called.

Phase 1 A validation (2026-10-01, native Windows, Node 24.13.1 / pnpm 10.29.3):
`pnpm lint`, `pnpm typecheck`, `pnpm test` (190 tests in 10 files), `pnpm build`
(including both Mobile JS exports), and `pnpm cdk:synth` (dev/prod offline)
passed. The built domain/fixture exports were also imported and exercised.
The final esbuild/CDK checks ran outside the filesystem sandbox after its
ancestor-directory read restriction prevented bundling. No dependency or
lockfile changes were needed. Deployed dev smoke, live providers, actual
notification delivery and native-device behavior remain unverified here.

Step-goal local-day regression validation (2026-10-01, Node 24.13.1 /
pnpm 10.29.3): lint, workspace typecheck, all 230 tests in 10 files, build
(including Android/iOS JS exports), and dev/prod offline CDK synth passed.
No dependency or lockfile changes were needed; the B/D atomic-delivery and
processing-time integration requirements above remain unverified.

## 1. Goal

Testing must maximize confidence per minute. The system depends on OS data, external APIs, AWS infrastructure, and an LLM, so the strategy separates:

1. deterministic domain tests,
2. provider adapter tests,
3. API integration tests,
4. deployed smoke tests,
5. a small amount of UI E2E/manual device testing.

## 2. Tooling

Recommended:
- `vitest` — TypeScript unit/integration tests.
- React Testing Library — Web.
- React Native Testing Library — Mobile component logic.
- `playwright` — Web Scenario Console E2E.
- AWS SDK client mocks or dependency injection — adapter tests.
- CDK assertions — infrastructure tests.

Do not make every CI run depend on live Bedrock/Open-Meteo/Location calls.

## 3. Test pyramid

```text
          Manual real-device tests
              /            \
         Web deployed E2E / smoke
            /              \
        API integration / provider contracts
           /                \
      domain/unit tests (largest)
```

## 4. Domain unit tests

### Hard guards
Required:
- notifications disabled
- low/normal/high daily cap
- daily-cap rollover in user IANA timezone, including DST boundary where applicable
- duplicate fingerprint within 5 min
- fingerprint after dedup window
- same trigger+anchor within 30 min for fallback-window triggers
- fallback-window trigger after its window
- STEP_GOAL_REST with the same anchor after 30 min but before local midnight
- STEP_GOAL_REST release at the next local midnight, including 23/25-hour days
- date rollover

### Trigger detectors

#### Upcoming event transit
- event with location and sufficient time
- event with no location
- all-day event
- event already started
- transit provider unavailable
- route duration puts user near departure threshold

#### Step goal
- below goal
- exactly at goal
- above goal
- previously notified same day, including more than 30 minutes earlier
- next local-day anchor after a prior-day notification
- steps unavailable/low confidence

#### Free time
- useful gap
- gap too small
- next event location requires travel buffer
- no nearby place results

#### Weather adaptation
- rain condition
- no relevant weather issue
- weather provider unavailable
- simulated time outside usable weather window

#### Early arrival
- early with useful buffer
- not early
- close to event start
- no destination coordinates
- place candidate exceeds time budget

## 5. Deterministic clock

Never use `new Date()` deep inside domain logic.

Inject:
```ts
interface Clock {
  now(): Date;
}
```

Production:
`SystemClock`.

Tests:
`FixedClock`.

This is essential for:
- calendar gaps,
- departure thresholds,
- TTL,
- scenario mode,
- daily notification cap.

## 6. Provider tests

Each adapter must have mapping tests.

### Amazon Location Places
Test:
- request uses `[longitude, latitude]` in provider API where required.
- radius = 1000 default.
- MaxResults cap.
- category filter omitted by default.
- candidate SearchNearby uses `SingleUse` and is not persisted.
- selected place calls `GetPlace` with `Storage` before persistence.
- response normalization.
- throttling/error mapping.

### Amazon Location Geocoding
Test:
- event location text -> Geocode request.
- bias position mapping.
- `[longitude, latitude]` provider ordering.
- ambiguous/empty result maps to a candidate exclusion, not a fabricated coordinate.
- transient request uses `SingleUse`.

### Amazon Location Routes
Test:
- Transit request.
- Intermodal request.
- no-coverage/empty route.
- normalized duration/departure/arrival/transfers.
- notices preserved.

### Open-Meteo
Test:
- coordinate mapping.
- timezone handling.
- current and daily/hourly normalization.
- partial response.
- network timeout.

### Bedrock
Test:
- correct system/user context shape.
- output schema validation.
- invalid output repair path.
- `silent` decision.
- max 3 recommendation enforcement.
- place ID hallucination guard: reject output referencing unknown provider IDs.

## 7. API contract tests

Test Zod schemas for:
- valid real + `deliveryMode=proactive`.
- valid simulation + `deliveryMode=preview`.
- invalid coordinates.
- invalid event end before start.
- >100 calendar events.
- event ID >128 chars.
- title/location >200 chars.
- >20 interests or interest >64 chars.
- negative steps and >200,000 steps.
- step goal outside 1..200,000.
- chat message 0 or >1,000 chars.
- invalid IANA timezone.
- unknown enum.

Handler integration:
- authenticated user context.
- ownership.
- DynamoDB repository calls.
- provider partial failure.
- hard guard response.
- successful recommendation.

## 8. DynamoDB repository tests

At minimum:
- correct keys.
- state update.
- notification counter atomic semantics using user-local date.
- atomic per-trigger anchor semantics with resolved timezone; same-day step-goal
  delivery is reserved once under concurrency and released at local midnight.
- bounded-anchor pruning/retention preserves an active step-goal day anchor.
- TTL calculation.
- expired context filtered on read.
- recommendation + `RECOMMENDATION_REF` transactional write.
- by-ID lookup through pointer.
- recommendation ownership.
- conversation metadata + chat TTL.
- device token rotation.

Use local/unit repository abstractions or mocked DynamoDB client in CI; a deployed dev integration test validates real IAM/table behavior.

## 9. CDK tests

Assertions:
- S3 public access blocked.
- CloudFront distribution exists.
- OAC configured.
- DynamoDB TTL configured.
- API Gateway HTTP API exists.
- JWT authorizer exists.
- Lambda runtime is expected Node runtime.
- no overly broad `*` IAM actions unless explicitly justified.
- dev/prod names are parameterized.

## 10. Scenario preview tests

Required:
- same repeated scenario in preview still produces content evaluation;
- response reports `wouldSuppress=true` and duplicate guard codes when applicable;
- preview does not increment daily notification count;
- preview does not send remote/local notifications;
- proactive mode still enforces the actual guard.

## 11. Web UI tests

Component:
- map click updates location fields.
- direct coordinate input updates marker.
- add/remove calendar events.
- load predefined scenario.
- provider statuses render.
- recommendation cards max 3.
- loading/error state.

Playwright:
1. open Scenario Console.
2. authenticate using CI-safe test user in dev.
3. load a fixture.
4. Run Scenario.
5. verify evaluation result panel.
6. verify API error presentation.

For prod public smoke, avoid destructive account assumptions.

## 12. Mobile tests

Unit:
- context collector combines sources.
- permission-denied state.
- calendar field minimization.
- step-source selection.
- response renders.
- local notification dedup by recommendation ID.

Manual real-device matrix:

The owner's 2026-10-03 environment cannot attach an iPhone. Local iOS Simulator compilation is
available; follow [Simulator and member hardware checklist](MOBILE_VALIDATION.md) and keep actual
hardware results separate. Simulated location and unavailable sensors do not close the real-device gate.

| Capability | iOS | Android |
|---|---:|---:|
| Cognito login | required | required |
| foreground GPS | required | required |
| calendar read | required | required |
| local notification | required | required |
| background location | verify | verify |
| today's steps | verify | verify Health Connect |
| deep link/map action | verify | verify |

## 13. Scenario fixtures

Put canonical fixtures under:
```text
packages/test-fixtures/scenarios/
```

Required:
- `upcoming-transit.json`
- `step-goal.json`
- `free-time.json`
- `weather-adaptation.json`
- `early-arrival.json`

Fixtures define context and mocked provider responses, not hard-coded final AI prose.

Each fixture must have assertions for:
- detector type
- provider needs
- guard outcome
- maximum recommendation count
- key signals used

## 14. Live integration tests

Run against dev after deployment.

### Required smoke
- `GET /health`
- login/get token
- `GET /me`
- `POST /context/evaluate` with scenario input
- confirm non-5xx
- confirm schema
- confirm DynamoDB writes

### Optional live provider smoke
- known Japan coordinate Places query
- Open-Meteo query
- transit route known to have coverage
- Bedrock one small structured output request

Use a dedicated test user and avoid excessive paid calls.

The dev OIDC smoke additionally sends two owned chat probes with synthetic markers, requiring a
validated 200 response and a 400 `VALIDATION_ERROR` with distinct application request IDs. It reads
the exact dev API log group in an unfiltered, immutable start/end window with bounded complete
pagination, checks strict structured request fields, correlates both chat records and scans all raw
messages in memory for the two markers and three transient access tokens. Missing/cyclic/truncated
pages or evidence fail closed. Only fixed results are printed. Passing proves these specific needles
were absent from the fetched window; it is not proof that every possible private field is absent,
that CloudWatch metrics were materialized, or that an OS notification arrived.


## 15. CI gates

### PR gate
Must pass:
- format/lint
- typecheck
- unit
- build
- CDK synth
- CDK assertion tests

Then deploy dev and run smoke tests.

### Main gate
Must pass all PR checks before prod deploy.

After prod deploy:
- public Web returns 200
- `/health` returns 200
- Scenario Console static assets load

If smoke fails:
- workflow fails visibly.
- do not claim successful deployment.

## 16. Non-deterministic AI testing

Never assert exact prose.

Assert structure:
- `decision` enum valid.
- message exists iff notify where required.
- recommendations <= 3.
- used signals are from enum.
- referenced place IDs exist in supplied candidates.
- no unsupported action type.

Prompt regression:
keep a small golden set and evaluate manually/dev, not as a brittle exact-text unit test.

## 17. Performance checks

Record:
- hard-guard-only latency.
- provider latencies.
- Bedrock latency.
- overall evaluation latency.

Do not optimize prematurely, but ensure no accidentally sequential provider calls when they can run in parallel.

## 18. Security checks

Automated/basic:
- secret scanning.
- no `.env` committed.
- no public S3.
- no wildcard prod deploy trust from arbitrary branches.
- API protected by JWT except explicitly documented routes.

Manual:
- another user cannot read recommendation by ID.
- expired token rejected.
- demo account cannot obtain AWS IAM credentials beyond intended application behavior.

## 19. Release checklist

Before submission:
- all five fixtures pass.
- prod Web incognito test.
- judge/demo login test.
- one real Bedrock scenario.
- one provider-degradation scenario.
- mobile foreground GPS/calendar test.
- CloudWatch logs visible.
- no secrets in git history.
- agent connection proof stored.
