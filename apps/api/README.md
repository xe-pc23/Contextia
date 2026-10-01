# API — Phase 1（D、進行中）

`pnpm dev:api`をルートから実行すると`http://127.0.0.1:3001/health`を確認できる。Lambdaの`src/handler.ts`とローカルHTTP serverは同じrequest handlerを使用する。

## ルート

| ルート | 認証 | 現在の動作 |
|---|---|---|
| `GET /health` | なし | `{status:"ok", version}`。外部provider・DynamoDB・認証にアクセスしない |
| `POST /v1/context/evaluate` | Cognito JWT（API Gatewayのauthorizer） | 下記の入口検証のあと、注入された評価serviceを実行。未注入なら`503 EVALUATION_UNAVAILABLE` |
| その他 | — | `404 NOT_FOUND` |

`/v1/context/evaluate`の入口:

1. JWT authorizerのclaimsから`sub`と`client_id`を読む。`token_use=access`以外（ID tokenなど）は401。
2. bodyは256 KiBまで（超過は413）。JSONでなければ400。
3. `ContextEvaluateRequestSchema`で検証し、違反は400 `VALIDATION_ERROR`と`details[].path`。
4. `simulation/preview`はWeb（Scenario Console）clientだけ、`real/proactive`はMobile clientだけに許可し、それ以外は403。client IDはCDKがLambda環境変数`WEB_CLIENT_ID`/`MOBILE_CLIENT_ID`に渡し、未設定なら常に403（fail closed）。
5. `HandlerOptions.evaluate`に評価serviceが注入されていれば実行し、`200 {requestId, data: EvaluationResult}`を返す。`PROFILE_NOT_FOUND`は404、`STATE_UNAVAILABLE`は503、それ以外の例外は内部メッセージを出さず500 `INTERNAL_ERROR`。
6. 本番の`handler`はまだ評価serviceを注入しない（B の adapter が未実装のため）。推薦を作らず503を返す。

## 評価service（`src/application/evaluateContext.ts`）

`createEvaluateContext(deps)`は外部依存をすべて注入で受け取る。domain（A）は`src/application/evaluationDomain.ts`の`EvaluationDomain`、provider（B）は`@contextia/providers`のportsを使う。

1. 1回だけ取得したサーバー時刻で、profile・state を読み、事前ガードを実行する。simulationの時だけ`preferencesOverride`を適用する。
2. previewも含めて context snapshot（calendar IDはハッシュ化、24時間TTL）と fingerprint を保存する。
3. proactiveでガードされたら provider・Bedrock を呼ばずに silent。候補なしは`NO_CANDIDATE`。
4. 候補ごとにtrigger/anchorガードを実行。previewは候補を残し、`wouldSuppress`の診断だけを返す。
5. `places-near-current`だけPlaces（`single-use`、2.5秒timeout）を呼ぶ。未接続のweather/routes/geocodingは`unavailable`/`PROVIDER_NOT_CONNECTED`と報告し、値を作らない。
6. モデル（7秒timeout）の出力をZodで検証し、入力にないplace ID・routeを参照したら`error`として silent にする。
7. proactive notify は`recordProactiveDelivery`で原子的に再確認してから推薦を保存する。previewは日次枠を消費しない。
8. 応答のplaceはprovider正規化データ、保存するplaceは`GetPlace(storage)`の結果だけ。推薦は7日TTL。

## A の domain との接続（`src/composition/evaluationDomain.ts`）

`createEvaluationDomain()`はA（`@contextia/domain`）の`evaluateDeliveryGuards`・`normalizeDetectorContext`・`stepGoalRestDetector`を`EvaluationDomain`に合わせる。両方のガードに同じリクエスト開始時刻を渡し、timezoneは有効なpreferencesのものを使う。

- `STEP_GOAL_REST`のanchor窓はAの方針どおり「同じローカル日」。Bの`recordProactiveDelivery`は秒数しか受け取らないため、「ローカルの0時からの経過秒」を渡す（DST切替日は切替幅だけずれうる）。
- fingerprintはサーバー処理時刻とそろったときだけAのガードに渡す（時刻なしで渡すと同一contextの再実行で例外になる）。`UserState`にはまだ時刻がない（issue #5）ため、評価serviceはfingerprintが一致したときだけ`latestContext`のsnapshotを読み、サービスが書いた`createdAt`（サーバー時刻、シミュレーションの`capturedAt`ではない）を補う。これでproactiveの重複はBedrockより前に止まり、previewでも`DUPLICATE_CONTEXT`を診断できる。snapshotが期限切れならfingerprintを古いものとして外し、読めなければ`STATE_UNAVAILABLE`で止める。portに時刻が加われば追加の読み込みはしない。

既知の制約: 重複判定に必要なサーバー処理時刻が`UserState`にない（issue #5）。上記のsnapshot読み込みで補っている。モデルはtriggerを返さないため、Phase 1では最も確度の高い候補のtriggerを採用する。

ローカルserverにはJWT authorizerがないため、評価ルートは401になる。

## ログ

JSONログにはrequest ID、route分類、HTTP status、評価mode、エラーコードだけを記録する。token、claims、body、query、raw pathは記録しない。

`pnpm build`はNode.js 24向けの`dist/handler.cjs`も生成する。CDKは`NodejsFunction`で同じhandlerをbundleする。
