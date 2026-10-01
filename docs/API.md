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
  preferencesOverride?: Partial<UserPreferences>;
};
```

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
          "transfers": 1
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

Response: HTTP 200 with `{ "requestId": "req_...", "data": { "registered": true } }`. Deleting a device returns HTTP 204 without a body.

## 12. DELETE /devices/{deviceId}

Auth: yes

Removes push delivery registration.

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
| 409 | idempotency conflict where applicable |
| 429 | throttled |
| 500 | unexpected internal failure |
| 502 | critical upstream failure |
| 503 | temporarily unavailable |

Provider degradation that can still produce a valid evaluation should remain HTTP 200 with `providerStatus`.

## 18. Versioning

All public routes start with `/v1`.

Breaking contract changes require `/v2` or an explicitly coordinated migration.

Shared `packages/contracts` is the canonical schema implementation for v1.
