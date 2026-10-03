# Contextia

Contextia is a proactive, context-aware AI concierge built for the AWS Zero to Shipped hackathon.

It combines mobile context—location, calendar, steps and time—with real-world enrichment such as weather, nearby places and public-transit routes. Deterministic guards first decide whether an opportunity is worth evaluating; Amazon Bedrock is then used to produce a structured recommendation only when useful.

A separate Web **Scenario Console** lets judges choose arbitrary location/time/steps/calendar conditions and execute the same AWS backend without installing the native app.

## Status

Specification: **v1.1 candidate**  
Implementation: **Web/API and native code integrated; dev and prod deployed; physical-device acceptance remains open**

Public dev URL: [Scenario Console](https://d1grgebh7iqqmf.cloudfront.net/)

Public production URL: [Scenario Console](https://dc9g8dlhqsr5j.cloudfront.net/)

This repository contains the contracts, five detectors, provider adapters, authenticated API, five-preset Web Scenario Console, Expo foreground/background application, stage-isolated CDK, and GitHub OIDC workflows. Dev `8bb6c9a` passed all five validation commands and its [mandatory authenticated deployment smoke](https://github.com/xe-pc23/Contextia/actions/runs/37084235490): five previews, a real scheduled transit card, live Places/Bedrock step recommendation, weather-fault degradation, ownership/idempotency, Mobile SRP and bounded log/EMF checks. The production stack deployed merge SHA `7111bee` and passed public HTTPS/assets/config/health/401 smoke. A separate production judge account authenticated through Cognito SRP and produced a real step recommendation, owned detail and chat with Places, Weather, Routes and Bedrock all `ok`. In a fresh production browser session, Cognito PKCE login and an edited step-goal scenario displayed a `notify` / `STEP_GOAL_REST` recommendation with preview status and all four providers `ok`. Physical-device capability results remain open. Follow the [local delivery plan](docs/superpowers/plans/2026-10-02-local-solo-delivery.md) for remaining gates. The [Phase 0 handoff](docs/hackathon/PHASE0_HANDOFF.md) and [Phase 1 assignments](docs/hackathon/PHASE1_ASSIGNMENTS.md) are historical records.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm cdk:synth
pnpm dev:api
# In separate terminals:
pnpm dev:web
pnpm dev:mobile
```

Use Node.js 24.13.1 from `.node-version` (minimum 24.3.0, below 25) and pnpm 10.29.3. `pnpm dev:api` serves health at `http://127.0.0.1:3001/health`; `pnpm dev:web` opens the Web app at `http://127.0.0.1:5173`. Runtime authentication and live evaluation require deployed stage configuration. Mobile uses a development client; follow [its README](apps/mobile/README.md) for native setup.

On 2026-10-03, the merged release passed all five verification commands with 1,290 tests / 80 files. The `79ff4cd` iOS Simulator development build compiled and installed. Native PKCE login, public simulated GPS, a neutral Calendar event, dev evaluation, owned detail/chat, preference readback and explicit sign-out were subsequently observed. Dev live smoke has observed Places/Weather/Bedrock, a scheduled transit card, owned chat, cross-user denial and preview quota invariants. Real iOS/Android capability results remain open; see [mobile validation](docs/MOBILE_VALIDATION.md) and the [agent log](docs/hackathon/AGENT_LOG.md). Mobile JavaScript export does not verify APK/IPA compilation or native device behavior.

## Stack

- React Native + Expo + TypeScript
- React + Vite + TypeScript
- AWS Lambda + TypeScript
- API Gateway HTTP API
- Cognito
- DynamoDB
- Amazon Bedrock
- Amazon Location Places V2 / Routes
- Open-Meteo
- MapLibre
- private S3 + CloudFront OAC
- AWS CDK TypeScript
- pnpm workspaces
- GitHub Actions + AWS OIDC

## Repository target

```text
apps/
  mobile/
  web/
  api/
packages/
  contracts/
  domain/
  providers/
  config/
  test-fixtures/
infra/
  cdk/
docs/
AGENTS.md
README.md
```

## Documentation

Start with [docs/README.md](docs/README.md).

The core contracts are:
- [Product spec](docs/SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [Data model](docs/DATA_MODEL.md)
- [Test strategy](docs/TEST_STRATEGY.md)
- [CI/CD](docs/CI_CD.md)
- [Demo plan](docs/DEMO.md)
- [Decisions](docs/DECISIONS.md)
- [v1.1 review resolution](docs/REVIEW_RESOLUTION.md)

Coding agents must read [AGENTS.md](AGENTS.md) before making implementation changes.

The [five-person phased implementation plan](docs/PHASED_IMPLEMENTATION.md) assigns file ownership and phase gates for the build.

## Core architecture

```text
Mobile real context ─┐
                     ├─> Cognito -> API Gateway -> Lambda
Web Scenario Console ┘                         |
                                               v
                                      hard delivery guards
                                               |
                                      trigger candidates
                                               |
                                    provider enrichment
                              Places / Geocode / Weather / Routes
                                               |
                                               v
                                         Amazon Bedrock
                                               |
                                               v
                              structured recommendation (max 3)
                                               |
                                     DynamoDB + client UI
```

## Judge Scenario Console

Production Scenario Console uses `deliveryMode=preview`.

This means:
- the real provider + Bedrock pipeline runs;
- it never sends a judge push notification;
- it does not consume the shared demo account's daily notification quota;
- it reports which delivery guard **would** have suppressed a proactive notification.

This preserves real behavior while keeping a shared judge account repeatable.

Use only synthetic events and locations in the shared judge account. Everyone with those credentials acts as the same user and can see that account's recent recommendations and chat. Personal mobile context is keyed to each owner's Cognito subject and is not part of the shared judge account.

## Development workflow

```text
feature branch
  -> Pull Request
  -> tests / typecheck / build / cdk synth
  -> deploy dev
  -> smoke test
  -> merge main
  -> project owner starts prod deploy from validated main
  -> production smoke test
```

GitHub Actions must use AWS OIDC with:
- `GitHubDevDeployRole`
- `GitHubProdDeployRole`

Do not store long-lived AWS access keys in GitHub.

## Coding agents and AWS

Codex implemented and reviewed the Web, mobile, API, provider and CDK slices; diagnosed the live transit-card failure; and used the AWS MCP connection for a verified account read. The owner-authorized local prod role was used to inspect and create the isolated bootstrap/core stacks. GitHub Actions uses stage-specific OIDC roles for deployment. The [agent log](docs/hackathon/AGENT_LOG.md) and [sanitized AWS MCP execution record](docs/hackathon/evidence/aws-mcp-recovery-2026-10-03.json) record the evidence without credentials.

## Security/privacy summary

- calendar attendee data and descriptions are not transmitted;
- context history logically expires after 24h;
- long-term raw GPS history is not kept;
- production logs do not dump private request bodies;
- S3 remains private behind CloudFront OAC;
- Bedrock receives the validated evaluation context after a candidate passes deterministic guards; this can include permitted calendar title, time and location fields. Attendees and descriptions are excluded;
- AI chain-of-thought is not requested or exposed.

## License

TBD before submission.
