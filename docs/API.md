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
  capturedAt: string;
  scenarioTime?: string;
  location: LocationContext;
  activity?: ActivityContext;
  calendar: CalendarEventContext[];
  preferencesOverride?: Partial<UserPreferences>;
};
```

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
    "decision": "notify",
    "triggerType": "UPCOMING_EVENT_TRANSIT",
    "message": "16時の予定に向けて、そろそろ移動を意識すると安心です。",
    "urgency": "medium",
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
      "location",
      "calendar",
      "transit"
    ],
    "providerStatus": {
      "places": "not_requested",
      "weather": "ok",
      "routes": "ok",
      "bedrock": "ok"
    },
    "expiresAt": "2026-10-01T14:10:00+09:00"
  }
}
```

### Response — silent

```json
{
  "requestId": "req_123",
  "data": {
    "evaluationId": "eval_123",
    "decision": "silent",
    "triggerType": null,
    "message": null,
    "recommendations": [],
    "usedSignals": [],
    "providerStatus": {},
    "guard": {
      "code": "NO_MEANINGFUL_OPPORTUNITY"
    }
  }
}
```

### Guard codes
Machine-readable:
- `NOTIFICATIONS_DISABLED`
- `DAILY_CAP_REACHED`
- `DUPLICATE_CONTEXT`
- `RECENT_SAME_TRIGGER`
- `MISSING_REQUIRED_SIGNAL`
- `NO_CANDIDATE`
- `NO_MEANINGFUL_OPPORTUNITY`

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

404 if:
- does not exist,
- expired,
- belongs to another user.

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
```

Never return raw upstream secrets/error bodies.

## 15. Recommendation structured schema

```ts
type RecommendationDecision = {
  decision: "notify" | "silent";
  decisionReason: string; // concise, safe summary
  urgency: "low" | "medium" | "high";
  message: string | null;
  recommendations: RecommendationItem[];
  usedSignals: SignalName[];
};

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
