# Phase 0 — 実装を割り振るための受け渡し

2026-10-01。Dの共通足場を`feature/phase0-d-platform`に実装した。デプロイはプロジェクト所有者が担当する。人間の担当者は未割当で、以下のレーンをメンバーへ割り振れる。

## 全員の開始手順

別checkoutまたはworktreeで自分の割当済みブランチを使い、**Dの足場を先に取り込む**。Aの例:

```bash
git fetch origin
git switch feature/phase0-a-contracts-domain
git merge origin/feature/phase0-d-platform
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm cdk:synth
```

Node.js 24.x、pnpm 10.29.3を使用する。`.node-version`は検証したローカル版。ルートのTypeScript設定はstrict、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`を有効化した。typecheckとtestはworkspaceのソースを参照するため、先にbuildを実行する必要はない。

## 割り振るタスク

| レーン | Phase 0で渡す仕事 | 編集する場所 | 依存・注意 |
|---|---|---|---|
| A | `API.md`に沿うZod request/response・列挙値・入力上限と異常値テスト、5 fixtureの形 | `packages/contracts`、`packages/domain`、`packages/test-fixtures` | まずcontractsを公開。domainのdetectorはPhase 1以降 |
| B | 7 provider portsと正規化結果・status型、SDK型を公開しない検証 | `packages/providers` | Aのcontractsが定まった部分から統合 |
| C | Vite/ReactのScenario Console足場。未接続を明示しcontractsをimportしてbuild | `apps/web` | ここにある空workspaceを置き換える。現時点でWeb画面はない |
| E | Expo/TypeScript足場、contracts import、development buildと権限の手順 | `apps/mobile` | ここにある空workspaceを置き換える。現時点でExpo/native buildはない |
| 所有者／D | 足場の取り込みと契約チェック、A→B→API統合、Phase 1のAWS/CDK・CI/CD | `apps/api`、`infra/cdk`、`packages/config`、ルート・lockfile | dev/prodデプロイは所有者が実行する |

A/B/C/Eの`src/index.ts`は空の足場であり、機能実装ではない。各担当が自分のファイルを置き換える。React/Vite/Expoなどの依存追加は先にDへ伝え、**ルートlockfileはDだけが更新**する。各workspaceで`tsconfig.json`はtypecheck用、`tsconfig.build.json`はbuild用。

テストは`apps`、`packages`、`infra`、`scripts`以下の`*.test.ts(x)`または`*.spec.ts(x)`をVitestが検出する。C/EのUIテスト環境・JSX設定は各担当が追加する。実providerや実機の検証は単体テストと分ける。

各AIには`AGENTS.md`の7文書と`PHASED_IMPLEMENTATION.md`を読み、「自分のレーンのPhase 0だけ」を依頼する。Phase 1は全5レーンの統合ゲート後に始める。

## APIとインフラの現在地

```bash
pnpm dev:api
# 別ターミナル
curl http://127.0.0.1:3001/health
```

`GET /health`は`{"status":"ok","version":"development"}`を返す。`BUILD_ID`を指定すればそのIDを返す。評価など他のルートは404で、推薦やprovider応答は生成しない。

```bash
pnpm cdk:synth
AWS_PROFILE=hackathon-dev pnpm cdk:diff:dev
```

- synthは`contextia-dev-core`と`contextia-prod-core`をそれぞれ`cdk.out/dev`、`cdk.out/prod`へ出力し、live lookupを行わない。
- diffはSTSで実account、環境またはprofileからRegionを検証し、**dev stackだけ**をtemplate比較する。changesetを作成しない。
- account `634512763705`、Region `ap-northeast-1`以外、不正stage・build IDは拒否する。生のCDK appでも`-c stage=dev`または`prod`が必須。
- 通常のscriptにはローカルprofile名を埋め込まない。OIDC環境からも同じ構成を使用できる。
- stackの足場はHTTP APIのhealth route、Node.js 24 Lambda、有限timeout、stage別ログ・IAM。Cognito、DynamoDB、private S3/OAC、Bedrock接続、CI/deploy scriptsはPhase 1の仕事。

今回はbootstrap、dev/prod deploy、IAMの実変更を実行していない。公開アプリ・dev live API smokeは未成立。AWS MCPツールがこのセッションにないため、AWSの読み取り確認はCLIで行い、MCP接続証跡は未取得。

詳細なAWS操作と検証は`AGENT_LOG.md`、実装記録は`docs/superpowers/plans/2026-10-01-phase0-platform.md`を参照する。
