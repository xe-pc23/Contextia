# DATA_MODEL.md — DynamoDB & Persistence Model

## 1. Strategy

Use **one DynamoDB table per environment** with a single-table access pattern.

Goals:
- minimal infrastructure,
- efficient user-scoped queries,
- short-lived context,
- recommendation history,
- duplicate suppression,
- short-lived chat,
- device registrations.

Capacity mode:
- on-demand.

TTL attribute:
- `expiresAt` as Unix epoch seconds.

Important: TTL is not an exact deletion scheduler. Application reads must ignore logically expired items.

## 2. Common attributes

```ts
type BaseItem = {
  PK: string;
  SK: string;
  entityType: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: number;
  schemaVersion: 1;
};
```

Do not store secrets in plaintext fields that are printed by logs.

## 3. Key scheme

### User profile
```text
PK = USER#{userId}
SK = PROFILE
```

### Current user state
```text
PK = USER#{userId}
SK = STATE
```

### Context snapshots
```text
PK = USER#{userId}
SK = CONTEXT#{timestamp}#{evaluationId}
```

### Recommendation
```text
PK = USER#{userId}
SK = RECOMMENDATION#{timestamp}#{recommendationId}
```

### Conversation metadata/messages
```text
PK = RECOMMENDATION#{recommendationId}
SK = CHAT#{timestamp}#{messageId}
```

### Device token
```text
PK = USER#{userId}
SK = DEVICE#{deviceId}
```

### Idempotency
```text
PK = IDEMPOTENCY#{userId}
SK = KEY#{idempotencyKey}
```

## 4. PROFILE item

Example:
```json
{
  "PK": "USER#abc",
  "SK": "PROFILE",
  "entityType": "UserProfile",
  "preferences": {
    "interests": ["cafe", "museum"],
    "stepGoal": 10000,
    "notificationFrequency": "normal",
    "notificationsEnabled": true,
    "locale": "ja-JP",
    "timezone": "Asia/Tokyo"
  },
  "createdAt": "2026-09-30T00:00:00Z",
  "updatedAt": "2026-09-30T01:00:00Z",
  "schemaVersion": 1
}
```

Retention:
- until user deletion/account cleanup.

## 5. STATE item

Purpose:
- fast duplicate checks,
- daily notification count,
- latest context reference,
- recent trigger anchors.

Example:
```json
{
  "PK": "USER#abc",
  "SK": "STATE",
  "entityType": "UserState",
  "notificationDay": "2026-09-30",
  "notificationsSentToday": 2,
  "latestContextAt": "2026-09-30T05:10:00Z",
  "latestContextFingerprint": "sha256:...",
  "latestRecommendationAt": "2026-09-30T04:30:00Z",
  "recentAnchors": {
    "UPCOMING_EVENT_TRANSIT#event-123": "2026-09-30T04:30:00Z",
    "STEP_GOAL_REST#2026-09-30": "2026-09-30T03:00:00Z"
  },
  "createdAt": "...",
  "updatedAt": "...",
  "schemaVersion": 1
}
```

Keep `recentAnchors` bounded. If it starts growing, move to separate TTL items.

## 6. CONTEXT item

Store the normalized minimum needed for debugging/recommendation continuity.

Example:
```json
{
  "PK": "USER#abc",
  "SK": "CONTEXT#2026-09-30T05:10:00.000Z#eval_123",
  "entityType": "ContextSnapshot",
  "evaluationId": "eval_123",
  "mode": "real",
  "capturedAt": "2026-09-30T05:10:00.000Z",
  "location": {
    "latitude": 35.6812,
    "longitude": 139.7671,
    "accuracyMeters": 15
  },
  "activity": {
    "stepsToday": 10432,
    "confidence": "high"
  },
  "calendar": [
    {
      "id": "hashed-client-event-id",
      "title": "Meeting",
      "startAt": "...",
      "endAt": "...",
      "location": "Tokyo Station"
    }
  ],
  "expiresAt": 1790754600,
  "createdAt": "...",
  "updatedAt": "...",
  "schemaVersion": 1
}
```

TTL:
- logical expiration = created/captured time + 24 hours.

Application must filter:
```text
expiresAt > nowEpochSeconds
```

Privacy:
- never store attendees, descriptions, email addresses, meeting URLs.
- never persist an unbounded location timeline beyond the TTL window.

## 7. RECOMMENDATION item

