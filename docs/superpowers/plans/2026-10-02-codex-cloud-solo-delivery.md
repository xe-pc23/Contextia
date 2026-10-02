# Codex Cloud Solo Delivery Implementation Plan

> **For agentic workers:** Execute this plan task by task. Ultra may delegate independent, non-overlapping implementation or review work, but the primary agent owns integration, the root lockfile, phase gates, and the final report. Read `AGENTS.md` and its seven required documents before editing implementation code.

**Goal:** Let one owner use Codex Cloud to integrate the existing work and ship Contextia through Phase 4 without losing the specification or release gates.

**Architecture:** Keep the existing pnpm workspace and contracts → domain/providers → API → Web/Mobile dependency flow. Use GitHub branches and small reviewable PRs as durable state. GitHub Actions assumes stage-specific AWS roles through OIDC; production deployment remains an owner-triggered action from validated `main`.

**Tech Stack:** Node.js 24.13.1, pnpm 10.29.3, strict TypeScript, Zod, React/Vite, Expo development builds, AWS CDK, Lambda, DynamoDB, Cognito, Amazon Location, Bedrock, GitHub Actions.

**Spec:** `docs/SPEC.md`, `docs/API.md`, `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`, `docs/PHASED_IMPLEMENTATION.md`, `docs/TEST_STRATEGY.md`, `docs/DEMO.md`.

## Global constraints

- `SPEC.md` takes precedence over API/data model, then architecture, then implementation details. Report conflicts rather than inventing behavior.
- Use `contextia-{stage}-*` resources in AWS account `634512763705`, Region `ap-northeast-1`; keep `dev` and `prod` separate.
- Keep `deliveryMode="preview"` on the Scenario Console. Preview evaluates normally but sends no notification and consumes no daily quota.
- Use the existing Zod contracts and provider ports. Never commit credentials or put long-lived AWS access keys in GitHub secrets.
- A passing offline test suite is not proof of live AWS, a public URL, or native behavior. Record each gate against a commit SHA.
- Do not merge an incomplete Phase 0-only artifact to `main` or deploy it to `prod` as the finished application.

## Snapshot to reconcile before Cloud execution

This is a **2026-10-02 local Git snapshot**, not a claim about current GitHub PR status. Fetch and inspect the remote again when the Cloud task starts.

- `main` at `7f99ff3` contains the specification, not the application implementation.
- `origin/feature/phase0-d-platform` at `46c821a` includes the Phase 0 base and merged domain work.
- `origin/codex/d-phase2-integration` at `6a588cb` includes the Phase 2 A/B/D integration and Phase 1 Web/Mobile baseline. In a fresh isolated checkout on 2026-10-02, frozen installation plus lint, typecheck, 879 tests, build, and offline CDK synth passed on this SHA. Remote CI and live smoke still need verification.
- `origin/feature/c-phase2-console` and `origin/feature/e-phase2-foreground-app` are separate from that integration branch. Merge and verify them before claiming a unified Phase 2 app.
- No AWS deploy, public production URL, native device validation, or live provider smoke is established by this snapshot. Codex-to-AWS MCP STS inspection is logged; the requested proof screenshot remains outstanding.

## Task 1 (owner): Publish a usable Codex Cloud environment

**Deliverable:** A published Cloud environment attached to `xe-pc23/Contextia`, and one Cloud task whose setup report shows the five required checks on the intended source branch.

The owner creates and publishes the Cloud environment. The remaining tasks are repository work that Codex can prepare and execute from that environment.

