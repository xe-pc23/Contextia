# Contextia フェーズ別実装計画（5人・5 AIセッション）

> **実装担当者へ:** 人間のメンバーを各レーンの責任者とする。AIには一度に「自分のレーンの1フェーズ」だけを依頼し、各タスクをテスト・レビュー可能なPRにする。実装前に `AGENTS.md` と指定された7文書を読む。

**Goal:** 仕様 v1.1 を、5人がファイル競合を抑えて段階的に実装し、公開URLで動くWeb Scenario Consoleと実機モバイルを完成させる。

**Architecture:** `packages/contracts` を先に固定し、domain → provider ports/adapters → API composition → Web/Mobile の依存方向を守る。WebとMobileは同じ `/v1/context/evaluate` を使い、シミュレーションだけ `deliveryMode="preview"` にする。

**Tech Stack:** TypeScript、pnpm workspaces、Zod、React/Vite、Expo、Lambda Node.js 24.x、CDK、DynamoDB、Cognito、Amazon Location、Open-Meteo、Bedrock。

**Spec:** [SPEC.md](./SPEC.md)、[API.md](./API.md)、[DATA_MODEL.md](./DATA_MODEL.md)。優先順位は [AGENTS.md](../AGENTS.md) に従う。この文書は実装順と担当境界を決めるもので、機能仕様を変更しない。

## 全フェーズ共通の制約

- AWSはアカウント `634512763705`、リージョン `ap-northeast-1`。`dev`/`prod` は同一アカウント・リージョン内の別stack/リソース/データとして論理分離する。profile名だけを分離の根拠にしない。
- 通常の実装、検証、CDK synth、dev stackの`cdk diff`とdevデプロイは `hackathon-dev` を使う。`hackathon-prod` はプロジェクト所有者が本番差分を確認し、反映する時だけ使う。GitHub ActionsはローカルprofileでなくOIDC roleを使う。
- 本番は検証済み`main`からプロジェクト所有者が手動でデプロイを起動する。担当AIはprodを自動反映しない。詳細は[CI_CD.md](./CI_CD.md)。
- `dev` と `prod` を分離し、AWSリソース名は `contextia-{stage}-...`。本番S3は非公開でCloudFront OACを使う。
- domainからAWS SDKを直接呼ばない。外部入力とBedrock出力はZodで検証する。`any`、秘密情報のコミット、偽の交通時刻・天気を禁止する。
- Bedrockはハードガードと候補生成の後だけ呼ぶ。通知上限・重複判定は決定的なコードで扱う。
- previewは同じ評価経路を通すが通知と日次枠更新を行わず、`wouldSuppress` を返す。`force=true` は作らない。
- Places候補は原則 `SingleUse`。選ばれた場所の永続化前に `GetPlace(IntendedUse=Storage)` を呼ぶ。
- モバイルからカレンダー参加者・説明を送らない。24時間のcontext論理TTL、ユーザーのIANA timezoneで日次枠を計算する。
- 本番ログに認証・通知tokenや位置・カレンダーのリクエスト全文を出さない。provider timeoutを有限にし、Bedrock経路のp50 < 6秒・p95 < 10秒、ガードのみの経路 < 750msを計測する。
- 新しいdetectorには正例・負例・境界例・必要なら重複例のテストを付ける。実環境のprovider呼び出しは単体テストから切り離す。

## レビューで特に見る5点

1. 同じpreviewを連続実行しても結果は見え、2回目は重複ガードを診断表示し、通知数が増えないか。
2. 日付変更とDST境界で、通知上限の日付がユーザーのIANA timezoneに従うか。
3. Placesの`SingleUse`候補や生レスポンスを保存せず、選択済みplaceだけStorage intentで再取得するか。
4. Transitや天気が未対応・タイムアウトでも架空データを返さず、使える候補は評価できるか。
5. 別ユーザーの推薦詳細・チャットを読めず、private S3・JWT・OIDCの境界を守るか。

## 1. 担当レーンと編集権

司令塔（このCodexタスク）は5人目とは別の**調整役**とする。担当ブランチの状態、契約変更、PRの取り込み順、フェーズの統合ゲートを管理する。担当者の実装パスを司令塔が同時編集しない。各メンバーのAIは自分のレーンの実装を行い、設計上の衝突は司令塔へ報告する。

