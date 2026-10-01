# Phase 0 共通の足場 — 実装記録

**Goal:** A/B/C/Eの担当者が独立して実装を始め、同じ5コマンドで検証できる足場を作る。

**Architecture:** pnpm workspaceとstrict TypeScriptを共通化する。Phase 0のAPIは公開`/health`のみ。CDKは明示stage、期待account/Regionの検証、dev/prod別stack・Lambda・ログを提供する。

**Tech Stack:** Node.js 24、pnpm 10、TypeScript、Zod、Vitest、ESLint、esbuild、AWS CDK。

**Spec:** `docs/PHASED_IMPLEMENTATION.md`のD・Phase 0、および`SPEC.md`・`API.md`・`ARCHITECTURE.md`。

## Constraints

- account `634512763705`、Region `ap-northeast-1`。
- stageは`dev`/`prod`を明示。通常のAWS調査は`hackathon-dev`。
- 本番の反映は所有者が担当する。今回はbootstrap/deployを実行しない。
- A/B/C/Eには空のworkspaceだけを渡す。製品の契約、provider、画面、detectorは各担当のPhase 0で実装する。
- SDK型をdomainへ渡さず、秘密・個人context・tokenをログに出さない。

## Tasks

- [x] workspace、共通scripts、lint/typecheck/test/build設定、各空workspace、lockfileを作る。
- [x] stageの未指定、不正値、別account/Regionを拒否する設定テストをRED→GREENで実装する。
- [x] `/health`のレスポンス、404、ログ最小化テストをRED→GREENで実装する。
- [x] CDK assertionでNode.js 24、HTTP APIのhealthルート、有限timeout、dev/prod命名・ログ保持をRED→GREENで検証する。
- [x] 5コマンド、dev限定diffとdev profileの読み取り確認を実行する。
- [x] 実装レビュー、担当別の開始手順、AWS操作・残作業を記録して共有可能なcommitにまとめる。

## Review focus

- 明示stageがない、またはaccount/Regionが違う操作を受け付けない。
- dev diffがprodを選択しない。ローカルprofileをscriptsへ固定しない。
- healthが依存providerへ接続せず、秘密を返さない。
- clean checkoutから共通5コマンドを実行できる。
- Phase 0の足場を完成アプリやnative build済みと表示しない。

## Progress

- 7文書と分担計画を読了。既存テスト・package.jsonなし。
- 利用者から「デプロイは自分の担当。割り振りに必要なタスクを実行」の指示を受け、全員の先行依存であるD・Phase 0を対象にする。
- native worktreeは書込許可範囲外のため空のままarchive。現在のcheckoutの割当済み`feature/phase0-d-platform`で作業する。
- テスト31件とCDK command選択10件を未実装stubで失敗確認した後、実装して全41件成功。
- dev実差分でCDK既定の広いログ用managed policyを確認。専用ロググループへの書込みだけを許すroleへ変更し、2件のCDK assertionのRED→GREENを確認。
- `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm cdk:synth`は成功。`pnpm install --frozen-lockfile --offline`も成功。
- `tsx` CLIのIPCがsandboxで拒否されたため、`node --import tsx`を使用しsynth成功。scriptの使い方は同じ。
- ローカルHTTP health 200・未実装ルート404、build済みLambda bundleのhealthを確認。ローカルserverは検証後に停止。
- 方針: Phase 0の足場のみ実装し、Cognito/DynamoDB/S3/OAC・deploy workflowは計画どおりPhase 1に残す。製品仕様の変更なし。
- 独立reviewerが`21ce011..9231506`を読み取りレビュー。Critical/Importantなし。MinorのAPI package exportを実際の`dist/handler`へ修正し、package importの失敗→成功を確認。追加の未解決指摘なし。
- reviewerが範囲外とした本体contracts/detectors/providers/clients、Phase 1のJWT・永続化・Web hosting・CI/deploy、live/native/MCPは計画どおり後続担当へ残す。既存`.DS_Store`は対象外。
- `git archive`から作ったbuild成果物なしのcheckoutで、Node.js 24とfrozen/offline install→5コマンド→41テスト→両stage synthを成功確認。最終export修正後の作業checkoutでも5コマンドを再実行し成功。
- 生成した足場の末尾空行を正規化し、差分のwhitespace警告を解消。
- 共有: Dブランチをpushし[PR #1](https://github.com/xe-pc23/Contextia/pull/1)を計画ブランチ宛てdraftで作成。分担表は指定どおり`feature/coordination-plan`の`4a1480b`で更新・pushし、その更新をDへ取り込んだ。main/prod反映なし。
