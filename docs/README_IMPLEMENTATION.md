# AWS Hackathon Context-Aware Concierge — Implementation Blueprint

> Status: **Specification freeze candidate v1.1**
>
> Last verified: **2026-09-30**
>
> Product / repository working name: **Contextia**
>
> Infrastructure slug: **`contextia`**
>
> Branding may still change before submission, but code/resource naming uses `contextia` until an explicit rename decision.
>
> This repository is intended to be implemented primarily by Codex / Claude Code, with humans owning product decisions, review, credentials, and production approval.

## 1. Product in one sentence

A proactive mobile AI concierge that combines **location, calendar, steps, time, weather, nearby places, and public-transit routing**, evaluates whether the current moment is worth interrupting the user for, and invokes **Amazon Bedrock only when a meaningful opportunity exists**.

A separate **Web Scenario Console** allows judges to simulate the same backend with arbitrary location, time, steps, and calendar conditions.

## 2. Primary product principles

1. **Proactive, not chat-first**
   - The product's value is deciding *when* to suggest something.
   - Chat exists only as a short follow-up to a generated recommendation.

2. **Rules narrow the problem; AI makes the contextual judgment**
   - Hard deterministic guards prevent spam, duplicates, and unnecessary cost.
   - Trigger detectors create candidate opportunities.
   - Bedrock makes the final relevance / recommendation decision.

3. **One backend, two clients**
   - Mobile uses real device context.
   - Web Scenario Console injects simulated context.
   - Both call the same evaluation pipeline.

4. **Providers are replaceable**
   - Places, weather, transit, routing, geocoding, notifications, steps, and auth are behind interfaces.
   - MVP providers can be replaced without rewriting domain logic.

5. **Data minimization**
   - Only the context required for the recommendation is sent to AWS / Bedrock.
   - Raw sensitive device data is not stored indefinitely.
   - Context snapshots expire after 24 hours.

6. **AWS-first, not AWS-only**
   - AWS is used wherever it is strong and helps the hackathon story.
   - Open-Meteo is used for weather.
   - Provider interfaces keep future migration possible.

## 3. Technology stack

| Layer | Decision |
|---|---|
| Mobile | React Native + Expo + TypeScript |
| Web Scenario Console | React + Vite + TypeScript |
| Backend | AWS Lambda + TypeScript |
| Lambda runtime | Node.js 24.x |
| Package manager | pnpm workspaces |
| Shared runtime contracts | Zod schemas + inferred TypeScript types |
| API | Amazon API Gateway HTTP API |
| Authentication | Amazon Cognito User Pool + JWT authorizer |
| Database | Amazon DynamoDB |
| AI | Amazon Bedrock Converse API |
| AI output | Structured JSON internally; natural-language message externally |
| Nearby places | Amazon Location Service Places V2 / SearchNearby + GetPlace(Storage for persisted selections) |
| Geocoding | Amazon Location Service Places V2 / Geocode |
| Transit / routes | Amazon Location Service Routes (Transit / Intermodal) |
| Weather | Open-Meteo |
| Web map | MapLibre GL JS + Amazon Location Maps |
| Web hosting | Private S3 + CloudFront + OAC |
| IaC | AWS CDK + TypeScript |
| CI/CD | GitHub Actions + AWS OIDC |
| Observability | CloudWatch Logs + custom metrics |
| Mobile notifications | Local + Expo Push + SNS adapter |
| iOS steps | Expo Pedometer |
| Android steps | Health Connect (provider abstraction) |

## 4. Environments

Only two deployed application environments are required.

- `dev`
  - Used by pull requests and developers.
  - Safe to break.
  - May be overwritten by the latest PR deployment.
- `prod`
  - Used by judges and the submitted public URL.
  - `main` is the source of truth.

No staging environment is required for this hackathon.

## 5. Deployment flow

```text
feature branch
     |
     v
Pull Request
     |
     +--> lint / typecheck / unit tests
     +--> cdk synth
     +--> deploy DEV (serialized)
     +--> live integration smoke test
     |
     v
merge to main
     |
     +--> full validation
     +--> deploy PROD
     +--> web smoke test
     +--> API smoke test
     +--> record deployment metadata
```

AWS credentials are **not** stored as long-lived GitHub secrets. GitHub Actions assumes environment-specific IAM roles through OIDC.

## 6. Repository layout

