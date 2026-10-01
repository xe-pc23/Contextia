# Phase 0 — 共通基点と割り振り準備

2026-10-01。A–EのPhase 0を統合し、全レーンが同じ契約でbuildできる状態を確認した。共通基点は `feature/phase0-d-platform`、レビュー用は [draft PR #1](https://github.com/xe-pc23/Contextia/pull/1)。実装の検証基点は `d88d2bf`。デプロイはプロジェクト所有者が担当する。

担当者へ渡すブランチ・依頼文・完了条件は [PHASE1_ASSIGNMENTS.md](./PHASE1_ASSIGNMENTS.md) にまとめた。人間の氏名は未割当だが、全5レーンがPhase 1の独立作業を開始できる。Phase 0ブランチは成果の共有用とし、新規作業はPhase 1ブランチで行う。

## 統合済みの成果

| レーン | 完了したPhase 0 | 主な場所 |
|---|---|---|
| A | v1 Zod request/response、共通列挙値、入力制限・privacy検証、5シナリオの入力/provider fixture | `packages/contracts`、`packages/test-fixtures` |
| B | Places / Geocoding / Weather / Routes / RecommendationModel / StateRepository / NotificationProviderの7 ports | `packages/providers/src/ports` |
| C | contractsをimportするReact/Viteの未接続画面、開発・production build | `apps/web` |
| D | strict pnpm workspace、5検証scripts、health API、dev/prod CDK、依存とlockfileの統合 | ルート、`apps/api`、`infra/cdk`、`packages/config` |
| E | contractsをimportするExpo development-client足場、iOS/Android JS export、development build手順 | `apps/mobile` |

Model outputと公開応答は最大3件・notify/silent整合性を検証する。provider portsはSDK型を公開せず、正規化されたstatusとデータを返す。保存するplaceにはStorage intentを要求し、previewは通知枠更新portへ渡せない。これらは契約と型の検証であり、live adapterや通知動作の検証ではない。

## 全員の開始手順

メンバーごとに別checkoutまたはworktreeを使う。Aの例:

```bash
git fetch origin
git switch --track origin/feature/a-phase1-step-goal
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm cdk:synth
```

すでにローカルブランチがあれば `git switch feature/a-phase1-step-goal` を使い、他人の変更を上書きしない。検証環境はNode.js 24.13.1、pnpm 10.29.3。Nodeの下限は24.3.0。typecheckとtestはソースを参照するため、先にbuildする必要はない。

依存追加はDへ要求し、ルート設定・lockfileはDだけが更新する。fixtureのmock provider応答はテスト専用。Web presetは `getScenarioInput` の入力だけを読み、固定の推薦やmock provider結果を製品経路へ渡さない。

## 開発と検証の結果

```bash
pnpm dev:api
pnpm dev:web
pnpm dev:mobile
```

上記は別ターミナルで実行する。APIは `http://127.0.0.1:3001/health`、Webは `http://127.0.0.1:5173`、MobileはMetroとdevelopment clientを使用する。MobileのOS別セットアップは [README](../../apps/mobile/README.md) を参照する。

- lint、typecheck、124件のtest、全workspace build、dev/prod CDK synthが成功。
- `git archive d88d2bf` の新しいcheckoutでも、既存build出力なしのfrozen installから同じ5コマンドが成功。
- Webのブラウザ起動と未接続表示を確認。consoleのwarning/errorなし。
- ExpoはiOS/AndroidのJavaScript/Hermes assetsをexportし、dev/prodのname・scheme・application ID分離を確認。APK/IPA compileや実機動作は未検証。
- 独立したread-only reviewでCritical/Importantの残課題なし。Node下限とPOSIXコマンドの前提を明記済み。

## API・AWSの現在地

`GET /health` は `{"status":"ok","version":"development"}` を返し、`BUILD_ID` でversionを指定できる。他のルートは未実装。認証・detector・評価・live provider・履歴・通知・地図は次フェーズの仕事。

`pnpm cdk:synth` は `contextia-dev-core` と `contextia-prod-core` を別出力へoffline synthする。足場にはHTTP APIのhealth route、Node.js 24 Lambda、有限timeout、stage別ログ/IAMがある。対象accountは `634512763705`、Regionは `ap-northeast-1`。

`AWS_PROFILE=hackathon-dev pnpm cdk:diff:dev` はSTS/account/Regionを確認してdevだけをtemplate比較する。changesetを作らない。bootstrap、deploy、IAM変更は今回実行していない。Cognito・DynamoDB・private S3/OAC・OIDCはD Phase 1で実装する。

公開URLとlive API smokeは未成立。AWS MCPツールがこのセッションにないため接続証跡は未取得。詳細は [AGENT_LOG.md](./AGENT_LOG.md)。`main` とprodへPhase 0だけを反映しない。

次は5担当がPhase 1を開始し、A/Bの成果をDが接続する。devのstep-goal縦断smokeを通してから所有者がリリースを判断する。
