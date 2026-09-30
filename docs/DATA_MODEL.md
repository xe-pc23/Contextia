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

### Recommendation ID pointer
```text
PK = USER#{userId}
SK = RECOMMENDATION_REF#{recommendationId}
```

The pointer stores `targetSK` for the timestamp-sortable recommendation item. This resolves `/recommendations/{recommendationId}` without a GSI.

### Conversation metadata
```text
PK = RECOMMENDATION#{recommendationId}
SK = CONVERSATION
```

### Conversation messages
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

`notificationDay` is the user's local calendar date computed from `PROFILE.preferences.timezone` (IANA timezone), not UTC.

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
  "expiresAt": 1790831400,
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
    "placesPersistenceIntent": "storage"
  },
  "createdAt": "...",
  "updatedAt": "...",
  "schemaVersion": 1
}
```

Important:
- avoid storing full Amazon Location raw objects.
- SearchNearby candidate lists are transient (`SingleUse`) and are not stored.
- for every selected place that will appear in persisted recommendation history, call Places V2 `GetPlace` with `IntendedUse=Storage` before writing the recommendation.
- persist only normalized minimal fields from that Storage-intent response.
- keep dedup summary concise.

Retention:
- recommendation metadata may be longer than 24h if useful.
- MVP default: 7 days, configurable.
- if privacy posture prefers less, reduce to 24h.

For the hackathon, recommended:
```text
RECOMMENDATION_TTL_DAYS=7
```

### Recommendation pointer item

Write transactionally with the recommendation:

```json
{
  "PK": "USER#abc",
  "SK": "RECOMMENDATION_REF#rec_123",
  "entityType": "RecommendationRef",
  "recommendationId": "rec_123",
  "targetSK": "RECOMMENDATION#2026-09-30T05:10:04.000Z#rec_123",
  "expiresAt": 1791349804,
  "createdAt": "2026-09-30T05:10:04.000Z",
  "updatedAt": "2026-09-30T05:10:04.000Z",
  "schemaVersion": 1
}
```

The example `expiresAt=1791349804` is `2026-10-07T05:10:04Z`, exactly 7 days after creation.

Pointer and recommendation share the same logical expiry. Use `TransactWriteItems` so a pointer is not created without its target.

## 8. CONVERSATION and CHAT items

One recommendation owns at most one short-lived conversation.

Conversation metadata:
```json
{
  "PK": "RECOMMENDATION#rec_123",
  "SK": "CONVERSATION",
  "entityType": "Conversation",
  "conversationId": "conv_123",
  "userId": "abc",
  "turnCount": 1,
  "expiresAt": 1790752800,
  "createdAt": "2026-09-30T05:20:00Z",
  "updatedAt": "2026-09-30T05:20:00Z",
  "schemaVersion": 1
}
```

### Chat message

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
  "expiresAt": 1790752800,
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
  "expiresAt": 1790758800,
  "createdAt": "2026-09-30T08:00:00Z",
  "updatedAt": "2026-09-30T08:00:00Z",
  "schemaVersion": 1
}
```

The example `expiresAt=1790758800` is `2026-09-30T09:00:00Z`, exactly one hour after creation.

TTL:
- 1 hour is sufficient.

## 11. Access patterns and indexes

v1 requires **no GSI**.

| Access pattern | Key strategy |
|---|---|
| list recent recommendations | `PK=USER#id`, `begins_with(SK, "RECOMMENDATION#")`, descending |
| get recommendation by ID | get `RECOMMENDATION_REF#id`, then get `targetSK` |
| get conversation | `PK=RECOMMENDATION#id`, `SK=CONVERSATION` |
| list chat messages | same PK, `begins_with(SK, "CHAT#")` |
| get profile/state | direct GetItem |

If later requirements need a global recommendation lookup without authenticated user context, add a GSI deliberately. The current API always has the authenticated user ID, so a pointer item is sufficient.

## 12. Atomicity / concurrency

Daily notification count and anchor updates must be concurrency-safe and use the user's local date.

Recommendation + recommendation-pointer writes must also be atomic.

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
| Raw Amazon Location response | no | never persisted; selected normalized Place data comes from Storage-intent GetPlace |
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
