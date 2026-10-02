# API.md — HTTP API Contract

## 1. Conventions

Base:
```text
https://{api-host}/v1
```

Content-Type:
```text
application/json
```

Authentication:
```text
Authorization: Bearer <Cognito access token>
```

All time values:
- RFC 3339 / ISO 8601 with offset when known.
- Server stores canonical UTC timestamps plus timezone when needed.
- Scenario input should preserve the scenario's intended offset/timezone.

All IDs are opaque strings.

All request bodies are runtime-validated with Zod.

`POST /v1/context/evaluate` also accepts `X-Contextia-Demo-Fault: weather|routes` only in `dev`,
with the verified Web app client and simulation/preview input. The chosen provider returns
`unavailable` / `DEMO_FORCED_UNAVAILABLE` only if candidate generation requests it. Other providers
and delivery guards are unchanged. Production or Mobile requests containing this header return 403;
unknown selectors return 400 in the dev Web path. The selector is part of the idempotency request hash,
so a key cannot replay a different fault condition. No-fault hashes remain compatible with older rows.

The implementation is `packages/contracts/src`. Object schemas reject unknown fields; clients must project calendar data to the allowed fields before sending it. Timestamp validation requires an offset (`Z` or `±HH:MM`) and rejects invalid calendar dates. URL actions permit only HTTP(S).

### 1.1 Canonical enums

```ts
type SignalName =
  | "time"
  | "location"
  | "calendar"
  | "steps"
  | "weather"
  | "places"
  | "transit"
  | "preferences";

type TriggerType =
  | "UPCOMING_EVENT_TRANSIT"
  | "STEP_GOAL_REST"
  | "FREE_TIME_NEARBY"
  | "WEATHER_ADAPTATION"
  | "EARLY_ARRIVAL_DETOUR";

type DeliveryMode = "proactive" | "preview";
```

### 1.2 Input limits

These are part of the v1 API contract and must be implemented in Zod.

| Field | Limit |
|---|---|
| calendar events | max 100 |
| event `id` | 1–128 chars |
| event `title` | 1–200 chars |
| event `location` | 0–200 chars |
| interests | max 20 |
| interest value | 1–64 chars |
| locale | 2–35 chars |
| timezone | 1–64 chars, valid IANA timezone |
| `stepsToday` | integer 0–200,000 |
| `stepGoal` | integer 1–200,000 |
| accuracy | 0–100,000 m |
| chat message | 1–1,000 chars |

For each event:
- `endAt >= startAt`;
- non-all-day event duration should not exceed 31 days;
- invalid timestamps are rejected.

## 2. Standard envelope

Successful responses generally use:
```json
{
  "requestId": "req_...",
  "data": {}
}
```

Errors:
```json
{
  "requestId": "req_...",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request body is invalid.",
    "details": [
      {
        "path": "context.location.latitude",
        "message": "Expected number between -90 and 90."
      }
    ]
  }
}
```

## 3. Core types

### GeoPoint
```ts
type GeoPoint = {
  latitude: number;   // -90..90
  longitude: number;  // -180..180
};
```

### LocationContext
```ts
type LocationContext = GeoPoint & {
  accuracyMeters?: number;
  capturedAt: string;
  source: "gps" | "scenario";
};
```

### CalendarEventContext
```ts
type CalendarEventContext = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  location?: string | null;
  allDay?: boolean;
};
```

### ActivityContext
```ts
type ActivityContext = {
  stepsToday?: number | null;
  stepGoal?: number | null;
  stepGoalReached?: boolean;
  stepSource?: "ios-pedometer" | "android-health-connect" | "foreground-sensor" | "scenario";
  confidence?: "high" | "medium" | "low";
};
```

### UserPreferences
```ts
type UserPreferences = {
  interests: string[];
  stepGoal: number;
  notificationFrequency: "low" | "normal" | "high";
  notificationsEnabled: boolean;
  locale: string;
  timezone: string;
};
```

