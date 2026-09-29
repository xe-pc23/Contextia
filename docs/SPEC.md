# SPEC.md — Product & Functional Specification

## 1. Document purpose

This document is the product-level source of truth. When implementation choices conflict with this file, agents must stop expanding scope and implement the behavior described here unless a human updates the specification.

## 2. Product overview

The application is a **context-aware proactive concierge**.

Instead of waiting for a user to ask a question, the system combines:
- current location,
- upcoming calendar events,
- daily step count,
- current/local time,
- weather,
- nearby places,
- route/public-transit information,
- user preferences,

and determines whether there is a useful, timely action to suggest.

The backend must avoid invoking an LLM for every context update. It first applies deterministic hard guards and candidate detectors, then uses Amazon Bedrock only when a meaningful opportunity may exist.

## 3. Target users and geography

### 3.1 Target user
A mobile user who wants useful contextual suggestions without continuously asking an assistant for help.

### 3.2 Geographic strategy
- Architecture: global-ready.
- Primary demo quality: Japan.
- All provider integrations must expose coverage/failure states.
- No feature may silently fabricate data when a provider has no coverage.

### 3.3 Platform
- Main product: iOS + Android mobile app.
- Judge/demo client: separate web application.
- Web is **not** a browser version of the mobile app. It is a Scenario Console.

## 4. Product modes

### 4.1 Real World Mode — mobile
Uses device data:
- GPS
- Calendar
- Steps
- system time
- user preferences

Backend adds:
- weather
- places
- transit / route data

### 4.2 Simulation Mode — web
Judge can inject:
- latitude / longitude
- position by map click
- arbitrary scenario time
- step count
- multiple calendar events
- user preferences

Weather is fetched from the **real weather provider based on the simulated position**, not manually forged in v1.

The same backend evaluation pipeline must be used by both modes.

## 5. Core user stories

### US-001 — Upcoming event
As a user with an event at a physical destination, I want the system to consider current position and transit travel time so it can tell me when leaving soon becomes useful.

### US-002 — Walking milestone
As a user who has reached a walking goal, I want nearby appropriate places to be suggested if taking a break would be timely.

### US-003 — Free time
As a user with a gap between events, I want nearby options that fit the gap and my interests.

### US-004 — Weather-aware adaptation
As a user whose context is affected by rain, heat, or other conditions, I want suggestions that adapt to the weather.

### US-005 — Early arrival
As a user arriving early near the next destination, I want suggestions that fit the remaining time without risking lateness.

### US-006 — Follow-up question
As a user who received a recommendation, I want to ask a short follow-up question about that recommendation.

### US-007 — Judge-controlled scenario
As a judge, I want to set arbitrary context and execute the production backend so I can understand the system without installing a mobile app or physically moving.

## 6. Functional requirements

### FR-001 Authentication
- Cognito User Pool authentication is required for normal APIs.
- Mobile and Web use separate Cognito app clients where useful.
- API Gateway HTTP API validates JWTs.
- A pre-created production demo account is provided for judges.
- Demo credentials must never be committed to the public repository.

### FR-002 User preferences
Persist:
- interest categories
- step goal
- notification frequency
- notifications enabled/disabled

Initial notification frequency policy:
- `low`: max 1 proactive notification/day
- `normal`: max 3/day
- `high`: max 6/day

These values must be configuration, not scattered constants.

### FR-003 Location
Mobile:
- foreground location required for MVP.
- background location supported through Expo development build.
- context contains:
  - latitude
  - longitude
  - accuracy
  - capturedAt
  - optional heading/speed only if available and useful

Web:
- map click updates position.
- lat/lon may also be typed directly.
- manual values must be validated.

### FR-004 Calendar
Mobile reads a configurable multi-day window, initially:
- from start of current local day
- through end of the next 3 days

Only transmit:
- local-safe event ID hash or generated client event key
- title
- start
- end
- location text

Do not transmit:
- attendees
- attendee emails
- notes/description
- conference URLs
- attachments

### FR-005 Steps
Context sends:
- `stepsToday`
- `stepGoal`
- `stepGoalReached`

Provider strategy:
- iOS: Expo Pedometer may retrieve steps across a date range.
- Android: Health Connect is the preferred historical/aggregate source.
- Foreground-only sensor subscriptions are acceptable fallback, but must be marked as lower-confidence.
- Web simulation manually supplies the value.

### FR-006 Weather
- Fetch real current weather and same-day forecast from Open-Meteo.
- Weather is based on the context position.
- Scenario time does not rewrite meteorological history.
- If simulated time is outside useful provider forecast coverage, weather-dependent detectors become `unavailable` rather than hallucinating.