- [ ] Connect the GitHub repository in **Work in → Cloud → Create environment**. Do not use `main` as the implementation baseline while it remains specification-only; select or explicitly start from the latest integration branch and record its SHA.
- [ ] Configure Node.js `24.13.1` and pnpm `10.29.3`, matching `.node-version`, `.mise.toml`, and `package.json`. The Cloud setup should run `pnpm install --frozen-lockfile` and use package-manager network access for dependencies.
- [ ] In setup, run `node --version`, `pnpm --version`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm cdk:synth`. Treat a missing runtime or failed command as setup work, not as a passed check. `cdk:synth` is offline and does not require AWS credentials.
- [ ] Keep AWS credentials out of the environment. For live AWS calls, prefer the GitHub Actions OIDC roles already defined by the repository workflow. Add only the required non-secret model/stage configuration and allowed network destinations when a task needs them.
- [ ] Publish the environment after reviewing its setup report. In the new Cloud task, choose an Ultra-capable model and **Ultra** if the account offers it. Ultra is a per-task model setting; a repository file cannot enable account access to it.
- [ ] Commit or PR important code at each slice. Do not rely on the Cloud VM's saved state as source control.

**Verification:** The published environment is selectable for a new task; that task reports the chosen branch SHA, Node/pnpm versions, and actual results of all five commands. If the branch cannot be selected, publish from the repository and explicitly verify the task checkout before editing.

## Task 2: Reconcile the implementation branches

**Deliverable:** One integration branch/PR containing the Phase 2 A/B/C/D/E work, with no lost contract, provider, Web, or Mobile changes.

- [ ] Fetch the remote and inspect PR/branch heads, bases, CI status, worktree changes, and the Phase 1/2 gate evidence. Avoid assuming the snapshot above is still current.
- [ ] Start an isolated branch from the most recent validated integrated implementation. Incorporate `feature/c-phase2-console` and `feature/e-phase2-foreground-app` one at a time; resolve conflicts in shared contracts and UI against `SPEC.md` and `API.md`.
- [ ] Validate the Web's five editable presets and `wouldSuppress` display, the API's five detector/provider paths, and the Mobile foreground context → API contract using targeted tests. Keep fixture provider responses out of production flows.
- [ ] Run the five repository commands after integration. Add a failing test before fixing any concrete regression discovered during the merge.
- [ ] Open or update a small integration PR, record the exact head SHA and tests, and leave live AWS/native gates explicitly open until observed.

**Verification:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm cdk:synth` pass on the integrated SHA; the Web and Mobile branches are ancestors of that SHA or their changes are otherwise reviewed in the diff.

## Task 3: Close Phase 1 and Phase 2 live gates

**Deliverable:** A real dev evaluation for `STEP_GOAL_REST`, then five scenarios, plus a public production path and at least one verified foreground device path.

- [ ] Confirm AWS account/Region and the dev-only CDK diff. Have the owner provision or verify bootstrap, `GitHubDevDeployRole`, `GitHubProdDeployRole`, GitHub `dev`/`prod` environments, Bedrock model access, and the non-secret workflow variables. Check that prod trust is narrower than dev.
- [ ] Let the validated GitHub Actions workflow deploy `dev` with OIDC. Run `/health`, Cognito login, real Places + Bedrock step-goal preview, and the same preview twice; verify the second result remains visible, reports dedup in `wouldSuppress`, and does not consume notification quota.
- [ ] Exercise all five cases through the same API with their required live providers, including a provider failure. Confirm no fabricated weather or transit times and no cross-user access to recommendation detail/chat.
- [ ] Integrate the Phase 2 Web and Mobile runtime configuration generated from CDK outputs. On an available iOS or Android development build, verify foreground GPS and calendar → API → result. Record device, OS, build, stage, and backend SHA; mark the other OS unverified if unavailable.
- [ ] Merge the validated integrated PR to `main` only after the required dev evidence. The owner starts the production workflow manually from `main`; record public Web, `/health`, and authenticated Scenario Console smoke results.

**Verification:** `docs/DEMO.md` Ship Gate evidence references a deployed SHA and URL. A screenshot/recording alone does not substitute for live application checks.

## Task 4: Complete Phase 3 behavior

**Deliverable:** Native and remote notification behavior, device registration, failure tolerance, and Web interaction tests defined in `docs/PHASED_IMPLEMENTATION.md`.

