# API — Phase 2-D

Lambdaの入口は`src/runtime.ts`。`src/handler.ts`は認証・HTTP・契約検証、`application`は注入されたdomain/provider portsを使う。`pnpm dev:api`のlocalhost serverはhealth確認用で、JWT authorizerがないため保護routeは401になる。

## HTTP routes

| Route | 動作 |
|---|---|
| `GET /health` | 外部呼出なしのlivenessとbuild ID |
| `GET /v1/me` | JWT所有者のprofile。未作成は404 |
| `PUT /v1/me/preferences` | 全preferencesをZod検証して保存。初回profileも作成 |
| `GET /v1/recommendations` | 所有者の履歴。limit既定20、上限50、opaque cursor |
| `GET /v1/recommendations/{recommendationId}` | 所有者かつ未期限切れの推薦。未存在・別ユーザーは404 |
| `POST /v1/context/evaluate` | 全5 detectorの評価。任意のUUID `Idempotency-Key` |
| `POST /v1/recommendations/{recommendationId}/chat` | 推薦単位の短いfollow-up。最大8 user turns、固定2時間TTL |

health以外はAPI Gateway Cognito JWT authorizerと`token_use=access`が必要。userIdはJWTの`sub`だけを使う。evaluateのsimulation/previewはWeb client、real/proactiveはMobile clientだけに許可する。他の保護routeは両clientに許可する。body上限256KiB、全request/responseをcontractsで検証する。

## 評価と保存

`profile/state -> hard guards -> candidate generation -> provider needsの和集合 -> enrichment -> refineCandidates -> 採用候補 -> model -> GetPlace(Storage) -> 保存`の順。同じrequest-start server時刻をquota・dedup・TTLに、simulationのscenarioTimeをprovider/modelの状況時刻に使う。

Places/Weather/Geocodeは独立並列。geocode後に目的地Places/event route、その後に活動用の往路・復路を取得する。同一パラメータの呼出をrequest内で共有し、route対象は既定6 places・同時4・enrichment全体7秒。Places 2.5秒、Weather 2秒、Routes 3秒、model 7秒。実adapterのabortに加えてapplicationがdeadlineを設ける。部分失敗は該当候補へ反映し、他候補を継続する。供給していない移動時間・place・websiteを返さない。

`EVALUATION_TIMEOUT_MS`は評価全体で共有する単調時計の期限（既定・上限20秒）。state reads、enrichment、model、Storage取得、推薦保存、冪等性completeを含め、期限後は後続処理を始めず503 `EVALUATION_TIMEOUT`を返す。保存前のclaim解放だけは最大2秒の清掃予算を持つ。進行中のadapter呼出は各adapterの有限timeout/abortで終了する。Lambdaの28秒はその終了余裕を含む。

モデルはtriggerを選択する契約ではないため、refinement後の最高confidence候補を先に確定し、同点はAのregistry順を維持する。その候補のeligible/unverified place IDsと関連routesを渡す。fixtureのfree-timeとearly-arrivalは条件が重なり、全registryでは同点のFREE_TIME_NEARBYが選ばれることがある。各detectorのfixture評価と、全registryでモデル・返却・保存triggerが一致する評価を別々に検証する。

選択したplaceだけ`GetPlace(storage)`で再取得する。Storageが失敗したら推薦・quotaを保存しない。返却カードと履歴/cache/chatのplace fields・website actionはStorage由来の正規化値だけ。探索のSingleUse候補一覧を保存しない。

proactiveはBの`commitProactiveRecommendation`で推薦本体・ID pointer・quota/anchorを原子的に保存する。previewはsnapshot/処理fingerprintと推薦履歴を保存し、quota/通知済みanchorを変えない。`wouldSuppress`で診断し、同じpreviewも再評価する。実通知送信はPhase 3。

新しいsnapshotや確認済みtransaction条件競合で配信を拒否した場合は409 `EVALUATION_SUPERSEDED`を返す。理由不明のtransaction失敗・状態欠落は503を維持する。抑止理由を捏造して空guardのproactive silentを返さない。

STEP_GOAL_RESTの同じIANA local-day抑止は、local date開始の実UTC instantからの経過秒+1をBのseconds portへ渡す。DSTの23/25時間日とmidnightを含む。現在/未来のanchorが保持上限を超える状態はfail closedにする。サーバー処理時刻はBの`latestContextProcessedAt`を使い、legacy rowだけsnapshotのcreatedAtを補う。

## 冪等性・chat

冪等性hashはuser/operation/全正規化inputをSHA-256にし、通知fingerprintと分ける。同じkey/bodyは保存結果だけを再生して新しいHTTP requestIdを付け、provider/model/quotaを再実行しない。異なるbody・処理中は409。claim/cacheは1時間の論理TTLと所有者をrepositoryで検証する。

DynamoDBのclaimは未存在または論理期限切れを条件に取得する。UUID claimIdで所有者を識別し、結果とpointerはtransactionで完成する。最初の保存前の失敗、または明示的なatomic拒否ではpending claimを条件付きで解放し、同じkeyで再試行できる。保存を始めた後の結果不明の失敗では二重実行を避けて保持する。古いclaimの解放・completeは置き換え済み/完成済みclaimを変更できない。

chatは推薦所有者の検証を最初に行い、未期限切れのsnapshot・Storage-backed cards・conversationだけをモデルへ渡す。snapshot欠落/期限切れはcontext=null。現snapshot契約はscenarioTimeを保持しないためsimulationもcontext=nullとし、状況時刻を作らない。appendはrepositoryが所有者・8 turns・expiryを原子的に再確認する。

## Runtime設定と残る依存

`packages/config`がstage/Region/table/model・provider予算・TTLを環境変数から検証する。model IDをコードへ固定しない。設定不備は503、healthは独立して動作する。`pnpm build`はNode 24向け`dist/handler.cjs`を生成し、CDKもruntime入口をbundleする。

現在のruntimeはB Phase 1のDynamoDB/Places V2/Open-Meteo/Bedrock decide factoriesと、今回のDynamoDB冪等性adapter修正を接続済み。B Phase 2のGeocode・Routes adapters、Bedrock followUp、repositoryのconversationは未実装。このためroute依存の候補はunavailable、chatは503になる。認証付き5ケースsmokeの完了にはB Phase 2の取り込みが必要。DynamoDB Local検証をAWS/live完了とは扱わない。

Bへの追加要求: atomic commitで最新notificationFrequencyを再計算・条件確認する（現transactionのprofile条件はnotificationsEnabled/timezoneのみ）。preferences変更と配信が競合する場合のcap保証はこの修正が必要。ownerのdev deploy、実provider/別ユーザー/preview quota smoke、AWS MCP証跡は未実施。

JSONログはrequest ID・route分類・HTTP status・mode・errorCodeだけ。tokens、claims、body、query、raw pathやprivate contextを出力しない。