| レーン | 使用モデル | 主な責務 | 専有するパス |
|---|---|---|---|
| A: 契約・判定 | GPT-6-sol | Zod契約、ガード、5 detector、共通fixture | `packages/contracts/**`、`packages/domain/**`、`packages/test-fixtures/**` |
| B: 外部接続・保存 | GPT-6-sol | provider ports、Places/Geocode/Routes/Open-Meteo/Bedrock、DynamoDB、遠隔通知adapter | `packages/providers/**` |
| C: Web | GPT-6-sol | Scenario Console、Web認証・地図・編集・UIテスト | `apps/web/**` |
| D: 統合・AWS | Claude Opus 5.5 | API handler/application、CDK、Cognito、CI/CD、環境設定、リリース統合 | `apps/api/**`、`infra/cdk/**`、`packages/config/**`、`.github/**`、ルート設定・lockfile |
| E: モバイル | GPT-6-sol | Expo、端末context取得、画面・認証・ローカル通知・実機テスト | `apps/mobile/**` |

### 工数の目安

これはコード量ではなく、実装・テスト・AWS/実機検証を含む全工程の粗い見積もり。依存サービスの利用可否で変動する。

| 担当 | 比重 | 重くなる要因 |
|---|---:|---|
| A | 18% | 共通契約、ガード、5つのdetectorと境界テスト |
| B | 24% | 5種の外部provider、Bedrock、DynamoDB、通知adapter |
| C | 15% | 地図・入力編集・結果表示を持つScenario Console |
| D | 23% | API統合、Cognito/CDK、OIDC、dev/prodデプロイ |
| E | 20% | Expo権限、iOS/Androidの歩数と背景処理、実機試験 |

BとDが最も重く、統合の待ち時間も発生しやすい。担当パスの重複を増やして均等化するより、A/C/Eの独立した作業を早めに開始し、B/Dの契約・AWS確認を先に通す。

ドキュメントの変更担当は、`API.md` と `TEST_STRATEGY.md` がA、`DEMO.md` がC、`ARCHITECTURE.md`・`DATA_MODEL.md`・`CI_CD.md`・`docs/hackathon/AGENT_LOG.md` がD。`SPEC.md` の製品仕様変更は人間が判断する。B/C/D/Eが契約・保存仕様の変更を必要としたら、担当者に要求と失敗するテストを渡す。担当外のファイルをその場で直さない。

`apps/mobile/**` はEだけが所有し、Aは端末contextを契約型として提供する。ルートの `pnpm-lock.yaml` はDだけが更新する。各workspaceの依存追加は該当レーンがDに先に伝え、Dのlockfile更新後に各ブランチをrebaseする。

### 必須の受け渡し順

1. Dがpnpm workspace・共通scripts・各workspaceの空の足場を作る。Aは自分のパス内のZod契約から先行着手してよい。検証・統合にはDの足場を取り込む。以降、各レーンは専有パスだけを編集する。
2. Aが `packages/contracts` のv1 Zod schemaと型を公開する。APIの全列挙値・入力上限・レスポンスを[API.md](./API.md)に合わせる。
3. Bが `packages/providers/src/ports/**` の引数・戻り値とprovider statusを公開する。Aのdomainはport型に依存しない。
4. Dがcontracts/portsを取り込み、handler・application・CDKを接続する。CとEは同じcontractsで両クライアントを作る。変更が必要なら契約担当のPRを先に通す。

この4点を短い「契約チェック」として5人で確認してから、各実装を並行させる。未統合の相手レーンを待つ間は、自分のパス内のfixtureやテストdoubleで進め、製品の実行経路に偽結果を残さない。

## 2. フェーズ

### Phase 0 — 足場と契約の固定

**終了条件:** 5レーンが同じ型でbuildでき、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm cdk:synth` が実行可能。`dev`/`prod`を別名でsynthできる。この時点の未完成の機能PRを本番にマージしない。

| 担当 | 実装タスクと検証可能な成果 |
|---|---|
| D | ルート `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、lockfile、共通5 scriptsとdev専用の`cdk:diff:dev`を作る。`infra/cdk` のdev/prod stackと `apps/api` の `/health` の足場を作り、明示stage・期待account/Region確認・`cdk:synth` とCDK assertionで環境分離・Node.js 24.xを確認する。 |
| A | `packages/contracts/src` にv1 request/response・列挙値・入力上限をZodで実装し、正しいreal/proactiveとsimulation/preview、座標・時刻・件数・timezoneの異常値テストを追加する。`packages/test-fixtures/scenarios` の5シナリオの入力とmock provider応答の形を決める。 |
| B | `packages/providers/src/ports` にPlaces、Geocoding、Weather、Routes、RecommendationModel、StateRepository、NotificationProviderを定義し、`ok/degraded/unavailable/timeout/error/not_requested` の共通結果を固定する。SDK型を公開しない型チェックを行う。 |
| C | `apps/web` のVite/React画面の足場を作り、contractsをimportしてbuildできることを確認する。完成前の画面には「未接続」と明示し、推薦を捏造しない。 |
| E | `apps/mobile` のExpo/TypeScript足場を作り、contractsをimportしてbuildできることを確認する。iOS/Android development buildの手順と端末権限の必要条件をREADMEに記す。 |