- [ ] Implement and test `/devices`, push-token rotation/deletion, Expo Push/SNS adapters, notification idempotency, and account cleanup without logging tokens.
- [ ] Implement iOS Pedometer and the feasible Android Health Connect `StepSource`; keep low-confidence fallback explicit. Add opportunistic background callbacks without promising exact five-minute execution.
- [ ] Complete recommendation feed/follow-up, local notification deduplication, permission/provider health, Japanese Web states, map/coordinate synchronization, and Playwright checks.
- [ ] Test DynamoDB and Bedrock failures, partial provider failures, preview versus proactive delivery, and duplicate recommendation IDs.
- [ ] Run the five commands. Record iOS and Android development-build device checks separately; leave an unavailable OS open, rather than treating JS export as native proof.

**Verification:** The Phase 3 gate in `docs/PHASED_IMPLEMENTATION.md` and the real-device table in `docs/TEST_STRATEGY.md` are backed by actual results and SHA/build identifiers.

## Task 5: Phase 4 submission audit

**Deliverable:** A reproducible live app, completed evidence table, and a factual list of any remaining failures.

- [ ] Re-run the five commands on the release SHA; compare contracts, five fixtures, guards, and model references against `SPEC.md`.
- [ ] Run minimal live dev provider and Bedrock schema smoke. Check stage/model IDs from environment configuration only.
- [ ] Verify dev/prod OIDC trust, private S3 and CloudFront OAC, CloudWatch logs/metrics, stage separation, and AWS MCP evidence in `docs/hackathon/AGENT_LOG.md` without exposing credentials.
- [ ] The owner deploys production manually from validated `main`. Open the public URL in a private browser window, sign in as the judge account, edit coordinates, run a real scenario, and check the response. Codex Cloud's built-in browser/computer use is unavailable, so record this check from a local browser or another verified environment.
- [ ] Complete the iOS/Android development-build table, judge instructions, production URL, deployment SHA, and `docs/DEMO.md` Ship Gate. Label any unavailable device or failed live service honestly.

**Verification:** Each Ship Gate item has a date, SHA, environment, result, and evidence reference. Submit only after the live AWS, public URL, and judge-access gates are true.

## Cloud task handoff prompt

Use this as the first Ultra task after the environment is published:

> Contextiaを一人でPhase 4まで仕上げます。まず `AGENTS.md` と `docs/superpowers/plans/2026-10-02-codex-cloud-solo-delivery.md`、指定の7文書を読んでください。リモートの最新状態を調べ、Phase 2統合ブランチとWeb/Mobileの別ブランチを検証可能な小さなPRへ統合してください。各変更で契約・テスト・dev/prod分離を守り、5コマンドの実結果を報告してください。Ultraの並列作業は独立したパスに限定し、統合・lockfile・フェーズ判定は主担当が行ってください。AWS/実機/本番ゲートは未確認なら未確認と明記し、可能なコード・テスト・CDK・CI作業は止めずに進めてください。最初にcheckoutしたブランチとSHAを報告してください。

## Owner actions that Cloud cannot infer

- Sign in to ChatGPT/GitHub and publish the Cloud environment with the intended repository and branch.
- Supply or approve only the required AWS OIDC trust/permissions, Bedrock model access, and non-secret stage settings. Do not paste AWS keys into the repository or Cloud prompt.
- Trigger the production GitHub Actions workflow from validated `main` and perform the private-browser judge check.
- Run development builds on real iOS/Android devices and record the results. The code and JS export can be prepared in Cloud, but native proof requires devices.

## Review focus

1. Cloud starts from specification-only `main` and silently loses the implementation: report branch/SHA before editing, then prove ancestry after integration.
2. Web preview accidentally changes delivery quota: repeat the same live preview and inspect both diagnostics and persisted state.
3. A missing provider becomes a fabricated route/weather fact: test unavailable and timeout responses while preserving other candidates.
4. A shared judge account can read another user's details or chat: test JWT ownership boundaries.
5. Native success is inferred from Expo Go or JS export: require a development build and a device/OS/build record.