### ContextInput
```ts
type ContextInput = {
  mode: "real" | "simulation";
  deliveryMode: "proactive" | "preview";
  capturedAt: string;
  scenarioTime?: string;
  location: LocationContext;
  activity?: ActivityContext;
  calendar: CalendarEventContext[];
  calendarStatus?: "granted" | "denied" | "unavailable";
  preferencesOverride?: Partial<UserPreferences>;
};
```

Updated Mobile clients always send `calendarStatus`. `denied` and `unavailable` require
an empty `calendar` and exclude calendar-dependent candidates before provider or model calls.
A granted empty calendar remains valid free-time evidence. Omission is accepted for older clients
and retains their previous granted-calendar semantics. Preview normalized context includes the status
only when the request supplied it.

Allowed production combinations:
- `mode="real"` + `deliveryMode="proactive"`
- `mode="simulation"` + `deliveryMode="preview"`

Other combinations are rejected. The backend also validates that simulation/preview requests originate from the configured Scenario Console/demo authorization context; `preview` is not a generic bypass for mobile proactive delivery.

## 4. GET /health

Auth: no

Purpose:
- deployment/liveness smoke check.
- no dependency-heavy checks.

Response:
```json
{
  "status": "ok",
  "version": "git-sha-or-build-id"
}
```

Do not expose secrets/configuration.

## 5. GET /me

Auth: yes

Returns current profile/preferences.

Response:
```json
{
  "requestId": "req_123",
  "data": {
    "userId": "usr_...",
    "preferences": {
      "interests": ["cafe", "museum"],
      "stepGoal": 10000,
      "notificationFrequency": "normal",
      "notificationsEnabled": true,
      "locale": "ja-JP",
      "timezone": "Asia/Tokyo"
    }
  }
}
```

## 6. PUT /me/preferences

Initial profile creation may send `If-None-Match: *`. The repository uses an atomic absent-profile
condition; an existing profile returns `412 PROFILE_EXISTS` without overwriting preferences.
Clients then read `GET /me` to display the winning profile. Omission keeps the ordinary authenticated
preference update behavior. Other header values return 400. Web and Mobile initialize only after
an explicit `404 PROFILE_NOT_FOUND`, never after authorization, network or validation errors.

Auth: yes

Request:
```json
{
  "interests": ["cafe", "museum", "park"],
  "stepGoal": 10000,
  "notificationFrequency": "normal",
  "notificationsEnabled": true,
  "locale": "ja-JP",
  "timezone": "Asia/Tokyo"
}
```

Response:
```json
{
  "requestId": "req_123",
  "data": {
    "updated": true
  }
}
```

## 7. POST /context/evaluate

Auth: yes

Primary endpoint for both:
- mobile real context
- Web Scenario Console simulation

Request:
```json
{
  "mode": "simulation",
  "deliveryMode": "preview",
  "capturedAt": "2026-09-30T14:10:00+09:00",
  "scenarioTime": "2026-09-30T14:10:00+09:00",
  "location": {
    "latitude": 35.681236,
    "longitude": 139.767125,
    "accuracyMeters": 10,
    "capturedAt": "2026-09-30T14:10:00+09:00",
    "source": "scenario"
  },
  "activity": {
    "stepsToday": 10432,
    "stepGoal": 10000,
    "stepGoalReached": true,
    "stepSource": "scenario",
    "confidence": "high"
  },
  "calendar": [
    {
      "id": "scenario-event-1",
      "title": "Meeting",
      "startAt": "2026-09-30T16:00:00+09:00",
      "endAt": "2026-09-30T17:00:00+09:00",
      "location": "Tokyo Station",
      "allDay": false
    }
  ],
  "preferencesOverride": {
    "interests": ["cafe", "museum"]
  }
}
```

### Response — notify

