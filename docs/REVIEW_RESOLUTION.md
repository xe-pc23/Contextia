# REVIEW_RESOLUTION.md — v1.0 Review → v1.1

Date: 2026-09-30

## Priority contradictions

| Review finding | v1.1 resolution |
|---|---|
| IAM role name mismatch | canonical names are `GitHubDevDeployRole` / `GitHubProdDeployRole` everywhere |
| `concierge-*` naming mismatch | technical project slug is `contextia`; stacks/resources use `contextia-{stage}-...` |
| product name TBD vs Contextia | Contextia is the working repository/product name; marketing rename remains non-blocking |
| evaluation cannot link to chat/detail | evaluation returns top-level `recommendationId` |
| by-ID lookup has no access pattern | add `RECOMMENDATION_REF#{id}` pointer in authenticated user's partition; no GSI v1 |
| silent response incompatible with schema | structured model response is a discriminated `notify`/`silent` union |
| incorrect TTL epoch examples | examples recalculated; context +24h, chat +2h, idempotency +1h |
| <8s target vs 8s Bedrock timeout | target is p50 <6s, p95 <10s; Bedrock timeout 7s; Lambda 15–20s |
| `lat/lon` mismatch | canonical API/domain names are `latitude` / `longitude` |

## Previously unresolved gaps

### Geocoding
Resolved:
- add `GeocodingProvider`.
- MVP uses Amazon Location Places V2 `Geocode`.
- nearby search remains separate.

### Places persistence
Resolved:
- SearchNearby candidate discovery uses `SingleUse`.
- candidate list remains in-memory.
- after model selects up to 3 places, server calls `GetPlace` with `IntendedUse=Storage`.
- only normalized data from Storage-intent call is persisted/reused.

### SignalName
Resolved canonical values:
```text
time
location
calendar
steps
weather
places
transit
preferences
```

### Shared judge account vs dedup
Resolved with `deliveryMode=preview`:
- real pipeline still executes;
- no notification/counter mutation;
- duplicate/cap guards are reported as `wouldSuppress`;
- no unsafe public force-bypass.

### Daily cap day
Resolved:
- user's IANA timezone from profile.
- DST-aware local day.

### ProviderNeed
Resolved values:
```text
geocode-event-location
places-near-current
places-near-destination
weather-current
weather-today
route-to-next-event
route-to-place-candidates
```

### API input limits
Resolved in API.md §1.2 and required Zod tests.

### conversationId
Resolved:
- one short conversation per recommendation.
- metadata at `PK=RECOMMENDATION#{id}`, `SK=CONVERSATION`.
- messages share the same PK.

### Root README
Added in repository root.

## Minor findings

- docs tree now includes CI/CD, decisions, review resolution, backlog, and hackathon agent log.
- DECISIONS consolidated by concern instead of repeating equivalent questionnaire answers.
- latest context is updated on both suppressed and successful evaluations.
- `MISSING_REQUIRED_SIGNAL` is a candidate exclusion, not global hard guard.
- providerStatus always contains all canonical provider keys, using `not_requested` where appropriate.
- `.gitignore` added with `.DS_Store`.
