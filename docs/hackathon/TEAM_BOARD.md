# Team Board — Phase 1を開始する担当タスク

司令塔は担当作業の検証後、`feature/coordination-plan` 上でこの表を更新する。担当ブランチではこのファイルを編集しない。作業内容・完了条件は [PHASED_IMPLEMENTATION.md](../PHASED_IMPLEMENTATION.md)、担当へそのまま渡す依頼文は [PHASE1_ASSIGNMENTS.md](./PHASE1_ASSIGNMENTS.md) を参照する。

2026-10-01: A–EのPhase 0を統合済み。実装基点 `d88d2bf`、引き継ぎとNode下限の修正 `b692b64`。全5コマンド・124テスト・dev/prod synthが成功し、成果物のない別checkoutでも再現した。Phase 1の全5ブランチは、調整資料を取り込んだ同じ共通基点を参照する。

| 担当 | 開始ブランチ | 次のPhase | 最初の仕事 | 状態 |
|---|---|---:|---|---|
| A | `feature/a-phase1-step-goal` | 1 | 決定的ガード、時計/timezone、preview診断、step-goal detectorと境界テスト | 着手可能。contracts・fixtureあり |
| B | `feature/b-phase1-live-providers` | 1 | Places V2・Open-Meteo・Bedrock・DynamoDB adapterと正規化/TTLテスト | 着手可能。7 ports固定、SDK依存はDへ要求 |
| C | `feature/c-phase1-console` | 1 | preview専用Consoleの入力編集・地図・認証・実応答表示 | 着手可能。React/Vite足場あり。API接続前は未接続を明示 |
| D／所有者 | `feature/d-phase1-evaluation-aws` | 1 | API評価service、JWT/CDK、Cognito、private S3/OAC、OIDC・smoke | 着手可能。共通型/portsあり。A/B統合後に縦断smoke。デプロイは所有者 |
| E | `feature/e-phase1-native-context` | 1 | development buildの認証・権限と前景GPS/カレンダー最小化試作 | 着手可能。Expo足場あり。実機とCognito設定が必要 |

人間の氏名は未割当。A/B/C/Eをメンバーへ渡し、Dの統合・AWSを所有者が担当する構成を用意した。各メンバーは別checkout/worktree・自分のAI会話で作業する。ルートlockfile・共通設定はDだけが更新する。各レーンは依存要求を最初にDへ伝え、相手の実装を待つ間は自分のテストdoubleや入力/UIを進める。

## フェーズゲート

| Phase | 状態 | 次へ進む条件 |
|---|---|---|
| 0 | 完了・検証済み | 同じ型で全workspace build、5コマンド、dev/prod synthを確認済み |
| 1 | 全5担当が開始可能 | dev/prodのstep-goal実経路、preview再実行、公開URL・認証済みsmoke |
| 2 | 未着手 | 5 fixture、Web全ケース、モバイル前景実機 |
| 3 | 未着手 | ネイティブ・通知・劣化耐性の検証 |
| 4 | 未着手 | 提出前の全体検証と本番smoke |

「担当Aを実装して」はAの行と計画のPhase 1を指す。担当パス内で検証できる区切りまで進め、依存があるsmokeは理由を記録する。Phase 1の統合ゲートが通るまでPhase 2を始めない。

## GitHub共有と統合

共通基点は `feature/phase0-d-platform` と [draft PR #1](https://github.com/xe-pc23/Contextia/pull/1)。Phase 0の既存5ブランチも同じ統合済み基点を参照する。新規作業は上表のPhase 1ブランチを取得して始める。

Phase 1の小さな担当PRは、当面 `feature/phase0-d-platform` をbaseにする。Aの契約/domain → Bのadapters → Dの評価/APIを統合し、C/Eを同じ契約と設定へ接続する。共通ブランチを更新したら各人はfetch/mergeで取り込む。Phase 0だけをmain/prodへ反映しない。Phase 1縦断sliceのdev smoke後にmain向け統合PRを作り、所有者がprod反映を起動する。

AWS targetはaccount `634512763705`、Region `ap-northeast-1`。bootstrap・dev/prod deploy・IAM変更は未実施。実行済みの検証・AWS証跡は [PHASE0_HANDOFF.md](./PHASE0_HANDOFF.md) と [AGENT_LOG.md](./AGENT_LOG.md) を参照する。