```json
{
  "requestId": "req_123",
  "data": {
    "evaluationId": "eval_123",
    "recommendationId": "rec_123",
    "decision": "notify",
    "decisionReason": "The upcoming event and route duration make a departure reminder useful.",
    "triggerType": "UPCOMING_EVENT_TRANSIT",
    "urgency": "medium",
    "message": "16時の予定に向けて、そろそろ移動を意識すると安心です。",
    "recommendations": [
      {
        "id": "rec_item_1",
        "title": "公共交通で東京駅へ移動",
        "reason": "現在地からの移動時間と予定開始時刻を考慮しています。",
        "place": null,
        "route": {
          "mode": "transit",
          "durationMinutes": 34,
          "departAt": "2026-09-30T15:10:00+09:00",
          "arriveAt": "2026-09-30T15:44:00+09:00",
          "transfers": 1,
          "attributions": [{
            "type": "Disclaimer",
            "text": "Transit terms",
            "url": "https://example.com/terms"
          }]
        },
        "action": {
          "type": "TRANSIT",
          "url": null
        }
      }
    ],
    "usedSignals": [
      "time",
      "location",
      "calendar",
      "transit"
    ],
    "delivery": {
      "mode": "preview",
      "status": "preview",
      "wouldSuppress": false,
      "guardCodes": []
    },
    "providerStatus": {
      "geocoding": {"status": "ok", "latencyMs": 73},
      "places": {"status": "not_requested"},
      "weather": {"status": "ok", "latencyMs": 91},
      "routes": {"status": "ok", "latencyMs": 182},
      "bedrock": {"status": "ok", "latencyMs": 1320}
    },
    "contextExpiresAt": "2026-10-01T14:10:00+09:00"
  }
}
```

`recommendationId` is the stable key used by recommendation-detail and follow-up-chat routes.

New evaluations also return `weather`, a nullable normalized reading with `source="current"|"forecast"`,
`sourceTimestamp`, condition, nullable temperature and precipitation values. Forecast readings include
`startAt`/`endAt` and only apply within that interval. The value is null when guards skip providers or
the provider has no valid reading for the evaluation time; it is never a fabricated observation.

Preview responses include `normalizedContext`: `mode`, `evaluationAt`, resolved `timezone` and `stepGoal`,
permitted location/activity/calendar fields, and effective preferences after authorized overrides.
It excludes provider candidate payloads and is not included in real/proactive responses. Both fields are
optional in the response schema during rollout to preserve older cached idempotency responses.

`delivery.status` is `preview` in preview mode. In proactive mode it is `ready` when the result is returned for the designated client delivery path, `sent` only after an explicit server notification provider accepts it, `failed` if that server send fails, or `suppressed` for a silent result. `sent` does not claim the OS displayed the notification. This field never authorizes a second delivery path. `wouldSuppress` is true exactly when `guardCodes` is non-empty. A proactive `notify` result must pass the delivery guards; preview can return `notify` with suppression diagnostics.

### Response — silent

```json
{
  "requestId": "req_123",
  "data": {
    "evaluationId": "eval_123",
    "recommendationId": null,
    "decision": "silent",
    "decisionReason": "No candidate is useful enough to interrupt the user.",
    "triggerType": null,
    "urgency": null,
    "message": null,
    "recommendations": [],
    "usedSignals": [],
    "delivery": {
      "mode": "proactive",
      "status": "suppressed",
      "wouldSuppress": true,
      "guardCodes": ["DUPLICATE_CONTEXT"]
    },
    "providerStatus": {
      "geocoding": {"status": "not_requested"},
      "places": {"status": "not_requested"},
      "weather": {"status": "not_requested"},
      "routes": {"status": "not_requested"},
      "bedrock": {"status": "not_requested"}
    },
    "contextExpiresAt": "2026-10-01T14:10:00+09:00"
  }
}
```

### Guard codes
Machine-readable:
- `NOTIFICATIONS_DISABLED`
- `DAILY_CAP_REACHED`
- `DUPLICATE_CONTEXT`
- `RECENT_SAME_TRIGGER`
- `NO_CANDIDATE`
- `NO_MEANINGFUL_OPPORTUNITY`

Candidate-level diagnostic codes (not global hard guards) include:
- `MISSING_REQUIRED_SIGNAL`
- `PROVIDER_UNAVAILABLE`
- `GEOCODE_AMBIGUOUS`

Do not expose internal AI chain-of-thought as guard/reason text.

