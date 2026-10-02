# CI_CD.md — GitHub Actions and Environment Deployment

## 1. Objective

Create a simple, auditable pipeline:

```text
PR -> validate -> owner starts DEV deployment -> smoke
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

Implemented in Phase 2-D: BucketDeployment inside `contextia-{stage}-core`; credential-free `validate.yml` runs lint, typecheck, tests, build, then dev/prod synth. `deploy.yml` is owner-triggered, repeats validation/build at the same SHA, assumes the selected OIDC role, deploys one stack, and runs public smoke. All external actions use verified commit SHAs. The GitHub credential used to publish this branch must allow workflow changes; the existence of these files does not prove a successful Actions run or AWS deployment.

### Owner bootstrap and parameters

Before the first deployment, the owner must create the account's GitHub OIDC provider (`token.actions.githubusercontent.com`, audience `sts.amazonaws.com`) and protect the GitHub environments. **Prod environment deployment branches must allow only `main`**; require owner review where available. GitHub's environment OIDC subject omits the branch, so this environment setting is essential in addition to the workflow and script main checks. Dev trust allows only this repository's dev environment or feature branch subjects; prod trust accepts only `repo:xe-pc23/Contextia:environment:prod`.

Core stacks now use separate CDK bootstrap qualifiers: `ctiadev` and `ctiaprod`. The owner bootstraps both in `634512763705/ap-northeast-1` with stage-appropriate CloudFormation execution policies and inspects the change before deployment. Existing `hnb659fds` bootstrap resources are not reused or modified automatically. Each GitHub role can assume only its stage's CDK deploy/file-publishing roles and read that stage's core outputs. Initial core deployment is performed by the owner because it creates the GitHub roles themselves. No bootstrap or IAM change has been performed by D.

Set these non-secret GitHub environment variables (or local shell variables for owner commands):

| Variable | Purpose |
|---|---|
| `BEDROCK_MODEL_ID` | Enabled model or inference profile ID |
| `BEDROCK_REGION` | Region for Converse, default `ap-northeast-1` |
| `BEDROCK_MODEL_RESOURCES` | Comma-separated exact foundation-model/profile ARNs. Include required destination model ARNs for cross-region profiles. Wildcards rejected |
| `MAP_KEY_EXPIRE_TIME` | Future UTC timestamp, `YYYY-MM-DDTHH:MM:SSZ`. Rotate before expiry |

`pnpm deploy:dev` / `pnpm deploy:prod` verify STS account and Region, require deploy parameters, and set `BUILD_ID` to the actual Git HEAD. A supplied build marker must equal HEAD. Prod accepts only a manual main workflow, or the owner's local main checkout. Review `pnpm cdk:diff:dev` / `pnpm cdk:diff:prod` first. No script hardcodes a local AWS profile. Synth stays credential-free and does not need parameter values.

### Smoke commands

After deployment, run `BUILD_ID=<deployed-sha> SMOKE_OUTPUTS_FILE=cdk.out/dev/outputs.json pnpm smoke:dev` (or prod). The output file is generated by deploy and ignored by Git. Alternatively supply `SMOKE_API_URL` and `SMOKE_WEB_URL`. Public smoke checks HTTPS web/config/JavaScript assets, matching stage/API/build SHA, health, and unauthenticated rejection on `/v1/me`.

For controlled authenticated smoke, supply `SMOKE_ACCESS_TOKEN` and `SMOKE_SECOND_USER_ACCESS_TOKEN` for distinct test users through the owner's shell/session. Never paste tokens into commands recorded in logs or commit them. The script moves fixture timestamps into a near-future live planning window while preserving event gaps. It validates all five preview responses, replay with the same UUID key and fresh requestId, real transit-provider readiness, owned details, and another user's 404; it fails if no recommendation exists to test ownership. It does not print bodies or tokens. With no tokens, it explicitly reports that authenticated smoke was not run.

The script does not read DynamoDB notification counters or exercise native delivery. Before claiming the dev gate, the owner additionally verifies preview quota/anchor invariance in the table and chat with the completed B adapter. Weather can validly be silent under live weather; deterministic fixture rain is not proof of live conditions. B's missing Phase 2 adapters currently prevent the authenticated gate. Public smoke alone is not a Phase 2 completion claim.

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