**統合順:** Dの足場 → Aのcontracts → Bのports → C/Eのクライアント足場。AはDを待たず契約ファイルを作れるが、Phase 0の完了判定には共通scriptsでの検証が必要。各人の作業ブランチは分離し、Phase 1の実行可能な統合PRでCI・dev smokeを通す。

### Phase 1 — 公開できる最初の縦断動作（Ship Gateの土台）

**選ぶ縦断シナリオ:** `STEP_GOAL_REST`。位置・歩数・周辺Placesで候補を作り、Bedrockのschema-validな判断をWebに表示する。Open-Meteo adapterも実装し、要求されない評価では `not_requested` を返す。

| 担当 | 実装タスクと検証可能な成果 |
|---|---|
| A | 通知無効・日次上限（low=1/normal=3/high=6件/日）・5分fingerprint・30分trigger/anchorのガード、時計注入、previewの診断、step-goal detectorを実装。timezoneはprofile→検証済みclient→UTCの順に使い、正例・負例・境界・同日重複・DST・preview再実行テストを通す。 |
| B | Places V2 `SearchNearby`、選択後 `GetPlace(Storage)`、Open-Meteo、Bedrock Converse、DynamoDB profile/state/context/recommendation repositoryを実装。各adapterの正規化・timeout・エラー・AI修復1回・place ID照合・TTL/transactionテストを通す。 |
| C | Cognitoログイン、MapLibre地図、地図クリック/緯度経度、時刻/歩数/予定/好み入力、step-goal preset、Run、推薦最大3件、usedSignals/providerStatus/エラー表示をWebで実装。previewを固定し、API実応答のschemaを検証する。 |
| D | Cognito JWT付きHTTP API、`/v1/context/evaluate`、profile読み込み、guard→detector→provider→Bedrock→Storage intent保存のapplication service、構造化ログを接続。previewは設定済みScenario Console/demo認証文脈だけに許可する。CDKでprivate S3+CloudFront OAC、API、Lambda、DynamoDB TTL、Web/Mobile用Cognito app client、制限付きmap API keyをdev/prod分離で作る。OIDCのCIとdev/prod smokeを作り、prodは`main`から所有者が手動起動する設定にする。Claude Code→AWSの実操作をログに残す。 |
| E | Expo開発buildの認証・権限取得経路を作り、前景GPS・カレンダー読み取りの小さな試作を実機で動かす。許可フィールドだけを`ContextInput`に詰める関数を単体テストし、API統合はPhase 2で行う。 |

**統合ゲート:** 5コマンドとCDK assertionが成功。devでログイン→step-goal preview→実Places+Bedrock→schema-valid応答を確認し、同一preview再実行でも結果が表示され通知数は増えない。`main` からprodをデプロイし、公開URL・`/health`・認証済み1シナリオを確認する。これを満たすまで「公開済み」と呼ばない。

### Phase 2 — 5シナリオとモバイル前景動作

**終了条件:** 5 fixtureの検出・provider needs・ガード・最大3件が決定的テストで通り、Webから全シナリオを編集・実行できる。実機1台がGPSとカレンダーを取得して同じAPIを呼べる。

| 担当 | 実装タスクと検証可能な成果 |
|---|---|
| A | 残り4 detector（upcoming transit、free time、weather adaptation、early arrival）と5 fixtureの正例・負例・境界・必要な重複テストを完成。候補ごとの不足signal・provider未対応を除外し、他候補は継続するテストを付ける。 |
| B | Places V2 `Geocode`、Amazon Location Routes Transit/Intermodal、provider needsの依存（geocode→route、places→candidate route）に必要なadapter結果を実装。未対応地域・曖昧なgeocode・weather範囲外は明示的にunavailableとし、架空の時刻を返さない。Bedrock follow-upもportに実装し、モデル出力のplace/route参照が入力に存在することを検証する。Codex→AWSの実操作を記録してDに渡す。 |
| C | Webに5 preset、複数予定の追加/削除、入力検証、provider劣化・`wouldSuppress`表示、正規化context toggleを完成。5 presetは入力だけを埋め、結果を固定しない。 |
| D | `/me`、preferences、recommendation一覧/詳細、推薦単位の短いchat、冪等性、所有者検証、時差を考慮した原子的な通知カウンタを接続。provider needsの和集合・重複排除・geocode→route/places→routeの順序・timeoutをapplication serviceで扱う。全5ケースを同じpipelineに通し、devで部分的provider失敗・他ユーザーからの詳細アクセス拒否を検証する。 |
| E | `apps/mobile/src/context` にLocationSource、CalendarSource、StepSource、ClockSource、ContextCollectorを完成させる。Cognito認証、Dashboard、設定、推薦詳細、前景の「今評価」操作を同じAPIに接続し、実機GPS・カレンダー→API→結果を確認する。 |