### Phase 1 delivery-guard integration

`@contextia/domain` exports `evaluateDeliveryGuards`, `defaultDeliveryPolicy`,
`Clock`, `resolveTimezone`, and `localDate`. Contracts additionally export
`DeliveryGuardCodeSchema` / `DeliveryGuardCode`, the four delivery-only codes.
The HTTP request/response shape is unchanged.

- Supply authenticated notification preferences, `profileTimezone`, the validated
  authenticated `clientTimezone` fallback, a server `Clock`, `contextFingerprint`,
  and an optional normalized `DeliveryGuardState`. The timezone fallback is
  profile → client → UTC. Standard `Intl.DateTimeFormat` uses the runtime's
  ICU/IANA timezone database for local dates and DST without a fixed offset.
- Default policy is low=1 / normal=3 / high=6 per local day, a 300-second context
  window, and an 1800-second fallback trigger/anchor window. `DeliveryPolicy`
  additionally requires `anchorDedupByTrigger`, a
  `Readonly<Partial<Record<TriggerType, number | "local-day">>>`; its default is
  `{ STEP_GOAL_REST: "local-day" }`. Other triggers use the fallback unless given
  an override. Numeric windows use seconds: an age strictly below the window
  suppresses; exactly at the boundary does not. A complete policy may be
  injected. Future persisted times remain suppressed after clock rollback.
  Invalid clocks, persisted calendar dates, counts, or matching-fingerprint times
  fail safely instead of authorizing delivery.
- Under `"local-day"`, an exactly matching trigger/anchor whose `notifiedAt`
  falls on the current server `notificationDay` in the resolved timezone produces
  `RECENT_SAME_TRIGGER`, including more than 30 minutes after delivery. It clears
  at the next local midnight. Compare calendar dates rather than elapsed 24 hours
  so 23/25-hour DST days behave correctly. Future matching `notifiedAt` values
  remain suppressed; malformed matching timestamps fail closed in both modes.
  Preview uses this server-local notification day even when its simulated
  candidate anchor names a past or future date; scenario time cannot extend the
  suppression period of a previously recorded notification.
- Run guards before detection without `opportunity`, then run them with each
  candidate's `{ type, anchorKey }` before enrichment/Bedrock. Fix the server clock
  to one request-start instant so both checks use the same day and window.
  Codes are collected in notification-enabled, daily-cap, fingerprint, anchor
  order. `shouldEvaluate` is false for guarded proactive delivery and always
  true for valid preview evaluation, even when `wouldSuppress` is true.
- `notificationDay` is computed from the **server processing instant**, not
  `scenarioTime` or a client-supplied capture time. A persisted count belonging
  to a different local date does not consume today's cap. The function returns
  the resolved timezone/day/cap for the repository's atomic delivery check.
  Persisted `notificationDay` must be a real calendar date in strict `YYYY-MM-DD`
  format, validated by `CalendarDateSchema`. Malformed, missing or impossible
  dates fail closed with an exception in both proactive and preview modes;
  they cannot be interpreted as a normal rollover.
- `DeliveryGuardState.latestContextProcessedAt` must be the server instant when
  `latestContextFingerprint` was processed. Preview may record this minimal
  processing metadata so its next run diagnoses `DUPLICATE_CONTEXT`; it must not
  increment `notificationsSentToday` or append to notified `recentAnchors`.
  B/D must map or extend their state DTO/persistence to supply this instant:
  the existing `latestContext.capturedAt` can contain simulated time and is not
  a valid substitute. Read prior state before storing the current evaluation.