Example:
```json
{
  "PK": "USER#abc",
  "SK": "RECOMMENDATION#2026-09-30T05:10:04.000Z#rec_123",
  "entityType": "Recommendation",
  "recommendationId": "rec_123",
  "evaluationId": "eval_123",
  "triggerType": "STEP_GOAL_REST",
  "decision": "notify",
  "message": "かなり歩いているので、少し休憩するのはどう？",
  "summaryForDedup": "Step goal reached; suggested a nearby quiet rest option.",
  "usedSignals": ["steps", "location", "places"],
  "items": [
    {
      "title": "Nearby cafe",
      "reason": "...",
      "actionType": "MAP"
    }
  ],
  "providerRefs": {
    "placesPersistenceIntent": "single-use"
  },
  "createdAt": "...",
  "updatedAt": "...",
  "schemaVersion": 1
}
```

Important:
- avoid storing full Amazon Location raw objects.
- if provider-returned fields are intentionally persisted, call Places with storage intent required by service terms.
- keep dedup summary concise.

Retention:
- recommendation metadata may be longer than 24h if useful.
- MVP default: 7 days, configurable.
- if privacy posture prefers less, reduce to 24h.

For the hackathon, recommended:
```text
RECOMMENDATION_TTL_DAYS=7
```

## 8. CHAT items

Short-lived recommendation-scoped chat.

Example:
```json
{
  "PK": "RECOMMENDATION#rec_123",
  "SK": "CHAT#2026-09-30T05:20:00.000Z#msg_1",
  "entityType": "ChatMessage",
  "userId": "abc",
  "role": "user",
  "content": "もっと静かな場所はある？",
  "expiresAt": 1790673600,
  "createdAt": "...",
  "updatedAt": "...",
  "schemaVersion": 1
}
```

TTL:
- 2 hours after last relevant session/message, or a fixed 2-hour TTL per item.
- no permanent chat history.

## 9. DEVICE item

Example:
```json
{
  "PK": "USER#abc",
  "SK": "DEVICE#device_123",
  "entityType": "Device",
  "platform": "ios",
  "provider": "expo",
  "token": "<sensitive-token>",
  "enabled": true,
  "lastSeenAt": "...",
  "createdAt": "...",
  "updatedAt": "...",
  "schemaVersion": 1
}
```

Rules:
- do not log token.
- overwrite/rotate tokens.
- delete on logout if user requests.
- SNS endpoint ARN may be stored instead of raw native token after registration.

## 10. IDEMPOTENCY item

Example:
```json
{
  "PK": "IDEMPOTENCY#abc",
  "SK": "KEY#550e8400-e29b-41d4-a716-446655440000",
  "entityType": "Idempotency",
  "requestHash": "sha256:...",
  "responsePointer": "eval_123",
  "expiresAt": 1790668800,
  "createdAt": "...",
  "updatedAt": "...",
  "schemaVersion": 1
}
```

TTL:
- 1 hour is sufficient.

## 11. Indexes

Start with **no GSI** unless a concrete access pattern requires one.

Required queries are naturally partitioned by user.

Potential later GSI:
```text
GSI1PK = RECOMMENDATION#{recommendationId}
GSI1SK = USER#{userId}
```

But prefer including a recommendation-owner lookup mapping only if needed. Do not add GSIs speculatively.

## 12. Atomicity / concurrency

Daily notification count and anchor updates must be concurrency-safe.

Use DynamoDB:
- conditional update
- atomic increment
- condition on current cap where possible

Example conceptual update:
```text
SET notificationsSentToday = if_not_exists(notificationsSentToday, 0) + 1
CONDITION notificationsSentToday < maxAllowed
```

Handle date rollover explicitly.

## 13. Data minimization table

| Data | Stored? | Retention |
|---|---:|---|
| Cognito identity | yes | account lifetime |
| Preferences | yes | account lifetime |
| Exact location context | yes | 24h logical TTL |
| Calendar title/time/location | yes in short context | 24h |
| Calendar attendees/emails | no | never |
| Raw Amazon Location response | no by default | request only |
| Weather raw response | no by default | request only |
| Recommendation summary | yes | 7d default |
| Short chat | yes | ~2h |
| Notification token | yes | while device registered |
| Bedrock chain-of-thought | no | never |

## 14. Deletion / account cleanup

Provide an application service to:
- delete profile,
- delete state,
- delete contexts,
- delete recommendations,
- delete devices,
- remove Cognito user if account deletion is implemented.

MVP UI for deletion is optional, but repository abstraction must not make cleanup impossible.
