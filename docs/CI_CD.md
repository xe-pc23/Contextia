# CI_CD.md — GitHub Actions and Environment Deployment

## 1. Objective

Create a simple, auditable pipeline:

```text
PR -> validate -> deploy DEV -> smoke
main -> validate -> human-triggered PROD deployment -> smoke
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

Only a release from validated `main` deploys it. The project owner starts the production job.

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
   +-- project owner starts PROD deployment
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

Production deployment is a manual GitHub Actions `workflow_dispatch` from `main`, started by the project owner after validation. If available for the repository, add a required reviewer to the `prod` environment as an additional gate.

## 5. AWS account, Region, and local profiles

Both stages use AWS account `634512763705` in `ap-northeast-1`. CDK creates separate `contextia-dev-*` and `contextia-prod-*` stacks/resources, including separate application data and auth resources. A different profile name alone does not isolate resources or IAM permissions.

| Stage | Local AWS CLI profile | Local use |
|---|---|---|
| `dev` | `hackathon-dev` | Routine implementation, verification, `cdk synth`, `cdk diff` for the dev stack, and dev deployment |
| `prod` | `hackathon-prod` | Project-owner pre-release prod diff, production deployment, and production incident investigation only |

Before the first deployment, verify each profile's account with `aws sts get-caller-identity --profile <profile> --query Account --output text` and Region with `aws configure get region --profile <profile>`. The expected values above were verified on 2026-10-01. Do not commit credentials or copy a local profile to teammates.

The CDK app must require an explicit stage, use separate stack IDs/resource names, and reject an unexpected account or Region before deployment. The dev diff command must select only dev stacks; avoid `cdk diff --all` for routine changes. Before starting a production release, the project owner reviews the prod-only diff locally with `hackathon-prod`. Local named profiles do not exist in GitHub Actions: workflows assume the stage-specific OIDC role below, so package scripts must not hardcode local profile names.

## 6. AWS authentication

Use GitHub OIDC.

Create:
- `GitHubDevDeployRole`
- `GitHubProdDeployRole`

These exact names are canonical across the documentation.

Trust conditions must restrict the repository.

Prod trust should only permit the expected main/environment subject.

Do not store long-lived AWS keys.

## 7. Permissions

Prefer CDK bootstrap deployment roles where possible.

If a custom deployment role is used, scope it to resources/stacks needed by the project.

Avoid a permanent human/agent `AdministratorAccess` policy merely for convenience.

During initial bootstrap a human may require broader rights, but runtime/deploy roles should be scoped.

## 8. Workflow commands

Canonical package scripts should exist:

```json
{
  "scripts": {
    "lint": "...",
    "typecheck": "...",
    "test": "...",
    "build": "...",
    "cdk:synth": "...",
    "cdk:diff:dev": "...",
    "deploy:dev": "...",
    "deploy:prod": "...",
    "smoke:dev": "...",
    "smoke:prod": "..."
  }
}
```

## 9. PR workflow outline

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

## 10. Production workflow outline

```yaml
name: prod

on:
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

concurrency:
  group: deploy-prod
  cancel-in-progress: false

jobs:
  validate:
    # Verify the selected ref is main, then run all required checks.
    ...

  deploy-prod:
    needs: validate
    environment: prod
    steps:
      - assume prod AWS role via OIDC
      - confirm AWS account 634512763705 and Region ap-northeast-1
      - record the prod-only CDK diff
      - pnpm deploy:prod
      - pnpm smoke:prod
```

Reject a dispatch from any ref other than `main`. A separate push-to-main workflow may run validation, but must not deploy production automatically.

## 11. CDK outputs

Output at least:
- API base URL
- User Pool ID
- User Pool Client ID
- CloudFront distribution URL
- Web bucket name (if pipeline needs it)
- CloudFront distribution ID (if separate content deployment)
- stage

Prefer generating client runtime config from outputs rather than manually copying values.

## 12. Static Web deployment

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

## 13. Rollback

Fast rollback:
- revert merge on main,
- project owner triggers the production workflow for the validated revert commit.

Keep each merge small.

For severe prod issue:
- disable problematic recommendation feature via config/feature flag if one exists,
- do not manually mutate many console resources.

## 14. Smoke test requirements

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

## 15. Agent development

Agents may:
- edit workflows,
- inspect failed Actions,
- use AWS MCP to inspect resources/logs,
- fix CDK.

Agents must not:
- paste AWS credentials into workflow,
- widen prod IAM without reason,
- bypass failing tests simply to get green status.

## 16. Required repository protections

If practical:
- main requires PR.
- required `validate` check.
- no direct force pushes.
- secret scanning enabled.
- Dependabot optional.

Do not spend hours on governance if it threatens shipping.