**統合ゲート:** devに5ケースを適用し、live providerが必要な経路は実providerで少なくとも各1回確認。天気presetは実天気依存なので雨を保証しない。iOS/Androidのうち利用可能な実機で前景GPS・カレンダー→API→結果を確認し、prodに統合する。

### Phase 3 — モバイルと通知の完成、劣化耐性

**終了条件:** ネイティブ機能はExpo Goでなくdevelopment buildで検証。foregroundとbackgroundの配信を混同せず、同じrecommendation IDを二重通知しない。

| 担当 | 実装タスクと検証可能な成果 |
|---|---|
| A | ガードと5 detectorの回帰テストを追加し、候補の不足signal・provider劣化・重複の組合せを確認する。新しい製品機能は増やさない。 |
| B | Expo PushとSNSのremote adapter、device tokenの保存・回転・削除、アカウント削除に対応できるrepository操作、Places/Routes/Weather/Bedrock各adapterのtimeoutとpartial failureを仕上げる。通知tokenはログに出さない。 |
| C | WebのPlaywright操作テスト、日本語表示、loading/error状態を仕上げる。map clickと座標直接入力が双方向に同期し、全5 presetで実APIが呼ばれることを確認する。devでだけ使えるprovider劣化デモ操作を表示する。 |
| D | `/devices`の登録/削除と送信経路の排他、dev限定のprovider劣化デモ設定、CloudWatch metrics、短いdevログ保持、productionセキュリティ設定、CIのフルゲートを完成。DynamoDB障害時は重複送信せず、Bedrock障害時は偽のAI文を返さないことをAPIテストで確認する。 |
| E | iOS Pedometer、Android Health Connect、低信頼のforeground fallback、Expo Location/TaskManagerの機会的背景callbackを実装。ローカル通知・推薦フィード・follow-up画面・permission/provider health表示を完成し、推薦IDで重複を防ぐ。権限拒否、カレンダー最小化、source選択をテストし、定時5分実行は約束しない。 |

**統合ゲート:** `TEST_STRATEGY.md` のモバイル実機表をiOS/Androidで記録する。端末が不足する場合、未検証のOSを明記して完了扱いにしない。provider劣化でも有効な候補の評価が継続し、previewとproactiveの通知挙動が別々にテストされる。

### Phase 4 — 提出前の統合・再現確認