```text
.
├── apps/
│   ├── mobile/                 # Expo React Native
│   ├── web/                    # Vite Scenario Console
│   └── api/                    # Lambda handlers / composition root
├── packages/
│   ├── contracts/              # Zod schemas + shared TS types
│   ├── domain/                 # trigger/recommendation domain logic
│   ├── providers/              # interfaces and adapters
│   ├── config/                 # shared environment config
│   └── test-fixtures/          # scenario fixtures
├── infra/
│   └── cdk/                    # dev/prod stacks
├── docs/
│   ├── README.md
│   ├── SPEC.md
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── DATA_MODEL.md
│   ├── TEST_STRATEGY.md
│   ├── DEMO.md
│   ├── CI_CD.md
│   ├── DECISIONS.md
│   ├── REVIEW_RESOLUTION.md
│   ├── REFERENCES.md
│   ├── BACKLOG.md
│   └── hackathon/
│       └── AGENT_LOG.md
├── AGENTS.md
├── README.md
├── .gitignore
├── pnpm-workspace.yaml
├── package.json
└── tsconfig.base.json
```

## 7. Initial five demo scenarios

The architecture must support arbitrary future patterns, but the first five polished scenarios are:

1. **Upcoming event + public transit**
2. **Step goal reached + nearby rest opportunity**
3. **Free time + nearby personalized activity**
4. **Weather + schedule adaptation**
5. **Early arrival + destination-area detour**

These five collectively demonstrate location, calendar, steps, places, weather, transit, Bedrock, structured output, and notification logic.

## 8. Prioritized implementation sequence

### P0 — Ship Gate / critical path
1. Monorepo bootstrapping.
2. CDK `dev` and `prod`.
3. S3 + CloudFront Scenario Console public URL.
4. API Gateway + Lambda.
5. Cognito.
6. Web Scenario Console → real backend.
7. Amazon Location Places provider.
8. Open-Meteo provider.
9. Bedrock recommendation provider with structured output.
10. Hard guards and one trigger.
11. DynamoDB state / TTL.
12. GitHub Actions + OIDC.
13. AWS MCP connection proof.

### P1 — Strong demo
1. Amazon Location Transit / Intermodal provider.
2. All five demo trigger detectors.
3. Map click + direct lat/lon input.
4. Multiple simulated calendar events.
5. Recommendation cards and "signals used" display.
6. Mobile app real GPS + calendar.
7. Local notifications.
8. Recommendation follow-up chat.

### P2 — Mobile completeness / robustness
1. iOS step integration.
2. Android Health Connect step integration.
3. Background location.
4. Expo Push.
5. SNS notification adapter.
6. Device-token registration.
7. More graceful provider fallbacks.

## 9. Important technical constraints discovered during verification

### Expo background location
Background location requires the relevant OS permissions and a development build; Expo Go is insufficient for full background behavior.

### Calendar
Expo Calendar supports Android/iOS device calendars, but current Expo Calendar APIs require a development build.

### Step counting
Do **not** assume `expo-sensors` can provide today's historical step total on Android:
- `watchStepCount` works on Android/iOS but does not deliver updates while the app is backgrounded.
- `getStepCountAsync(start, end)` is iOS-only.
- Android production path must therefore use a `StepProvider` backed by Health Connect for aggregated step totals where supported.

### DynamoDB TTL
A record's `expiresAt` is a logical expiration time. DynamoDB deletion can occur later, typically within days. Queries must explicitly ignore expired items.

### Amazon Location SearchNearby persistence
If SearchNearby results are persisted in customer infrastructure, `IntendedUse=Storage` must be used. Provider code must make storage intent explicit.

## 10. Non-blocking decisions still open

These do not block implementation:
- Final marketing/branding name (technical project slug remains `contextia` until explicitly changed).
- Hackathon category.
- Community vs Startup lane.
- Repository license.
- Custom domain vs CloudFront URL.
- Final Bedrock model ID.
- Final AWS application region if model/provider availability changes.
- Visual branding.

## 11. Definition of Done

The project is considered shippable when:

- Production Web Scenario Console is reachable via a public AWS-hosted URL.
- Judge can sign in with a demo account and run a scenario.
- Scenario data reaches the real production API.
- At least one complete recommendation uses live provider data and Bedrock.
- All five demo scenarios have deterministic fixture tests.
- Prod is deployable from `main` through GitHub Actions.
- Infrastructure is reproducible via CDK.
- Coding-agent-to-AWS connection proof is documented.
- CloudWatch logs and metrics are available.
- No long-lived AWS access key is committed or stored in GitHub.
- README clearly explains how the agent helped build and deploy the application.
