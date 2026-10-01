# Contextia

Contextia is a proactive, context-aware AI concierge built for the AWS Zero to Shipped hackathon.

It combines mobile context—location, calendar, steps and time—with real-world enrichment such as weather, nearby places and public-transit routes. Deterministic guards first decide whether an opportunity is worth evaluating; Amazon Bedrock is then used to produce a structured recommendation only when useful.

A separate Web **Scenario Console** lets judges choose arbitrary location/time/steps/calendar conditions and execute the same AWS backend without installing the native app.

## Status

Specification: **v1.1 candidate**  
Implementation: **Phase 0 common foundation implemented; contracts/providers/Web/Mobile pending**

Public production URL: `TBD after deployment`

The common workspace, five verification commands, local `/health`, and separate dev/prod CDK health stacks are available. See the [Phase 0 handoff](docs/hackathon/PHASE0_HANDOFF.md) to assign the remaining lanes. No AWS deployment has been performed.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm cdk:synth
pnpm dev:api
```

Use Node.js 24.x and pnpm 10.29.3. `pnpm dev:api` serves health at `http://127.0.0.1:3001/health`. Web and Mobile workspaces are empty foundations for C/E to replace.

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

The project is designed to be built with Codex and Claude Code. AWS interaction should use the AWS Agent Toolkit / AWS MCP Server with least-privilege access, and relevant agent/AWS evidence should be recorded under `docs/hackathon/`.

## Security/privacy summary

- calendar attendee data and descriptions are not transmitted;
- context history logically expires after 24h;
- long-term raw GPS history is not kept;
- production logs do not dump private request bodies;
- S3 remains private behind CloudFront OAC;
- Bedrock receives normalized/minimized context;
- AI chain-of-thought is not requested or exposed.

## License

TBD before submission.