- B/D must pass the resolved timezone and the same per-trigger anchor policy to
  the repository's atomic proactive-delivery recheck, and retain today's notified
  step-goal anchor until the next local midnight. The current repository port's
  `anchorDedupSeconds` alone cannot express `"local-day"`; extend the port and
  persistence adapter before integrating proactive delivery. Concurrent requests
  must not bypass the day policy, and bounded-anchor pruning must not evict an
  active day anchor early. The processing-time state change remains tracked
  separately in [Issue #5](https://github.com/xe-pc23/Contextia/issues/5).
- The domain function has no persistence or notification side effects. Returned
  `delivery.status=ready` is a provisional guard result; the application must
  finalize delivery according to the model decision and atomically recheck
  guards before proactive delivery. Preview authorization stays in the API.

The Phase 1 domain tests verify these decisions without live provider calls.
Actual notification exclusivity, atomic updates and dev smoke belong to B/D
integration; domain guard success alone does not prove deployed delivery.

### Phase 1 STEP_GOAL_REST integration

`normalizeDetectorContext` accepts a schema-validated `ContextInput`,
application-normalized preferences, an injected `Clock`, and the profile/client
timezone inputs. Real evaluations use the injected clock; simulations use
`scenarioTime`, falling back to `capturedAt`. The same resolved IANA timezone
produces the candidate's local-date `anchorKey` (`YYYY-MM-DD`). The delivery
guards still use server processing time independently of this scenario time.

`stepGoalRestDetector.detect` implements the exported `TriggerDetector`
interface and returns `CandidateOpportunity[]`:

- A numeric `stepsToday >= stepGoal` produces one `STEP_GOAL_REST` candidate.
  Activity's numeric goal takes precedence; a missing/null goal falls back to
  the normalized preference goal. This rule is identical in both modes.
- Missing/null steps or steps below the goal produce no candidate. The client
  `stepGoalReached` flag cannot override numeric evidence.
- Required signals are `steps`, `location`, `time`; provider needs contain only
  `places-near-current`. Facts contain numeric steps/goal and available step
  source/confidence. Location/calendar/preferences remain in normalized context
  for the subsequent relevance evaluation.
- High/medium/low step confidence maps to candidate confidence 1/0.75/0.5;
  unspecified confidence maps to 0.75. Low confidence does not add a global
  delivery guard. No unagreed calendar-imminence threshold is introduced.
- Detection has no delivery side effects and retains the same date anchor
  throughout the evaluation day. The default delivery policy suppresses repeated
  `STEP_GOAL_REST` delivery for that exact anchor throughout the same server-local
  notification day, so real-world goal-achievement notifications occur at most
  once per local day. A new local-day anchor is eligible on the following day,
  subject to the other guards. Preview retains its candidate and reports
  `wouldSuppress=true` / `RECENT_SAME_TRIGGER` when this guard applies; it does not
  increment notification counts or record a notified anchor.

`stepGoal`, `stepGoalBelowGoal`, and `stepGoalStepsUnavailable` are exported
synthetic test fixtures. They contain inputs/enrichments, not fixed AI output.

## 8. GET /recommendations

Auth: yes

Query:
- `limit`: default 20, max 50
- `cursor`: opaque pagination token

Only non-expired/relevant history.

Response:
```json
{
  "requestId": "req_123",
  "data": {
    "items": [
      {
        "id": "rec_123",
        "createdAt": "2026-09-30T14:10:05+09:00",
        "triggerType": "STEP_GOAL_REST",
        "message": "かなり歩いているので、少し休憩するのはどう？",
        "recommendations": []
      }
    ],
    "nextCursor": null
  }
}
```

## 9. GET /recommendations/{recommendationId}

Auth: yes

Returns recommendation detail owned by current user.

Response: the standard envelope with the same complete recommendation object used in the history list (`id`, `createdAt`, `triggerType`, `message`, `recommendations`). Detail items include their reasons, place/route and action fields. Persistence keys and raw provider objects are never exposed.

Lookup semantics:
- authentication supplies `userId`;
- repository first gets `USER#{userId} / RECOMMENDATION_REF#{recommendationId}`;
- the pointer contains the timestamped recommendation SK;
- repository then gets the recommendation item;
- no GSI is required for this v1 access pattern.

404 if:
- pointer or target does not exist,
- target is expired,
- pointer belongs to another user partition.

## 10. POST /recommendations/{recommendationId}/chat

Auth: yes

Request:
```json
{
  "message": "もう少し静かな場所はある？"
}
```

Limits:
- max message length: 1000 chars
- exactly one short conversation per recommendation
- `conversationId` identifies the conversation metadata item owned by the recommendation
- short recommendation-scoped chat only
- server may cap total turns, initial target 8 user messages

Response:
```json
{
  "requestId": "req_123",
  "data": {
    "conversationId": "conv_123",
    "reply": "近くの候補では、こちらの公園の方が落ち着いて過ごしやすそうです。",
    "recommendations": [],
    "expiresAt": "2026-09-30T16:10:00+09:00"
  }
}
```

## 11. POST /devices

Auth: yes

Registers/updates a device notification endpoint.

Request:
```json
{
  "deviceId": "opaque-device-id",
  "platform": "ios",
  "provider": "expo",
  "token": "ExponentPushToken[...]"
}
```

Alternative:
```json
{
  "deviceId": "opaque-device-id",
  "platform": "android",
  "provider": "sns",
  "token": "<native-fcm-token>"
}
```

Security:
- never log token
- encrypt at rest through AWS defaults
- replace previous token for same logical device when rotated
- device IDs are 1–128 characters; tokens are 1–4096 characters
- only the configured Mobile Cognito client may register/delete devices

SNS registration resolves a native token to a stage-specific endpoint and reconciles its token/enabled
attributes. Endpoint ARNs remain internal storage fields. Removing a device removes the owned DynamoDB
registration; no further dispatch may claim that removed revision. The remote read is bounded to 100
devices and fails closed if DynamoDB returns a continuation key.

Response: HTTP 200 with `{ "requestId": "req_...", "data": { "registered": true } }`. Deleting a device returns HTTP 204 without a body.

## 12. DELETE /devices/{deviceId}

Auth: yes

Removes push delivery registration.

### Immutable delivery path

| Evaluation | Result status | Delivery |
|---|---|---|
| Scenario preview | `preview` | No notification or quota increment |
| Foreground Mobile | `ready` | In-app result only |
| Background Mobile | `ready` | Local notification only |
| Trusted internal server push | `sent` / `failed` | One configured remote adapter; no local fallback |
| Silent | `suppressed` | No delivery |

Public `/context/evaluate` always reserves the client path. Its body cannot choose server push.
The internal server command reserves `remote` atomically with history, ID pointer, quota and dedup
anchors. A separate owned, unexpired `reserved` → `claimed` transition checks current notification
preferences and device revision before sending. Claim/complete do not consume quota again. Client
reservations and preview/legacy pointers cannot be upgraded to remote delivery.

`sent` means provider acceptance, not OS display. A provider timeout, process crash after claim, or
completion-write failure cannot prove whether a device received the message; retries do not send
again and the client never falls back to local delivery. Quota counts reserved proactive opportunities,
including foreground `ready` results; it is separate from the actual provider-acceptance metric.

## 13. POST /demo/scenarios/{scenarioId}/load

Optional convenience endpoint.

Auth: yes under normal design.

Returns only predefined synthetic fixture input, not a fake result.

Supported initial IDs:
- `upcoming-transit`
- `step-goal`
- `free-time`
- `weather-adaptation`
- `early-arrival`

The Web client may also keep fixtures locally; backend fixture endpoint is optional.

## 14. Provider-status model

```ts
type ProviderStatusValue =
  | "ok"
  | "degraded"
  | "unavailable"
  | "timeout"
  | "error"
  | "not_requested";

type ProviderStatus = {
  status: ProviderStatusValue;
  latencyMs?: number;
  code?: string;
};

type ProviderStatusMap = {
  geocoding: ProviderStatus;
  places: ProviderStatus;
  weather: ProviderStatus;
  routes: ProviderStatus;
  bedrock: ProviderStatus;
};
```

Every evaluation response returns all five keys. Providers that were not needed use `not_requested`.

Never return raw upstream secrets/error bodies.

Internally, `ProviderResult<T>` is a discriminated union: `ok`/`degraded` have `data: T`; `unavailable`/`timeout`/`error`/`not_requested` have `data: null`. Optional `latencyMs` is non-negative and `code` is a short sanitized diagnostic label, never an upstream error message/body. Normalized place, geocoding, weather and route schemas live in contracts so test fixtures and ports share their shapes. These enrichments are transient and are not additional public HTTP endpoints.

## 15. Recommendation structured schema

Internal Bedrock decision is a discriminated union:

```ts
type NotifyDecision = {
  decision: "notify";
  decisionReason: string;
  urgency: "low" | "medium" | "high";
  message: string;
  recommendations: RecommendationItem[]; // 1..3
  usedSignals: SignalName[];
};

type SilentDecision = {
  decision: "silent";
  decisionReason: string;
  urgency: null;
  message: null;
  recommendations: [];
  usedSignals: SignalName[];
};

type RecommendationDecision = NotifyDecision | SilentDecision;

type RecommendationItem = {
  title: string;
  reason: string;
  place?: {
    provider: "amazon-location";
    placeId: string;
    name: string;
    latitude: number;
    longitude: number;
    distanceMeters?: number;
  } | null;
  route?: {
    mode: "transit" | "intermodal" | "pedestrian";
    durationMinutes: number;
    departAt?: string;
    arriveAt?: string;
    transfers?: number;
    attributions?: Array<{
      text: string;
      url?: string;
      type?: "Disclaimer" | "Tariff";
    }>;
  } | null;
  action: {
    type: "MAP" | "WEBSITE" | "TRANSIT" | "NONE";
    url?: string | null;
  };
};
```

Bedrock output must not create a `placeId` not present in provider input.

Before any selected place data is persisted, the backend performs `GetPlace` with `IntendedUse=Storage` for that selected `placeId` and uses the normalized Storage-intent result for persistence.

## 16. Idempotency and duplicate protection

Client may send:
```text
Idempotency-Key: <uuid>
```

Server stores a short-lived idempotency record for mutating evaluation requests.

The record is scoped to the authenticated user, operation and normalized request
hash. An unexpired completed key replays the same evaluation with a fresh HTTP
request ID; a different request returns `409 IDEMPOTENCY_CONFLICT`, and an active
pending claim returns `409 IDEMPOTENCY_IN_PROGRESS`. Logically expired keys are
reclaimed atomically without waiting for DynamoDB TTL deletion.

Failures before the first persistence write release only the request's pending
claim, permitting a retry with the same key. An explicitly rejected proactive
transaction also permits release. A write with an uncertain outcome keeps its
claim reserved; it must not be blindly retried and potentially delivered twice.

An evaluation superseded by a concurrent context/preference transaction returns
`409 EVALUATION_SUPERSEDED`. This is a conflict, not a transient failure to retry
automatically. The existing response/guard schemas are unchanged; no synthetic
guard code is added. Unclassified storage failures still return `503
STATE_UNAVAILABLE`.

The evaluation shares one monotonic 20-second budget across all stages, including
result persistence and idempotency completion. Exhaustion returns `503
EVALUATION_TIMEOUT`; no later pipeline stage is started. Pre-write claim cleanup
has a separate maximum two-second budget. In-flight adapter calls retain their
own bounded timeout/abort.

Additionally compute:
```text
contextFingerprint = hash(
  rounded location +
  scenarioTime bucket +
  steps bucket +
  next event key +
  mode
)
```

Exact hashing details may evolve, but the fingerprint must not contain raw PII.

## 17. HTTP status codes

| Status | Meaning |
|---|---|
| 200 | success |
| 201 | created |
| 204 | deleted/no body |
| 400 | validation error |
| 401 | missing/invalid token |
| 403 | authenticated but not authorized |
| 404 | missing/expired/not owned |
| 409 | idempotency conflict/in-progress, or superseded evaluation |
| 429 | throttled |
| 500 | unexpected internal failure |
| 502 | critical upstream failure |
| 503 | temporarily unavailable |

Provider degradation that can still produce a valid evaluation should remain HTTP 200 with `providerStatus`.

## 18. Versioning

All public routes start with `/v1`.

Breaking contract changes require `/v2` or an explicitly coordinated migration.

Shared `packages/contracts` is the canonical schema implementation for v1.