- [ ] A: 5 fixture、ガード、API契約の全テストを再実行し、SPECとの差分を点検する。
- [ ] B: live provider最小smokeとBedrock schema検証をdevで行い、使用モデルID・regionは環境変数のみから読まれることを確認する。
- [ ] C: incognitoでprod Consoleのログイン→任意座標入力→実評価→結果表示を確認し、Webの短い操作記録を残す。審査員用アカウントのログイン手順も確認する。
- [ ] D: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm cdk:synth`、dev/prod smoke、OIDC trust、非公開S3、CloudWatch、AWS MCP証跡を確認し、`main` からprodをデプロイする。
- [ ] E: development buildのiOS/Android実機表を確認し、前景GPS・カレンダー・歩数・ローカル通知・背景callbackの結果と端末の操作記録を残す。
- [ ] 5人で[DEMO.md](./DEMO.md)のShip Gateと提出手順を確認し、失敗した項目・未検証OS・本番URLをREADMEとPRに記録する。録画はライブアプリの代わりにしない。

## 3. ブランチ・PR・AI利用ルール

1. 各メンバーは別worktree/checkout・独立したAIセッションで作業する。1つの作業ツリーやAI会話を5人で共有しない。Phase 0は下表の専用ブランチで小さなcommitに分け、Phase 1の最初の動く縦断sliceを統合PRとしてmainへ提出する。以後は `feature/<lane>-<phase>-<topic>` の成果ごとのPRにする。
2. Phase 0の足場と契約を取り込んでから5レーンで並走する。契約変更はAのPRを先に統合し、B→D→C/Eの順で依存を更新する。変更範囲が自分のレーンを越えたら、担当者に再現・要求・失敗テストを渡す。
3. 1 PRは1つの検証可能な成果に絞る。PR本文に「変更点、変更ファイル、実行したテスト、AWS影響、未解決リスク、次の作業」を記す。AIへの依頼も同じ大きさにする。
4. dev deployは `deploy-dev` concurrencyで直列化する。統合中に別PRがdevを上書きし得るため、smoke結果は実行したcommit SHAと結び付ける。prodは`main`の成功後に所有者が手動起動し、差分を確認して更新する。
5. コーディングエージェントがAWSを操作したら、担当者が日時・操作・commit/PR・秘密を含まない証跡をDに渡し、Dが `AGENT_LOG.md` に記録する。CodexとClaude Codeの接続証拠をそれぞれ残す。

### Phase 0のブランチ割当

全ブランチは `feature/coordination-plan` の同じcommitから開始する。司令塔は計画PRを用意する。Dは足場を最初に作り、A/B/C/Eはそのcommitを取り込んでから各自のPhase 0を始める。計画PRのmainへの統合を待つ必要はない。

| 担当 | ブランチ | 最初の実装 |
|---|---|---|
| A | `feature/phase0-a-contracts-domain` | Zod契約とfixture |
| B | `feature/phase0-b-providers` | provider ports |
| C | `feature/phase0-c-web` | Web足場 |
| D | `feature/phase0-d-platform` | workspace・scripts・CDK足場 |
| E | `feature/phase0-e-mobile` | Expo足場 |

ブランチ名は担当者のものとして固定する。司令塔は各PRの変更ファイルと検証結果を確認し、契約→provider→API→clientsの順に統合する。AWS devのsmoke結果はブランチ名だけでなくcommit SHAと一緒に記録する。

### 将来Claude Code Maxへ移るとき

モデルの変更は担当レーンやAPI契約の変更を意味しない。景品として利用可能になった後、各人は**現在のPRを統合するか、commitと未完了タスクを記録したうえで**Claude Code Maxの新しいセッションへ同じ担当ブランチを渡す。引き継ぎには本計画、直近のPR/commit、実行済みテスト、未解決の依存、AWS操作ログの参照を含める。切替中も作業ツリーと認証情報は共有しない。

### AIに渡す共通プロンプト

以下の `{担当}` と `{Phase}` だけ置き換え、各人が自分のAIに送る。1回の依頼で次のフェーズを含めない。

司令塔への短い指示 **「担当Aを実装して」** は、[TEAM_BOARD.md](./hackathon/TEAM_BOARD.md)にあるAの次の未完了フェーズを意味する。B〜Eも同じ。司令塔は指定レーンのブランチでそのフェーズの作業を進め、実行した検証と未解決の依存を記録する。フェーズ内の独立した作業は進め、依存がないため実行できない検証は保留理由を残す。次のフェーズには統合ゲートが通ってから進む。「担当AのPhase 2を実装して」のように明示された場合はそのフェーズを対象にするが、先行契約を飛ばさない。

```text
Contextia の {担当=A/B/C/D/E}、Phase {0/1/2/3/4} を担当してください。
まず AGENTS.md と docs/README_IMPLEMENTATION.md、docs/SPEC.md、docs/ARCHITECTURE.md、docs/API.md、docs/DATA_MODEL.md、docs/TEST_STRATEGY.md、docs/DEMO.md を読んでください。
docs/PHASED_IMPLEMENTATION.md の当該フェーズと担当レーンだけを実装してください。
担当外のファイルや仕様を独断で変更せず、契約変更が必要なら要求と失敗テストを報告してください。
Phase 0は本計画の割当済みブランチを使い、次のPhaseからは feature/<lane>-<phase>-<topic> の独立したブランチを作ってください。テスト可能な小さなPRにしてください。
完了前に pnpm lint、pnpm typecheck、pnpm test、pnpm build、pnpm cdk:synth と該当smokeを実行し、実行していないものは未実行と明記してください。
最後に変更点、変更ファイル、テスト結果、AWSへの影響、未解決リスク、次の担当者への受け渡しを報告してください。
```

Phase 0の統合はDの足場から始める。Aは契約ファイルを先行作成でき、BはAの型が定まった部分、C/Eは各クライアントの足場を独立して進められる。全員が共通scriptsで検証する前にDの足場を取り込む。各フェーズの統合ゲートを通過した後に次のPhaseをAIへ依頼する。

## 4. 仕様の優先順位

この計画は担当と順序を定める。製品動作で矛盾が見つかった場合は `SPEC.md > API.md / DATA_MODEL.md > ARCHITECTURE.md > 実装` の順に照合し、独断で新しい動作を足さずにPRで人間へ明示する。
