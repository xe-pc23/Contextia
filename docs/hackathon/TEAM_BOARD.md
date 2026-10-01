# Team Board — 次に進める担当タスク

司令塔は担当作業の検証後、`feature/coordination-plan` 上でこの表を更新する。担当ブランチではこのファイルを編集しない。詳細な作業内容と完了条件は[PHASED_IMPLEMENTATION.md](../PHASED_IMPLEMENTATION.md)を参照する。

| 担当 | 現在のブランチ | 次のフェーズ | 現在の次タスク | 状態 |
|---|---|---:|---|---|
| A | `feature/phase0-a-contracts-domain` | 0 | Zod契約と5 fixtureの形を作る | Dの共通足場を取り込んで着手可能 |
| B | `feature/phase0-b-providers` | 0 | provider portsと共通結果型を作る | Dの共通足場を取り込む。Aの契約型を確認後に統合 |
| C | `feature/phase0-c-web` | 0 | WebのVite/React足場を作る | Dの共通足場を取り込んで着手可能 |
| D | `feature/phase0-d-platform` | 0 | 共通足場を各レーンへ渡し、A/B/C/EのPhase 0成果を統合する | 足場検証済み・push済み `58ee2c9`。5コマンド、41テスト、dev/prod synth、dev限定diff、local/bundle smoke成功。AWSリソース変更なし |
| E | `feature/phase0-e-mobile` | 0 | Expo/TypeScript足場を作る | Dの共通足場を取り込んで着手可能 |

人間の担当者は未割当。プロジェクト所有者がデプロイを担当し、A/B/C/Eのレーンをメンバーへ割り振る。2026-10-01の共通足場の成果と開始手順は[Dの受け渡し資料](https://github.com/xe-pc23/Contextia/blob/feature/phase0-d-platform/docs/hackathon/PHASE0_HANDOFF.md)を参照する。

## フェーズゲート

| Phase | 状態 | 次へ進む条件 |
|---|---|---|
| 0 | Dの共通足場検証済み、A/B/C/E未完了 | 残り4レーンを取り込み、全レーンの型・build・5コマンド・CDK synth |
| 1 | 未着手 | dev/prodのstep-goal実経路とpreview再実行 |
| 2 | 未着手 | 5 fixture、Web全ケース、モバイル前景実機 |
| 3 | 未着手 | ネイティブ・通知・劣化耐性の検証 |
| 4 | 未着手 | 提出前の全体検証と本番smoke |

「担当Aを実装して」と指示されたら、Aの行と計画の該当Phaseを読み、Aの専有パス内で次タスクを進める。作業が複数コミットに分かれても、検証可能な区切りまで継続する。フェーズの全ゲートが未達なら次のPhaseを始めず、司令塔がこの表に成果・残作業・依存を更新する。

## GitHub共有状況

Phase 0の5ブランチと `feature/coordination-plan` は `origin` にpush済み。各担当者は自分のブランチを取得し、別worktree/checkoutで作業する。`main` はまだ計画を取り込んでいないため、実装PRの依存元は計画ブランチにする。

Dの足場（`58ee2c9`）は`origin/feature/phase0-d-platform`から取り込める。各担当のブランチで`git fetch origin`、`git merge origin/feature/phase0-d-platform`、`pnpm install --frozen-lockfile`を実行してから着手する。ルートlockfileの更新はDへ依頼する。Phase 0の足場だけをmain/prodへ統合しない。

AWSの両ローカルprofileは2026-10-01に設定リージョンとSTSのアカウントを読み取り確認済み。dev/prodへのデプロイ、CDK bootstrap、IAM変更は未実施。本番反映は所有者が検証済み`main`から手動起動する。
