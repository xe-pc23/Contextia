# AGENTS.md — Instructions for Codex / Claude Code

## 0. Priority

You are implementing a hackathon application under a short deadline.

Optimize for:
1. a live, reproducible application,
2. correctness of the agreed specification,
3. clear architecture,
4. tests,
5. polish.

Do not expand product scope without an explicit human decision.

## Current delivery mode (2026-10-02)

One human owner will drive implementation locally with Codex. The primary agent
implements and integrates; subagents review completed slices. The A–E lane
assignments in older planning documents describe responsibility boundaries for
the former team workflow; they do not restrict which repository paths this local
task may edit. Preserve the product specification, dependency direction, phase
gates, tests, and owner-controlled production release. Start work from a
GitHub branch containing the latest integrated implementation, not from `main`
until that implementation has been validated and merged. See
`docs/superpowers/plans/2026-10-02-local-solo-delivery.md`.

## 1. Read these first

Before editing implementation code, read:
1. `README_IMPLEMENTATION.md`
2. `SPEC.md`
3. `ARCHITECTURE.md`
4. `API.md`
5. `DATA_MODEL.md`
6. `TEST_STRATEGY.md`
7. `DEMO.md`

If a requirement conflicts:
```text
SPEC.md
  > API.md / DATA_MODEL.md
  > ARCHITECTURE.md
  > implementation details
```

Raise the conflict in your summary rather than silently choosing a new product behavior.

## 2. Hard architectural rules

### MUST
- TypeScript across Web, Mobile, Lambda, and CDK.
- pnpm workspaces.
- Zod schemas in `packages/contracts` for runtime API validation.
- Domain code must not import AWS SDK clients directly.
- External services must be behind provider interfaces.
- Bedrock must not be called before hard guards/candidate generation justify it.
- Bedrock output must be schema-validated.
- Do not expose chain-of-thought.
- Do not commit secrets.
- Use environment variables for model IDs, endpoints, stage names, and provider configuration.
- Keep `dev` and `prod` isolated by resource names/stacks.
- Use CloudWatch structured logging.
- Tests for new detector/domain behavior are required.

### MUST NOT
- Directly call Amazon Location from React components for recommendation logic.
- Put AWS access keys in `.env` files committed to Git.
- Make S3 website bucket public.
- Use raw DynamoDB objects as API responses.
- Persist unbounded GPS history.
- Send calendar attendees/description to backend.
- Hardcode a Bedrock model ID throughout the codebase.
- Invent public-transit times if route provider fails.
- Implement a background "every 5 minutes exactly" promise on mobile.
- Bypass contracts by using `any`.
- Add a vector DB/RAG layer without a defined product requirement.

## 3. Repository target

```text
apps/mobile
apps/web
apps/api
packages/contracts
packages/domain
packages/providers
packages/config
packages/test-fixtures
infra/cdk
docs
```

If bootstrapping the repository, create this shape unless there is an existing compatible structure.

## 4. TypeScript standards

- strict TypeScript.
- avoid `any`.
- model external input as `unknown` then parse with Zod.
- prefer discriminated unions.
- use async/await.
- use `Result`-style provider responses or a well-defined exception mapping strategy.
- do not leak AWS SDK types outside adapters.

Recommended base:
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

Relax only if a dependency/tooling incompatibility blocks shipping.

## 5. Contracts workflow

`packages/contracts` owns:
- request schemas,
- response schemas,
- shared enums,
- provider-normalized public types where appropriate.

Example:
```ts
export const GeoPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export type GeoPoint = z.infer<typeof GeoPointSchema>;
```

Canonical enums (`SignalName`, `TriggerType`, `DeliveryMode`, `ProviderNeed`) are defined in contracts. Do not create free-form alternative spellings elsewhere.

When API contract changes:
1. change schema first,
2. update API handler,
3. update Web client,
4. update Mobile client,
5. update tests/fixtures,
6. update `API.md`.

## 6. Domain workflow

A detector:
- reads normalized context,
- produces candidate opportunities,
- declares provider needs,
- never sends notifications itself,
- never imports Bedrock SDK.

Every detector requires:
- positive fixture,
- negative fixture,
- boundary-case test,
- duplicate/guard behavior test if relevant.

## 7. Provider workflow

Each external service:
1. define/confirm interface in `packages/providers/ports`,
2. implement adapter,
3. normalize result,
4. map errors to provider status,
5. add adapter tests using mocks/recorded minimal fixtures,
6. never return the raw SDK response to domain/UI.

### Amazon Location Places
Use Places V2, not legacy Place Index APIs.

