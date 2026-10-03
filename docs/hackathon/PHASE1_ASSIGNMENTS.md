# Phase 1 — 担当へ渡す開始ブランチと依頼文

2026-10-01。Phase 0は完了した。下のA/B/C/Eを各メンバーへ渡し、Dの統合・AWSは所有者が担当する。人間の氏名は未割当。これは開始準備と依頼文であり、各担当者が実作業を開始したことを示す記録ではない。

共通実装は `d88d2bf`、最終検証と引き継ぎ修正は `b692b64`。5担当の開始ブランチは、調整資料を含む `feature/phase0-d-platform` の同じ基点を参照する。レビュー用の [draft PR #1](https://github.com/xe-pc23/Contextia/pull/1) はPhase 0全体を扱い、mainへの反映は行わない。

## 渡すレーン

| 担当 | 開始ブランチ | 編集範囲 | 最初の成果 |
|---|---|---|---|
| A 契約・判定 | `feature/a-phase1-step-goal` | contracts / domain / test-fixtures、API.md / TEST_STRATEGY.md | ガードとstep-goal detectorの決定的テスト |
| B 外部接続・保存 | `feature/b-phase1-live-providers` | packages/providers | Places、Weather、Bedrock、DynamoDB adapters |
| C Web | `feature/c-phase1-console` | apps/web、DEMO.md | preview入力画面とschema検証するAPI client |
| D 統合・AWS／所有者 | `feature/d-phase1-evaluation-aws` | apps/api、infra/cdk、packages/config、.github、ルート/lockfile、D担当文書 | 評価serviceと認証・インフラ・CI |
| E モバイル | `feature/e-phase1-native-context` | apps/mobile | development buildの前景context試作 |

ファイル所有権・仕様の詳細は [PHASED_IMPLEMENTATION.md](../PHASED_IMPLEMENTATION.md)。契約や依存の変更は担当者へ要求する。別レーンを同時編集せず、1つのcheckoutを複数人で共有しない。

## 各メンバーの開始手順

Aの例。他担当はブランチ名だけ置き換える。

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

すでに同名のローカルブランチがあれば `git switch feature/a-phase1-step-goal` を使う。検証したNodeは `.node-version` の24.13.1、pnpmは10.29.3。最低Node 24.3.0。macOSの検証環境を使用した。Mobileのpackage scriptsはPOSIX形式で、native Windows shellは未検証。秘密やAWS access keyをrepoに追加しない。

開始時に必要な追加依存と環境変数名をDへまとめて伝える。Dだけがルート設定・lockfileを更新し、共通基点へ取り込む。C/Eは認証設定が届く前に入力関数や画面を、Bはlive環境が届く前にadapter mocksを、DはA/Bが届く前にapplication doublesとCDKを進められる。

## Aへコピーする依頼

```text
ContextiaのA（契約・判定）、Phase 1を担当してください。
ブランチは feature/a-phase1-step-goal。AGENTS.md、docs/README_IMPLEMENTATION.md、docs/SPEC.md、docs/ARCHITECTURE.md、docs/API.md、docs/DATA_MODEL.md、docs/TEST_STRATEGY.md、docs/DEMO.md、docs/PHASED_IMPLEMENTATION.mdを先に読んでください。

packages/contracts、packages/domain、packages/test-fixturesとA担当のAPI.md/TEST_STRATEGY.mdだけを編集してください。domainはprovider portやAWS SDKに依存させません。
Phase 1の決定的ガードを実装してください: 通知無効、日次上限low=1/normal=3/high=6、5分の同一fingerprint、30分の同一trigger/anchor。時計を注入し、timezoneはprofile→検証済みclient→UTCの順に使います。previewでは内容評価を隠さずwouldSuppress診断を返し、実配信のガードは維持してください。
STEP_GOAL_REST detectorを実装し、normalized contextからcandidateとprovider needsを返してください。通知やBedrockをdetectorから呼びません。ほか4 detectorはPhase 2なので実装しません。
正例・負例・ちょうど目標・不足/低信頼signal・同日重複・時間境界・日付変更/DST・preview再実行のテストを付けてください。fixtureにAIの固定回答を加えないでください。
最初の小さな成果はガードと時計/timezoneのテスト、その次にstep-goal detectorです。Dへ公開exportと必要な入力を渡してください。
完了前にpnpm lint、pnpm typecheck、pnpm test、pnpm build、pnpm cdk:synthを実行してください。PR baseは当面feature/phase0-d-platform。変更点・ファイル・実行結果・AWS影響・残課題・次タスクを報告し、Phase 2へ進まないでください。
```

Aの完了条件: domainにSDK/通知実行がなく、ガードとstep-goalの正例・負例・境界・timezone/preview回帰テストが通る。Dが組み込める候補/ガードexportを公開する。

## Bへコピーする依頼

```text
ContextiaのB（外部接続・保存）、Phase 1を担当してください。
ブランチは feature/b-phase1-live-providers。AGENTS.md、docs/README_IMPLEMENTATION.md、docs/SPEC.md、docs/ARCHITECTURE.md、docs/API.md、docs/DATA_MODEL.md、docs/TEST_STRATEGY.md、docs/DEMO.md、docs/PHASED_IMPLEMENTATION.mdを先に読んでください。

packages/providersだけを編集し、既存7 portsとcontractsを使用してください。必要なSDK/依存は最初にDへ伝え、ルートlockfileを直接更新しません。保存仕様/契約の変更はD/Aへ要求と失敗テストを渡してください。
Phase 1のPlaces V2 SearchNearby、選択したplaceのGetPlace(IntendedUse=Storage)、Open-Meteo、Bedrock Converse、DynamoDB profile/state/context/recommendation adapterを実装してください。SingleUse候補や生SDK responseを保存/公開しません。
Weatherはcurrent/forecast/daily、feels-like、source timestampを正規化し、有限timeoutと6種類のprovider statusを扱ってください。未要求providerは呼ばない設計にします。
Bedrockは入力候補とprovider factsを使い、Zodでnotify/silentと最大3件を検証します。返されたplace/route参照を入力と照合し、invalid outputの修復は1回まで。モデルIDは環境変数、hidden reasoningは公開しません。
DynamoDBはユーザー所有権と論理TTLを検証し、recommendationとpointerをtransactionで保存します。日次枠/anchor更新はpreviewを受け付けず、条件付き/原子的に行ってください。portsが将来用に定義したchat/idempotency/device機能はPhase 2/3へ残します。
最初の成果はPlacesのrequest/normalize/error testsとadapter、次にWeather/Model/Repositoryです。テストはmock/最小fixtureを使い、live smokeを単体テストへ混ぜません。AWSのdeploy/IAM変更は所有者へ任せてください。
完了前にpnpm lint、pnpm typecheck、pnpm test、pnpm build、pnpm cdk:synthを実行してください。PR baseは当面feature/phase0-d-platform。変更点・ファイル・実行結果・AWS影響・残課題・次タスクを報告し、Phase 2へ進まないでください。
```

Bの完了条件: SDK型を外へ漏らさず、adapterの正規化・timeout/失敗・Storage intent・モデル参照/修復・TTL/transactionをmockで検証する。Dへprovider factory/config/IAM要求を渡す。

## Cへコピーする依頼

```text
ContextiaのC（Web）、Phase 1を担当してください。
ブランチは feature/c-phase1-console。AGENTS.md、docs/README_IMPLEMENTATION.md、docs/SPEC.md、docs/ARCHITECTURE.md、docs/API.md、docs/DATA_MODEL.md、docs/TEST_STRATEGY.md、docs/DEMO.md、docs/PHASED_IMPLEMENTATION.mdを先に読んでください。

apps/webとC担当DEMO.mdだけを編集してください。必要なMapLibre/認証/UI test依存と環境変数名を最初にDへ伝え、ルートlockfileは変更しません。
既存React/Vite足場へCognitoログイン、MapLibre地図、地図クリックと座標入力、時刻/歩数/予定/好み編集、step-goal preset、Run、最大3件の推薦、usedSignals/providerStatus/エラー表示を実装してください。
Scenario Consoleはmode=simulation、deliveryMode=previewを固定します。getScenarioInputで入力だけを埋め、fixtureのprovider応答や固定AI回答を製品経路で使いません。ReactからAmazon Location推薦APIを直接呼ばず、共通backendを使用してください。
送信前のContextInputと実API応答を共通Zodで検証してください。API未接続中は画面で明示し、テストdoubleはテストに閉じ込めます。実API環境/ログインcallbackはDから受け取って接続してください。
最初は入力編集とpreview request生成/API clientの検証、その次に地図と認証、実応答表示です。loading/失敗/不正入力のテストとブラウザ操作を確認してください。5 preset全体やPhase 2の表示拡張は後で行います。
完了前にpnpm lint、pnpm typecheck、pnpm test、pnpm build、pnpm cdk:synthを実行してください。PR baseは当面feature/phase0-d-platform。変更点・ファイル・実行結果・AWS影響・残課題・次タスクを報告し、Phase 2へ進まないでください。
```

Cの完了条件: preview専用の編集→検証→実API呼出→正規化結果表示が動く。入力/地図同期・loading/errorを確認し、API未接続なら縦断smoke未達と記録する。

## D／所有者へコピーする依頼

```text
ContextiaのD（統合・AWS）、Phase 1を担当してください。デプロイはプロジェクト所有者が担当します。
ブランチは feature/d-phase1-evaluation-aws。AGENTS.md、docs/README_IMPLEMENTATION.md、docs/SPEC.md、docs/ARCHITECTURE.md、docs/API.md、docs/DATA_MODEL.md、docs/TEST_STRATEGY.md、docs/DEMO.md、docs/PHASED_IMPLEMENTATION.mdを先に読んでください。

apps/api、infra/cdk、packages/config、.github、ルート設定/lockfileとD担当文書だけを編集してください。A/Bの成果を取り込み、C/Eの依存要求と環境変数・Cognito callbackを調整してください。
Cognito JWT付きHTTP APIとPOST /v1/context/evaluateを実装し、profile→guard→step-goal candidate→必要provider→Bedrock→選択placeのStorage取得→保存を接続してください。previewは設定済みConsole/demo認証文脈だけに許可し、通知送信/日次枠を増やしません。public force bypassを作りません。通知tokenや私的context全文をログへ出しません。
CDKでdev/prodを分け、Cognito Web/Mobile clients、DynamoDB on-demand+TTL、Node24 Lambda/JWT HTTP API、private S3+CloudFront OAC、制限付きmap API keyを作ってください。account634512763705、Region ap-northeast-1、名称contextia-{stage}-...を維持します。
GitHub ActionsはGitHubDevDeployRole/GitHubProdDeployRoleのOIDCを使用し、prod trustをdevより狭くします。5チェック・dev deploy直列化・commit SHA付きsmoke・mainから所有者が手動起動するprodを用意してください。長期AWS keyのGitHub secretsは使いません。
最初はprovider/domain doublesで評価serviceをテストし、Cognito/CDKと設定を並行で用意します。A/Bを統合してからlive step-goal smokeへ進みます。CDK changesをrepoに残し、AWS MCPが利用できれば接続と実操作の証跡をAGENT_LOGへ記録してください。利用できなければ未取得と明記します。
実AWS反映は所有者が行います。実装・synth・差分・smoke手順を先に完成させ、bootstrap/deploy/IAM変更をこの依頼だけで勝手に行いません。
完了前にpnpm lint、pnpm typecheck、pnpm test、pnpm build、pnpm cdk:synthを実行してください。PR baseは当面feature/phase0-d-platform。所有者のdev反映後、ログイン→実Places+Bedrock→step-goal preview→同一preview再実行でも通知枠不変をcommit SHA付きで検証してください。変更点・ファイル・結果・AWS影響・残課題・次タスクを報告し、Phase 2へ進まないでください。
```

Dの完了条件: contracts/portsを通した評価と認証/CDK assertions/CIが成功し、所有者のdev反映後に実縦断smokeが通る。Phase 1の統合PRをmainへ準備し、所有者がprod反映と公開smokeを行うまで公開済みと呼ばない。

## Eへコピーする依頼

```text
ContextiaのE（モバイル）、Phase 1を担当してください。
ブランチは feature/e-phase1-native-context。AGENTS.md、docs/README_IMPLEMENTATION.md、docs/SPEC.md、docs/ARCHITECTURE.md、docs/API.md、docs/DATA_MODEL.md、docs/TEST_STRATEGY.md、docs/DEMO.md、docs/PHASED_IMPLEMENTATION.mdを先に読んでください。

apps/mobileだけを編集してください。必要なExpo Location/Calendar/認証依存と環境変数・Cognito callbackを最初にDへ伝え、ルートlockfileは変更しません。
expo-dev-clientを使うdevelopment buildで認証・権限取得経路と前景GPS/カレンダー試作を作ってください。GPSとCalendarを差し替え可能にし、許可フィールドのみをContextInputへ詰める純粋関数をテストしてください。calendarはid/title/startAt/endAt/location/allDayに限定し、attendees/email/description/notes/meetingUrlを送信しません。
permission denial・不取得を有効な状態として扱い、実機の1 OSで前景取得とschema-valid入力を確認してください。利用していないOSは未検証と記録し、Expo GoやJS exportでnative動作が完成したと扱いません。
最初はCalendar最小化/context組立の単体テスト、その次にforeground permissionsとCognitoです。API評価統合はPhase 2、歩数/背景処理/通知の本実装はPhase 3へ残します。Androidのtoday stepsをiOS専用Pedometer歴史queryで実装せず、StepSourceを維持します。背景が5分ぴったり動くとは約束しません。
実機結果はapps/mobile/README.mdに端末/OS/build/成功/失敗/未検証を記録し、AへTEST_STRATEGYの更新内容を渡してください。
完了前にpnpm lint、pnpm typecheck、pnpm test、pnpm build、pnpm cdk:synthを実行してください。PR baseは当面feature/phase0-d-platform。変更点・ファイル・実行結果・AWS影響・残課題・次タスクを報告し、Phase 2へ進まないでください。
```

Eの完了条件: 許可field投影/不取得のテストが通り、development build実機で認証・前景GPS/カレンダーを確認する。端末/認証設定がない場合は独立実装を進め、実機項目を未達と記録する。

## 取り込み順と共有する情報

1. 各担当はまず「追加依存名、環境変数名、port/契約の変更要求」をD/Aへ渡す。既存schemaやportで足りる独立テスト/画面から着手する。
2. Aの契約/domainを先に共通基点へ取り込み、Bのadapter、Dのapplication、C/Eの接続を順に検証する。小さな担当PRのbaseは `feature/phase0-d-platform`。1 PRは1成果とする。
3. 完了報告は変更点、ファイル、実行した5チェックと該当smoke、AWS影響、残課題、次タスクの6点。未実行・依存待ちを成功扱いにしない。
4. `TEAM_BOARD.md`は司令塔がcoordination branchで更新する。Phase 1 dev smoke後にmain向け縦断PRを作る。dev/prodの反映は所有者、prodは検証済みmainから手動起動する。

Phase 0の検証・残課題は [PHASE0_HANDOFF.md](./PHASE0_HANDOFF.md)。接続済みアプリ、AWS MCP証跡、native実機検証はこれから行う作業で、開始ブランチの存在だけでは達成したと扱わない。
