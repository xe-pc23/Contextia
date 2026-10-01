# DEMO.md — Judge Scenario Console & Demonstration Plan

## 1. Purpose

The Web Scenario Console is a first-class product demonstration surface, not a fake mock.

It exists because judges should be able to experience context-aware behavior without:
- installing a native app,
- granting phone permissions,
- physically changing location,
- walking 10,000 steps,
- waiting for a real calendar event.

The Console injects synthetic device context into the **same production backend** used by mobile.

Its delivery policy is `preview`: the evaluation/providers/Bedrock path is real, but the judge does not consume notification quota or get blocked from seeing an answer because another judge ran the same scenario seconds earlier.

### 1.1 Console status (Phase 1, lane C)

- Implemented in `apps/web`:
  - editors for coordinates (with Tokyo/Osaka Station shortcuts), scenario time with an IANA timezone, steps and goal, multiple calendar events, interests and notification preference overrides;
  - the step-goal preset;
  - immediate per-field validation against the shared contract, with a view of the exact request to be sent;
  - a schema-validating API client;
  - the result panel: up to 3 cards, used signals, provider status, preview delivery diagnostics, and a sent-context toggle.
- Every run is fixed to `mode="simulation"` / `deliveryMode="preview"`. There is no mode switch.
- Not connected yet:
  - the API URL and Cognito login, which need runtime config from lane D;
  - the MapLibre map, which needs the dependency and a map key from lane D.

  Until then the Console shows "未接続", keeps Run disabled, and never shows a placeholder recommendation.
- The other four presets come in Phase 2. Details: `apps/web/README.md`.

## 2. Judge flow

```text
Open public URL
  ↓
Sign in with shared demo account
  ↓
Console runs in fixed preview delivery mode
  ↓
Choose preset or create custom scenario
  ↓
Click map / enter coordinates
  ↓
Set time, steps, events, interests
  ↓
Run Scenario
  ↓
Production API
  ↓
Real Places / Weather / Routes / Bedrock
  ↓
Recommendation + used signals + provider status
```

## 3. Page layout

Suggested desktop layout:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Context Concierge — Scenario Console                  [Demo User]   │
├────────────────────────────────┬────────────────────────────────────┤
│                                │ Scenario Inputs                    │
│                                │                                    │
│           MAPLIBRE             │ Time                               │
│       AMAZON LOCATION          │ [2026-09-30 14:10 JST]            │
│                                │                                    │
│              ●                 │ Steps [10432] Goal [10000]        │
│                                │                                    │
│ click to set location          │ Calendar                           │
│                                │ + Event                            │
│                                │                                    │
│                                │ Interests [cafe] [museum]         │
│                                │                                    │
│                                │ [ Run Scenario ]                  │
├────────────────────────────────┴────────────────────────────────────┤
│ Recommendation                                                     │
│ "..."                                                              │
│ [card 1] [card 2] [card 3]                                        │
│                                                                     │
│ Signals: ✓ location ✓ calendar ✓ transit                           │
│ Providers: Places OK | Weather OK | Routes OK | Bedrock OK         │
│ [Show normalized context]                                          │
└─────────────────────────────────────────────────────────────────────┘
```

Responsive mobile browser support is nice but secondary.

## 4. Map behavior

- Amazon Location map rendered with MapLibre.
- Click updates marker and lat/lon.
- Lat/lon fields update map marker.
- Optional place search/geocoder may be added if cheap.
- Display current coordinates visibly.
- "Use Tokyo Station", "Use Osaka Station" shortcuts may exist as demo presets, but raw arbitrary coordinates remain possible. Implemented shortcuts: Tokyo Station (35.681236, 139.767125) and Osaka Station (34.702485, 135.495951).

API key:
- map-only or minimum required actions,
- allowed-referrer restriction,
- expiration,
- separate dev/prod key.

## 5. Presets

Presets only fill input forms. They never return precomputed recommendation results.

### Preset A — Upcoming event + transit
Example:
- current: Tokyo urban point
- time: 14:10
- next event: 16:00 at another reachable station
- steps: 4,000
- interests: none required

Expected demonstration:
- route/transit provider used
- departure timing considered
- recommendation may notify when useful

What judge learns:
"Calendar + GPS + real transit data can create a proactive leave-soon recommendation."

### Preset B — Step goal + rest
- steps: 10,432
- goal: 10,000
- current position: dense area with POIs
- no imminent event
- interests: cafe/park

Expected:
- Places queried
- AI selects appropriate rest options
- max 3

What judge learns:
"Physical activity changes what nearby options are useful."

### Preset C — Free time
- current time between events
- next event 90–120 minutes away
- current area with several POIs
- interests: museum/cafe

Expected:
- gap calculation
- place candidates
- time-fit reasoning

What judge learns:
"AI does not just search nearby; it considers available time."

### Preset D — Weather adaptation
- current location
- real weather that is relevant if possible
- upcoming outdoor-ish context

Because weather is real in v1, preset must not promise rain. The demo UI should support a location known to have current weather, but the recommendation only triggers if actual conditions justify it.

For a deterministic recorded demo, capture a scenario when weather is relevant or use a tested fixture in development narration.

What judge learns:
"External real-time context can change the recommendation."

### Preset E — Early arrival
- current position near event destination
- event sufficiently later
- current time early
- interests set

Expected:
- destination-area places
- option that fits buffer
- preserves time to event

What judge learns:
"Same destination can produce different behavior depending on timing."

## 6. Custom mode

Judge can change all supported synthetic device inputs:
- map location
- coordinates
- time
- timezone (IANA)
- steps
- goal
- calendar list
- interest categories
- notification preference override

The Console should show validation immediately.

Time and calendar inputs are wall-clock times in the selected IANA timezone and are sent with that zone's offset. A blank step count is sent as unknown (`null`) and makes no goal claim.

## 7. "Why did the system do this?" panel

Do not expose chain-of-thought.

Show:
- detector/trigger type
- used signals
- factual provider summary
- concise decision reason
- provider status/latency

Example:
```text
Trigger: UPCOMING_EVENT_TRANSIT

