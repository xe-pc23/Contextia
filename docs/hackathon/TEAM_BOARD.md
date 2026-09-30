# Team Board — 次に進める担当タスク

司令塔は担当作業の検証後、`feature/coordination-plan` 上でこの表を更新する。担当ブランチではこのファイルを編集しない。詳細な作業内容と完了条件は[PHASED_IMPLEMENTATION.md](../PHASED_IMPLEMENTATION.md)を参照する。

| 担当 | 現在のブランチ | 次のフェーズ | 現在の次タスク | 状態 |
|---|---|---:|---|---|
| A | `feature/phase0-a-contracts-domain` | 0 | Zod契約と5 fixtureの形を作る | 着手可能。共通scriptsでの検証はDの足場待ち |
| B | `feature/phase0-b-providers` | 0 | provider portsと共通結果型を作る | Aの契約型を確認後に統合 |
| C | `feature/phase0-c-web` | 0 | WebのVite/React足場を作る | 着手可能。workspaceへの統合はDの足場待ち |
| D | `feature/phase0-d-platform` | 0 | pnpm workspace、共通scripts、CDK/API足場を作る | 着手可能。最初の統合commitを共有する |
| E | `feature/phase0-e-mobile` | 0 | Expo/TypeScript足場を作る | 着手可能。workspaceへの統合はDの足場待ち |

## フェーズゲート

| Phase | 状態 | 次へ進む条件 |
|---|---|---|
| 0 | 未完了 | 5レーンの型・build・5コマンド・CDK synth |
| 1 | 未着手 | dev/prodのstep-goal実経路とpreview再実行 |
| 2 | 未着手 | 5 fixture、Web全ケース、モバイル前景実機 |
| 3 | 未着手 | ネイティブ・通知・劣化耐性の検証 |
| 4 | 未着手 | 提出前の全体検証と本番smoke |

「担当Aを実装して」と指示されたら、Aの行と計画の該当Phaseを読み、Aの専有パス内で次タスクを進める。作業が複数コミットに分かれても、検証可能な区切りまで継続する。フェーズの全ゲートが未達なら次のPhaseを始めず、司令塔がこの表に成果・残作業・依存を更新する。

## GitHub共有状況

Phase 0の5ブランチと `feature/coordination-plan` はローカルに作成済み。GitHubへのpushは自動承認審査で保留中。公開許可が得られたら司令塔がpushし、担当者に取得方法を共有する。
