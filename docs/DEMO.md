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

### 1.1 Console status (2026-10-03)

- Implemented in `apps/web`:
  - editors for coordinates (with Tokyo/Osaka Station shortcuts), scenario time with an IANA timezone, steps and goal, multiple calendar events, interests and notification preference overrides;
  - all five input presets (`upcoming-transit`, `step-goal`, `free-time`, `weather-adaptation`, `early-arrival`);
  - input-only preset data, with dates anchored to today in the preset timezone and fixed daytime scenario times; calendar offsets and durations are preserved;
  - immediate per-field validation against the shared contract, with a view of the exact request to be sent;
  - a schema-validating API client;
  - the result panel: up to 3 cards, used signals, all six provider status values, explicit `wouldSuppress` and guard codes, and a closed sent-context toggle;
  - a notice when inputs have changed since submission, so the last result is identified as belonging to the submitted context;
  - runtime configuration, Cognito authorization-code/PKCE login/logout, profile initialization and MapLibre/Amazon Location Maps V2 selection;
  - the backend-normalized preview context toggle, alongside the exact sent request.
- Every run is fixed to `mode="simulation"` / `deliveryMode="preview"`. There is no mode switch.
- Dev is available at https://d1grgebh7iqqmf.cloudfront.net/. OIDC run [37046597403](https://github.com/xe-pc23/Contextia/actions/runs/37046597403) at `ba15f30` passed authenticated five-preset smoke, preview persistence/quota invariants, a live step recommendation, an actual transit card and chat ownership checks. Weather-adaptation's model call timed out and displayed degradation.
- Earlier successful dev `0e443f828d84441ac032c045a47e40bfdb5437c8` passed [OIDC run 37057828984](https://github.com/xe-pc23/Contextia/actions/runs/37057828984): all five previews, live step/transit cards, explicit weather-unavailable fault with valid step recommendation, ownership/chat/idempotency/snapshot/quota invariants, Mobile SRP, one client reservation and quota increment, replay/duplicate/cap suppression, and recent EMF metric records. Some Routes calls were explicitly degraded; all five live inputs do not prove each named trigger will always be selected.
- Earlier dev head `6c5b165` (mobile/session and smoke changes `6ecc2e7`) passed [OIDC run 37073130086](https://github.com/xe-pc23/Contextia/actions/runs/37073130086), including the five validation commands, exact-SHA deployment, mandatory authenticated gates and bounded correlated request-log privacy checks. Both owned chat 200/400 records were checked against strict fields; specified synthetic markers and three transient tokens were absent in the fully fetched bounded window. This is bounded evidence, not an exhaustive privacy guarantee. Existing daily caps were preserved; the uncapped positive reservation proof remains the separate run above. The arm64 Android Debug APK also compiled and passed independent manifest/signature inspection; [native validation](MOBILE_VALIDATION.md) records its Metro dependency and unverified runtime rows.
- Current dev commit `8bb6c9a` passed all five local validation commands (1,290 tests / 80 files) and [OIDC deployment run 37084235490](https://github.com/xe-pc23/Contextia/actions/runs/37084235490). Its authenticated smoke passed five previews, a real scheduled transit recommendation carrying its route, live Places/Bedrock step recommendation, weather-fault degradation, ownership/idempotency, Mobile SRP, capped proactive invariants, and bounded log/EMF checks. These results use synthetic context and do not prove native OS delivery.
- Production is live at [the public Scenario Console](https://dc9g8dlhqsr5j.cloudfront.net/) from main merge `7111bee`. The isolated `contextia-prod-bootstrap` and `contextia-prod-core` stacks reached `CREATE_COMPLETE`; public HTTPS/assets/config/health/401 smoke passed. The owner-authorized [production OIDC run 37085408256](https://github.com/xe-pc23/Contextia/actions/runs/37085408256) completed authorize, validate and deploy successfully. A dedicated synthetic judge account passed Cognito SRP, profile initialization, live step-goal preview (`notify` / `STEP_GOAL_REST`), owned detail and chat. Places, Weather, Routes and Bedrock were all reported `ok` for that API evaluation. Separately, a fresh browser session completed Cognito PKCE login, selected the step-goal preset, changed longitude to `139.768`, and displayed a real place recommendation after **Run Scenario**. The UI showed `notify` / `STEP_GOAL_REST`, `mode=preview`, `status=preview`, `wouldSuppress=false`, Places 186 ms `ok`, Weather 1,073 ms `ok`, Routes 890 ms `ok`, Bedrock 1,403 ms `ok`, and a 4,071 ms response. These are observed browser values for this synthetic run; the browser check did not independently inspect quota counters or OS notification delivery.
- Actual dev browser PKCE callback, live preview, map clicking/coordinate editing and logout worked. [Map proof](hackathon/evidence/dev-map-53dfd72.jpg), [Japanese preview](hackathon/evidence/dev-preview-0e443f8.jpg) and [signal/provider diagnostics](hackathon/evidence/dev-diagnostics-0e443f8.jpg) contain public test data and no credentials. Natural Japanese prose and selected Places usage were observed after the fixes; this is observed output quality, not a guarantee of every future model response.
- Earlier `79ff4cd`/`53dfd72` failed live gates are preserved in the agent log. The successful dev run used the smoke identity without concurrent manual evaluations. Mobile SRP and synthetic proactive reservation are API/script evidence, not native sensor or OS notification proof. Simulator PKCE login, public simulated GPS, a neutral Calendar event, dev evaluation, owned detail/chat, preference save/readback and explicit logout passed; [dated native evidence](MOBILE_VALIDATION.md) records their limits. Physical-device capability results, refresh/denial, OS notifications and SNS delivery remain open. The [local delivery plan](superpowers/plans/2026-10-02-local-solo-delivery.md) records these gates.

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

Presets only fill input forms. They never return precomputed recommendation results. The Web bundle contains input-only snapshots, checked against the canonical fixtures in tests; mock provider responses are excluded.

Each load uses today's date in `Asia/Tokyo` and the fixed scenario times below. It preserves the time between the scenario and its events, including event duration. Run submits the displayed scenario time, including manual edits, so leaving the page open does not advance the simulated timeline. Reload a preset to move it to today's date again.

### Preset A — Upcoming event + transit
- ID: `upcoming-transit`
- current: Tokyo urban point (35.658581, 139.745433)
- time: 15:10 JST
- next event: 16:00–17:00 at Tokyo Station (50 minutes until start)
- steps: 3,000; goal: 10,000
- interests: cafe/park

Expected demonstration:
- route/transit provider used
- departure timing considered
- recommendation may notify when useful

What judge learns:
"Calendar + GPS + real transit data can create a proactive leave-soon recommendation."

### Preset B — Step goal + rest
- ID: `step-goal`
- time: 14:10 JST
- steps: 10,432
- goal: 10,000
- current position: Tokyo Station (35.681236, 139.767125)
- no imminent event
- interests: cafe/park

Expected:
- Places queried
- AI selects appropriate rest options
- max 3

What judge learns:
"Physical activity changes what nearby options are useful."

### Preset C — Free time
- ID: `free-time`
- time: 14:10 JST
- next event: 16:00–17:00 at Tokyo Station (110 minutes until start)
- current: Tokyo Station (35.681236, 139.767125)
- steps: 3,000; goal: 10,000
- interests: cafe/park

Expected:
- gap calculation
- place candidates
- time-fit reasoning

What judge learns:
"AI does not just search nearby; it considers available time."

### Preset D — Weather adaptation
- ID: `weather-adaptation`
- time: 14:30 JST
- current: Tokyo Station (35.681236, 139.767125)
- steps: 3,000; goal: 10,000
- calendar: no events
- interests: cafe/park
- weather: supplied only by the real provider, when covered and relevant

Because weather is real in v1, preset must not promise rain. The demo UI should support a location known to have current weather, but the recommendation only triggers if actual conditions justify it.

For a deterministic recorded demo, capture a scenario when weather is relevant or use a tested fixture in development narration.

What judge learns:
"External real-time context can change the recommendation."

### Preset E — Early arrival
- ID: `early-arrival`
- current: Tokyo Station (35.681236, 139.767125)
- time: 15:20 JST
- next event: 16:00–17:00 at Tokyo Station (40 minutes until start)
- steps: 3,000; goal: 10,000
- interests: cafe/park

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

The dev Console now offers `通常`, weather unavailable, or routes unavailable. It sends a closed
`X-Contextia-Demo-Fault` selector to the same evaluation API. The backend accepts it only from the
authenticated dev Web client in preview mode and rejects it in prod. An unneeded provider stays
`not_requested`; changing the selector does not add candidates or bypass guards. After running,
the result identifies which failure was selected. The mandatory dev smoke at `0e443f8` verified weather unavailable/null alongside a valid step recommendation and unchanged preview quota; the routes selector has unit proof and still needs its own live demo evidence.

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

Verified on 2026-10-03:
- [x] Production URL and static assets served over public CloudFront HTTPS; API health and unauthenticated 401 smoke passed.
- [x] A dedicated synthetic judge account is enabled and passed Cognito SRP, production preview, owned detail and chat via the API.
- [x] Production URL opened in a fresh browser incognito window and completed Cognito PKCE login with a public callback.
- [x] Production browser displayed a live step-goal recommendation after editing the synthetic coordinates and pressing **Run Scenario**; the UI reported preview mode and all four providers `ok`.
- [x] AWS MCP connection and successful STS read are documented in the [sanitized execution record](hackathon/evidence/aws-mcp-recovery-2026-10-03.json).

Still to finish before submission:
- [ ] Supply judge credentials and short instructions through the submission's permitted fields, without committing or posting the password.
- [ ] Check production service quotas during the final rehearsal; a successful live request is a point-in-time result.
- [ ] Complete the remaining physical-device capability rows in [Mobile validation](MOBILE_VALIDATION.md), if the native experience is part of the submitted demonstration.

## 13. Agent proof plan

The [agent log](hackathon/AGENT_LOG.md) records concrete Codex development, AWS inspect, deployment and debugging work. The [sanitized AWS MCP execution record](hackathon/evidence/aws-mcp-recovery-2026-10-03.json) shows a successful real STS API call; it is a JSON execution record, not a UI screenshot. An additional screenshot or CloudTrail export is optional only if the submission form needs it. Keep credentials, OAuth values and private calendar context out of evidence.

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