Used signals
✓ Current location
✓ Next calendar event
✓ Transit route
○ Steps
○ Nearby places

Decision summary
"The event is approaching and current route duration makes leaving soon useful."
```

## 8. Provider degradation demo

Add a developer/demo toggle only in `dev` to force one provider failure.

Do not expose a production toggle that can call arbitrary upstream endpoints.

Useful dev demo:
- weather unavailable
- route unavailable

Expected:
- system still responds where possible,
- UI visibly marks degradation.

## 9. Duplicate prevention demo

Production judge Console runs in preview mode, so a shared account must remain usable.

Run the same scenario twice.

Expected:
- content evaluation can still be displayed;
- second response shows `delivery.wouldSuppress=true`;
- `delivery.guardCodes` contains `DUPLICATE_CONTEXT` or `RECENT_SAME_TRIGGER` when appropriate;
- notification counters are not consumed.

For a true suppression demonstration, use a dev-only proactive-delivery test account/path.

This demonstrates anti-spam behavior without making the public judge experience appear broken.

## 10. Mobile live demo

If device build is ready:

1. login.
2. show Dashboard.
3. show real GPS.
4. show real next events.
5. show steps.
6. tap "Evaluate now" for deterministic demo even if background callback timing is unpredictable.
7. display recommendation.
8. ask a follow-up.

Background behavior can then be described/shown separately.

## 11. Video/demo narrative

Suggested 2–3 minute story:

1. **Problem (15s)**
   - assistants wait for prompts,
   - useful context is already on the phone.

2. **Architecture idea (20s)**
   - device context → cheap guards → real-world enrichment → Bedrock only when worthwhile.

3. **Scenario Console (60–90s)**
   - move map position,
   - set event,
   - run,
   - show transit/weather/places signal panel,
   - modify steps/time and rerun.

4. **Mobile (30–45s)**
   - real data collection,
   - notification/recommendation,
   - short follow-up.

5. **AWS / shipping proof (20s)**
   - public CloudFront URL,
   - CDK,
   - Cognito,
   - API Gateway/Lambda/DynamoDB,
   - Location/Bedrock,
   - Codex/Claude Code via AWS MCP.

## 12. Ship Gate checklist

Hackathon qualification currently requires:
- live application on AWS,
- reachable via public URL,
- documented coding-agent connection to AWS,
- accessible to AI scoring and human judges.

Before final submission:
- open production URL in incognito.
- verify static assets from CloudFront.
- verify judge authentication path.
- verify one scenario end-to-end.
- verify no IP allowlist/VPN restriction.
- verify no localhost callback remains.
- verify production account has sufficient quotas.
- verify demo account is enabled.
- verify credentials/instructions are supplied through allowed submission fields.
- verify AWS MCP proof is documented.

## 13. Agent proof plan

Store:
```text
docs/hackathon/
├── AGENT_LOG.md
├── codex-aws-mcp.png
├── claude-aws-mcp.png
└── cloudtrail-mcp-proof.png   # optional
```

AGENT_LOG should describe concrete tasks the agent completed with AWS interaction.

Avoid cosmetic proof only; use the agent to perform real inspect/deploy/debug work.

## 14. Demo resilience

Have these available:
- live prod.
- live dev as backup.
- screen recording of the working flow.
- screenshots.
- scenario fixture JSON.
- architecture diagram.

The submitted application itself must still be live; recording is only backup/storytelling.

## 15. Final judge-facing copy placeholder

Short description template:

> This is a proactive AI concierge that decides when context is useful before invoking an LLM. The mobile app combines location, calendar, steps, weather, nearby places and public-transit routes. The public Scenario Console lets you change those conditions yourself and executes the same AWS backend used by the mobile app.

Update after product naming/category are finalized.
