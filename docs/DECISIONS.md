# DECISIONS.md — Consolidated Architecture Decisions

> v1.1 — 2026-09-30  
> This file records current decisions by concern. The earlier questionnaire numbers are retained as references where useful, but duplicated questions have been consolidated.

## A. Product and platform

| Decision | Current choice | Source questions |
|---|---|---|
| Project/repository working name | **Contextia** | review resolution |
| Technical resource slug | **`contextia`** | review resolution |
| Geography | global-ready architecture; Japan-focused demo | #1 |
| Primary clients | iOS + Android | #2 |
| Judge client | separate Web Scenario Console | #2, #27 |
| Web stack | React + Vite + TypeScript | #34 |
| Mobile stack | React Native + Expo + TypeScript | #2 |
| Auth | Cognito | #3 |
| UI | dashboard + recommendation feed | #25–26 |
| Follow-up | short recommendation-scoped chat | #23, #49 |

## B. Context and signals

| Decision | Choice |
|---|---|
| Location | foreground + background-capable; no guaranteed 5-minute cron |
| Calendar | multi-day events; title/time/location only |
| Steps | today's count + goal state; iOS Pedometer / Android Health Connect abstraction |
| Weather | real Open-Meteo current + same-day forecast |
| Places | Amazon Location Places V2 |
| Geocoding | dedicated Amazon Location Places V2 `Geocode` adapter |
| Transit | provider abstraction; Amazon Location Routes implementation |
| Search radius | 1 km default |
| Scenario time | arbitrary |
| Scenario calendar | multiple events |
| Scenario location | map click + lat/lon |

Canonical `SignalName`:
```text
time, location, calendar, steps, weather, places, transit, preferences
```

## C. Recommendation engine

| Decision | Choice |
|---|---|
| Control flow | deterministic guards → candidate detectors → provider enrichment → Bedrock |
| Initial trigger types | UPCOMING_EVENT_TRANSIT, STEP_GOAL_REST, FREE_TIME_NEARBY, WEATHER_ADAPTATION, EARLY_ARRIVAL_DETOUR |
| AI output | structured JSON + natural-language fields |
| Returned recommendations | max 3 |
| Model | environment-configurable Bedrock model |
| Duplicate policy | deterministic delivery guards + AI semantic duplicate/relevance judgment |
| Candidate missing signal | candidate exclusion, not global hard guard |

## D. Scenario/judge behavior

Scenario Console uses `deliveryMode=preview`.

Preview:
- executes the real context/detector/provider/Bedrock pipeline;
- does not send a notification;
- does not increment daily notification quota;
- returns `wouldSuppress` diagnostics for dedup/cap guards.

This resolves the shared-demo-account risk without adding an unsafe public "force evaluate" bypass.

## E. Persistence

| Decision | Choice |
|---|---|
| DB | DynamoDB single table per environment |
| Context retention | 24h logical TTL |
| Recommendation retention | 7d default, configurable |
| Chat retention | ~2h |
| By-ID recommendation lookup | same-user `RECOMMENDATION_REF#{id}` pointer → timestamped recommendation SK |
| GSI | none required in v1 |
| Daily notification day | user's IANA timezone |
| Place persistence | transient candidate search is SingleUse; selected persisted place is re-read via GetPlace with Storage intent |

## F. API/contract

Canonical types:
- `SignalName`
- `TriggerType`
- `ProviderNeed`
- `DeliveryMode`

Evaluation returns a stable top-level `recommendationId` when a recommendation exists.

`RecommendationDecision` is a discriminated union:
- notify: urgency/message/recommendations required;
- silent: urgency/message are null and recommendations empty.

Every evaluation returns provider statuses for:
- geocoding
- places
- weather
- routes
- bedrock

## G. AWS and infrastructure

| Decision | Choice |
|---|---|
| Backend | TypeScript on Lambda |
| IaC | AWS CDK TypeScript |
| API | API Gateway HTTP API |
| Web hosting | private S3 + CloudFront OAC |
| Map | MapLibre + Amazon Location |
| Environments | dev + prod |
| Repository | pnpm workspaces monorepo |
| Observability | CloudWatch Logs + metrics |
| Agent connection | AWS Agent Toolkit / AWS MCP Server |
| CI AWS auth | GitHub OIDC |
| Dev deploy IAM role | `GitHubDevDeployRole` |
| Prod deploy IAM role | `GitHubProdDeployRole` |
| Stack/resource prefix | `contextia-{stage}-...` |

## H. CI/CD

```text
feature branch
  -> PR
  -> validation
  -> dev deploy
  -> dev smoke
  -> merge main
  -> prod deploy
  -> prod smoke
```

No staging environment for the hackathon.

## I. Notifications

Architecture supports:
- local notifications,
- Expo Push,
- SNS provider adapter.

Only one path may deliver a given recommendation.

## J. Initial five polished demos

1. upcoming event + transit
2. step goal + nearby rest
3. free time + personalized nearby activity
4. weather-aware adaptation
5. early arrival + destination-area detour

Architecture remains extensible to additional trigger detectors.

## K. Non-blocking open decisions

- final marketing name if different from Contextia
- license
- hackathon category/lane
- exact Bedrock model ID
- exact AWS region/model routing
- custom domain
- final visual identity