- nearby discovery: `SearchNearby`
- text/address to coordinates: dedicated `GeocodingProvider` using `Geocode`
- selected persistent place detail: `GetPlace` with `IntendedUse=Storage`
- never persist data returned only under `SingleUse`

### Amazon Location Routes
Use current Routes API and explicit transit/intermodal mode.

### Weather
Keep Open-Meteo-specific field names inside its adapter.

### Bedrock
Prefer Converse structured output with JSON Schema when selected model supports it.

## 8. AWS infrastructure rules

Use AWS CDK TypeScript.

Resource naming:
```text
contextia-{stage}-{resource}
```

The technical project slug is `contextia` until a human explicitly approves a repository-wide rename.

Required stages:
```text
dev
prod
```

Web:
- private S3
- CloudFront OAC
- no public S3 bucket
- HTTPS

API:
- HTTP API
- JWT authorizer
- Lambda Node.js 24.x

Database:
- DynamoDB on-demand
- TTL enabled

Logs:
- short retention in dev
- reasonable retention in prod

## 9. AWS MCP / coding-agent usage

The hackathon requires proof of coding agent connection to AWS.

Use AWS Agent Toolkit / AWS MCP Server when available.

Codex:
```bash
codex mcp add aws-mcp --url https://aws-mcp.us-east-1.api.aws/mcp?oauth=initialize
```

Claude Code:
```bash
claude mcp add aws-mcp https://aws-mcp.us-east-1.api.aws/mcp --transport http
```

Do not request broader IAM than needed.

When performing AWS changes:
- prefer CDK changes committed to repo,
- use direct console/API changes only for investigation/bootstrap,
- reconcile any manual change back into CDK.

Maintain a lightweight development log under:
```text
docs/hackathon/AGENT_LOG.md
```

Record:
- date/time
- agent
- task
- AWS interaction
- resulting commit/PR
- proof screenshot reference if applicable

Do not place OAuth tokens or credentials in the log.

## 10. Git workflow

Preferred:
```text
feature/* -> pull request -> dev deploy -> main -> prod deploy
```

PR requirements:
- lint
- typecheck
- unit tests
- build
- `cdk synth`
- dev smoke test

Main:
- same validations
- prod deploy
- public web smoke
- API health smoke

Never force-push main.

## 11. Deployment credentials

GitHub Actions uses OIDC.

Never configure:
```text
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
```
as long-lived GitHub repository secrets.

Use:
- `GitHubDevDeployRole`
- `GitHubProdDeployRole`

Prod role trust must be narrower than dev.

## 12. Testing discipline

Before claiming a task complete:
```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm cdk:synth
```

If a command does not exist yet and you are bootstrapping, create it.

Do not state a test passed unless it was actually run.

## 13. Mobile caveats

### Expo Go
Do not use Expo Go as proof that full native behavior works.

Development build is needed for important capabilities such as:
- background location,
- current Expo Calendar implementation,
- remote notification behavior.

### Android step count
Do not implement "today's steps" solely using Expo Pedometer historical query. Historical `getStepCountAsync` is iOS-only.

Use the `StepSource` abstraction. Implement Health Connect Android path where feasible.

## 14. Privacy rules

Never send/store:
- calendar attendee email addresses,
- calendar descriptions/notes,
- auth token in logs,
- push token in logs,
- unbounded raw GPS history.

Before adding a field to context persistence, ask:
"Does the recommendation actually need this?"

## 15. AI rules

AI is used for contextual relevance/recommendation generation, not for absolute safety/anti-spam enforcement.

Hard guards remain deterministic.

Model output:
- schema constrained if possible,
- max 3 recommendations,
- no fabricated provider facts,
- only reference place IDs/routes supplied in model input,
- concise reason, not hidden reasoning.

## 16. Scenario Console delivery semantics

Production Scenario Console uses `deliveryMode="preview"`.

Preview:
- runs the same evaluation/providers/model,
- does not send a notification,
- does not increment daily notification quota,
- returns `wouldSuppress` delivery diagnostics instead of allowing a shared judge account to be blocked by dedup.

Do not add a public `force=true` switch that disables guards for real proactive delivery.

## 17. Scope-control rule

If you identify an improvement that is not required for the current milestone:
- add it to `docs/BACKLOG.md`,
- do not implement it unless it is very small and cannot jeopardize shipping.

## 18. Completion message format

At the end of each agent task, summarize:
1. what changed,
2. files changed,
3. tests run and results,
4. infrastructure impact,
5. any unresolved risk,
6. exact next recommended task.

Keep the summary factual.