Normalized weather shape includes:
- current temperature
- feels-like temperature if available
- precipitation/current weather code
- hourly precipitation probability when available
- daily max/min
- sunrise/sunset if useful
- source timestamp

### FR-007 Nearby places
Use Amazon Location Places V2 `SearchNearby`.

Defaults:
- radius: 1,000 m
- category filter: none (all relevant POIs)
- provider result cap: 30
- language: user locale if supported

Before Bedrock:
- remove invalid/duplicate entries
- prefer open places when opening-hours data is available
- retain distance and provider IDs
- never invent ratings/reviews that the provider did not return

### FR-008 Transit / routing
Primary provider: Amazon Location Routes.

Must support:
- Transit
- Intermodal where available
- pedestrian legs
- departure/arrival-aware planning when the API supports the required request shape

Normalized route output:
- duration
- departure time
- arrival time
- legs
- transit line/mode
- transfers
- warnings/notices
- route geometry only if needed by UI

If transit coverage is unavailable:
- mark transit status `unavailable`
- continue with remaining context
- do not infer a train schedule from general knowledge

### FR-009 Candidate detectors
Detectors are plugins registered with the domain layer.

Each detector returns zero or more:
```ts
type CandidateOpportunity = {
  type: TriggerType;
  confidence: number;
  anchorKey: string;
  requiredSignals: SignalName[];
  providerNeeds: ProviderNeed[];
  facts: Record<string, unknown>;
};
```

Initial detectors:

1. `UPCOMING_EVENT_TRANSIT`
2. `STEP_GOAL_REST`
3. `FREE_TIME_NEARBY`
4. `WEATHER_ADAPTATION`
5. `EARLY_ARRIVAL_DETOUR`

Future detectors may be added without changing API contracts.

### FR-010 Hard guards
Run before Bedrock.

Mandatory guards:
- notifications disabled
- daily notification cap reached
- identical context fingerprint recently processed
- identical trigger + anchor recently notified
- missing minimum required signal for candidate
- explicitly unsupported provider coverage

Initial dedup windows:
- same context fingerprint: 5 minutes
- same trigger + same anchor: 30 minutes

Windows are configuration values.

### FR-011 Bedrock relevance decision
Bedrock receives:
- normalized current context
- candidate opportunities
- normalized provider enrichments
- user preferences
- last few recommendation summaries for semantic duplicate avoidance

Bedrock decides:
- `notify` or `silent`
- user-facing message
- up to 3 recommendations/actions
- concise decision reason (not hidden chain-of-thought)
- which signals materially affected the response

No requirement to expose model chain-of-thought.

### FR-012 Structured output
Internal model response is schema-constrained JSON whenever selected model supports Bedrock Structured Outputs.

User-facing text inside `message` / `reason` remains natural language.

If a chosen model does not support strict structured output:
1. request JSON,
2. validate with Zod,
3. retry once with a repair prompt,
4. fail gracefully if still invalid.

### FR-013 Recommendation count
Return at most 3 recommendations.

A response may contain:
- zero recommendations (`silent`)
- one recommendation
- two recommendations
- three recommendations

### FR-014 Actions
Supported action types:
- `MAP`
- `WEBSITE`
- `TRANSIT`
- `NONE`

No automatic booking or purchase in MVP.

### FR-015 Short follow-up chat
- Chat is scoped to a recommendation.
- It is not a general permanent assistant thread.
- Conversation history expires quickly (target: 2 hours).
- Backend may reuse the recommendation/context snapshot necessary to answer.
- No long-term memory inferred from chat.

### FR-016 Notifications
Architecture supports:
- local device notification
- Expo Push
- Amazon SNS push adapter

Delivery rules:
- foreground mobile request: show result in app, no duplicate push
- background mobile evaluation: local notification is preferred
- explicit server push flows may use configured remote provider
- only one delivery path may send the same recommendation ID

### FR-017 Context persistence
- Context history logical retention: 24 hours.
- `expiresAt` stored on each context item.
- Reads ignore expired records even before DynamoDB physically deletes them.
- Keep the latest state separately for fast access.

### FR-018 Recommendation history
Store enough to:
- show recent recommendations
- enforce duplicate logic
- support short follow-up chat
- demonstrate behavior

Do not persist complete raw external-provider payloads by default.

### FR-019 Provider storage intent
Amazon Location Places requests must explicitly reflect whether returned provider data will be persisted.

Default:
- transient enrichment: `SingleUse`
- flows that intentionally persist provider-returned details: `Storage`

### FR-020 Scenario Console
Must provide:
- interactive MapLibre map
- map click position
- lat/lon inputs
- scenario date/time input
- steps input
- multiple calendar event editor
- preference editor
- Run Scenario button
- loading / provider-state display
- resulting recommendation cards
- "signals used" panel
- provider degradation/errors panel
- raw normalized context toggle for judges/developers

