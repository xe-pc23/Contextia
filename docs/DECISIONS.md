# DECISIONS.md — Consolidated Product Decisions

## Confirmed

| # | Decision |
|---|---|
| 1 | Global-ready provider architecture; Japan-focused demo quality |
| 2 | iOS + Android main product; separate Web Scenario Console |
| 3 | Cognito authentication |
| 4 | Preferences: interests + step goal + notification frequency |
| 5 | Foreground + background location |
| 6 | Multi-day calendar context |
| 7 | Calendar sends title + time + location only |
| 8 | Today's steps + goal-reached state |
| 9 | Extensible trigger patterns; initial five polished demos |
| 10 | Deterministic rule/guard layer then Bedrock |
| 11 | Context updates + background events |
| 12 | Amazon Location primary Places provider |
| 13 | Nearby category selection broadly available; AI chooses relevance |
| 14 | Nearby radius 1 km |
| 15 | Current + same-day weather forecast |
| 16 | Up to 3 recommendations |
| 17 | Internal structured JSON + free natural-language copy |
| 18 | Local notification + Expo Push + SNS-capable provider architecture |
| 19 | Hard guards + AI semantic duplicate/relevance judgment |
| 20 | DynamoDB: preferences + state + recommendation history |
| 21 | Context history 24 hours |
| 22 | Bedrock model configurable |
| 23 | Short follow-up chat after recommendation |
| 24 | Open maps / external website; no auto booking |
| 25 | Dashboard + recommendation feed |
| 26 | Dashboard shows location/weather/steps/next event/recommendations |
| 27 | Real data + Scenario Mode |
| 28 | Graceful degradation with available signals |
| 29 | Coding agents connect to AWS using AWS Agent Toolkit / MCP |
| 30 | Monorepo |
| 31 | Codex first; Claude Code also used; both may work on tasks |
| 32 | CI/CD + tests |
| 33 | AWS CDK TypeScript |
| 34 | Web React + Vite |
| 35 | Web hosting: S3 + CloudFront |
| 36 | Judge/demo Cognito account |
| 37 | Structured response internally |
| 38 | Hard guards + AI duplicate handling |
| 39 | Transit provider abstraction; Amazon Location implementation |
| 40 | MapLibre + Amazon Location |
| 41 | Scenario position by map click + lat/lon |
| 42 | All future patterns supported; initial 5 polished |
| 43 | Backend TypeScript |
| 44 | pnpm workspaces |
| 45 | Scenario time freely selectable |
| 46 | Weather is real provider data for simulated location |
| 47 | Multiple calendar events in Scenario Console |
| 48 | 24h context logical TTL |
| 49 | Recommendation-scoped short chat |
| 50 | dev + prod only |
| 51 | PR → dev; main → prod |
| 52 | CloudWatch Logs + Metrics |

## Technical clarification added during design

Android step counting cannot rely on Expo Pedometer alone for robust background/today totals.

Therefore:
- step collection is a provider/interface.
- iOS: Expo Pedometer.
- Android: Health Connect preferred.
- Web: simulated steps.
- foreground sensor fallback remains possible.

This does not change product behavior; it makes the agreed cross-platform behavior implementable.

## Open but non-blocking

- product name
- license
- hackathon category
- hackathon lane
- final Bedrock model ID
- final AWS application region
- custom domain
- exact visual identity
