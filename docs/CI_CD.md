# CI_CD.md — GitHub Actions and Environment Deployment

## 1. Objective

Create a simple, auditable pipeline:

```text
PR -> validate -> deploy DEV -> smoke
main -> validate -> deploy PROD -> smoke
```

No staging environment.

## 2. Why two environments

### dev
Purpose:
- integration testing,
- agent-generated changes,
- PR validation.

Allowed to be overwritten.

### prod
Purpose:
- hackathon public URL,
- judge evaluation,
- stable demo.

Only `main` deploys it.

## 3. Branch workflow

```text
feature/foo
   |
   | open PR
   v
PR checks
   |
   +-- static checks
   +-- unit tests
   +-- CDK synth
   +-- DEV deployment
   +-- live smoke
   |
   | merge
   v
main
   |
   +-- validation
   +-- PROD deployment
   +-- prod smoke
```

## 4. GitHub Environments

Create:
- `dev`
- `prod`

Store environment-specific non-AWS-secret configuration such as:
- demo test username where appropriate
- public API URLs after bootstrap if not read from CDK outputs
- test configuration

For prod, optionally enable GitHub environment protection/reviewer if it does not slow the hackathon too much. The selected behavior is automatic `main -> prod`, so manual approval is optional, not required.

## 5. AWS authentication

Use GitHub OIDC.

Create:
- `GitHubDevDeployRole`
- `GitHubProdDeployRole`

Trust conditions must restrict the repository.

Prod trust should only permit the expected main/environment subject.

Do not store long-lived AWS keys.

## 6. Permissions

Prefer CDK bootstrap deployment roles where possible.

If a custom deployment role is used, scope it to resources/stacks needed by the project.

Avoid a permanent human/agent `AdministratorAccess` policy merely for convenience.

During initial bootstrap a human may require broader rights, but runtime/deploy roles should be scoped.

## 7. Workflow commands

Canonical package scripts should exist:

```json
{
  "scripts": {
    "lint": "...",
    "typecheck": "...",
    "test": "...",
    "build": "...",
    "cdk:synth": "...",
    "deploy:dev": "...",
    "deploy:prod": "...",
    "smoke:dev": "...",
    "smoke:prod": "..."
  }
}
```

## 8. PR workflow outline

```yaml
name: pr

on:
  pull_request:

permissions:
  contents: read
  id-token: write

concurrency:
  group: deploy-dev
  cancel-in-progress: false

jobs:
  validate:
    steps:
      - checkout
      - setup node
      - setup pnpm
      - pnpm install --frozen-lockfile
      - pnpm lint
      - pnpm typecheck
      - pnpm test
      - pnpm build
      - pnpm cdk:synth

  deploy-dev:
    needs: validate
    environment: dev
    steps:
      - configure AWS credentials from OIDC
      - pnpm deploy:dev
      - pnpm smoke:dev
```

Exact action versions must be pinned/current when implemented.

## 9. Main workflow outline

```yaml
name: prod

on:
  push:
    branches: [main]

permissions:
  contents: read
  id-token: write

concurrency:
  group: deploy-prod
  cancel-in-progress: false

jobs:
  validate:
    ...

  deploy-prod:
    needs: validate
    environment: prod
    steps:
      - assume prod AWS role via OIDC
      - pnpm deploy:prod
      - pnpm smoke:prod
```

## 10. CDK outputs

Output at least:
- API base URL
- User Pool ID
- User Pool Client ID
- CloudFront distribution URL
- Web bucket name (if pipeline needs it)
- CloudFront distribution ID (if separate content deployment)
- stage

Prefer generating client runtime config from outputs rather than manually copying values.

## 11. Static Web deployment

Two acceptable implementations:

### Option A — CDK BucketDeployment
CDK deploy packages `apps/web/dist`.

Pros:
- simple single deploy.

Cons:
- infrastructure deploy required for content update.

### Option B — pipeline sync
CDK owns bucket/distribution, workflow does:
- `aws s3 sync`
- CloudFront invalidation.

For the hackathon either is valid. Choose one and keep it consistent.

Recommended initial: **BucketDeployment** for fewer workflow steps.

## 12. Rollback

Fast rollback:
- revert merge on main,
- pipeline redeploys previous code.

Keep each merge small.

For severe prod issue:
- disable problematic recommendation feature via config/feature flag if one exists,
- do not manually mutate many console resources.

## 13. Smoke test requirements

Dev/prod:
- Web root responds.
- `/health` responds.
- static JS loads.

Dev authenticated smoke:
- authenticate test user.
- run one fixture.
- response conforms to schema.

Prod:
- at least health/public page automatically.
- authenticated full scenario can be a controlled pre-submission test to avoid credentials in CI where not needed.

## 14. Agent development

Agents may:
- edit workflows,
- inspect failed Actions,
- use AWS MCP to inspect resources/logs,
- fix CDK.

Agents must not:
- paste AWS credentials into workflow,
- widen prod IAM without reason,
- bypass failing tests simply to get green status.

## 15. Required repository protections

If practical:
- main requires PR.
- required `validate` check.
- no direct force pushes.
- secret scanning enabled.
- Dependabot optional.

Do not spend hours on governance if it threatens shipping.