Scenario Console must not directly call Bedrock or build fake results.

### FR-021 Dashboard mobile UI
Primary screen contains:
- current location summary
- weather
- steps progress
- next event
- latest recommendation feed
- permissions/provider health indicators when useful

### FR-022 Provider degradation
If one provider fails:
- preserve successful provider data
- include provider status
- continue evaluation when still meaningful
- never silently replace real data with fake data in real-world mode

### FR-023 Localization
- Domain/API values are locale-neutral.
- User-facing UI initially supports Japanese first.
- Provider request language is derived from user locale.
- Architecture must not make Japan-specific assumptions in core types.

## 7. Initial scenario behavior

### 7.1 Upcoming event + transit
Inputs:
- current location
- event location
- event start
- current time

Flow:
1. Geocode event location if necessary.
2. Calculate transit/intermodal route.
3. Compare latest practical departure with current time.
4. Candidate enters Bedrock.
5. Bedrock decides whether the interruption is useful.

### 7.2 Step goal + rest
Inputs:
- `stepsToday >= stepGoal`
- current location
- time/calendar context

Flow:
1. Detect goal transition or current reached state.
2. Search nearby POIs within 1 km.
3. Let Bedrock select context-appropriate rest options.
4. Prevent repeated step-goal notifications.

### 7.3 Free time
Inputs:
- no event during a useful gap
- current position
- preferences

Flow:
1. Compute available gap.
2. Search places.
3. Optionally calculate simple route time to candidates.
4. Only suggest activities that fit return/next-event constraints.

### 7.4 Weather adaptation
Inputs:
- weather condition that changes usefulness/safety
- upcoming activity/context

Examples:
- rain → indoor alternatives
- heat → indoor/rest option
- weather worsening before planned movement

Do not give medical advice.

### 7.5 Early arrival
Inputs:
- user is near destination
- arrival is significantly before event
- enough buffer remains

Flow:
1. Calculate available buffer.
2. Search destination-area POIs.
3. Filter options that preserve safety margin.
4. Bedrock selects up to 3.

## 8. Non-functional requirements

### NFR-001 Reliability
- Provider timeouts must be bounded.
- External-provider failures return a degraded response rather than hanging.
- Each request has a correlation/request ID.

### NFR-002 Latency target
For normal evaluation:
- hard guard / no-AI response: target < 1 second backend time
- provider + Bedrock: target < 8 seconds under normal service conditions

These are targets, not hard SLOs.

### NFR-003 Cost
- Do not invoke Bedrock if hard guards reject.
- Cap provider result counts.
- Avoid server polling for device context.
- Apply API Gateway throttling to demo endpoints.
- Log token/model usage metadata when exposed by SDK.

### NFR-004 Security
- TLS only.
- Cognito JWT for protected APIs.
- Least-privilege Lambda IAM.
- Private S3 origin behind CloudFront OAC.
- Location map API key restricted by action, referrer/app, and expiration.
- GitHub Actions uses OIDC, not static AWS keys.
- Secrets are stored in GitHub environment secrets / AWS Secrets Manager or SSM where appropriate.

### NFR-005 Privacy
- Calendar attendees and descriptions are never transmitted.
- Raw context is short-lived.
- Location history is not retained as a long-term timeline.
- Production logs must avoid dumping full request bodies containing private context.

### NFR-006 Observability
CloudWatch:
- structured logs
- request count
- evaluation latency
- Bedrock invocation count
- trigger type count
- notify/silent count
- provider error count
- provider latency
- structured-output validation failures

### NFR-007 Testability
- Clock is injectable.
- Providers are interfaces.
- Bedrock is behind an interface.
- Scenario fixtures must run deterministically with mock providers.
- Live smoke tests are separate from unit tests.

## 9. Out of scope for MVP

- automatic restaurant reservations
- automatic ticket purchases
- financial transactions
- long-term location history
- long-term chat memory
- full travel booking
- real-time train disruption provider beyond what route provider offers
- user-generated social reviews
- RAG/vector database unless a concrete need emerges
- arbitrary autonomous tool execution by Bedrock

## 10. Acceptance criteria

A release passes product acceptance when:
1. judge can simulate a position and event in Web.
2. backend performs real provider calls.
3. Bedrock returns schema-valid output.
4. no more than 3 options are shown.
5. used signals are visible.
6. provider failure can be demonstrated without total failure.
7. recent duplicate scenario does not spam recommendations.
8. at least one mobile device can send real location + calendar.
9. production public URL remains reachable after deployment.
