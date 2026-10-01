# API — Phase 1（D、進行中）

`pnpm dev:api`をルートから実行すると`http://127.0.0.1:3001/health`を確認できる。Lambdaの`src/handler.ts`とローカルHTTP serverは同じrequest handlerを使用する。

## ルート

| ルート | 認証 | 現在の動作 |
|---|---|---|
| `GET /health` | なし | `{status:"ok", version}`。外部provider・DynamoDB・認証にアクセスしない |
| `POST /v1/context/evaluate` | Cognito JWT（API Gatewayのauthorizer） | 下記の入口検証のあと、評価serviceの接続まで`503 EVALUATION_UNAVAILABLE` |
| その他 | — | `404 NOT_FOUND` |

`/v1/context/evaluate`の入口:

1. JWT authorizerのclaimsから`sub`と`client_id`を読む。`token_use=access`以外（ID tokenなど）は401。
2. bodyは256 KiBまで（超過は413）。JSONでなければ400。
3. `ContextEvaluateRequestSchema`で検証し、違反は400 `VALIDATION_ERROR`と`details[].path`。
4. `simulation/preview`はWeb（Scenario Console）clientだけ、`real/proactive`はMobile clientだけに許可し、それ以外は403。client IDはCDKがLambda環境変数`WEB_CLIENT_ID`/`MOBILE_CLIENT_ID`に渡し、未設定なら常に403（fail closed）。
5. 評価service（guard→detector→provider→Bedrock→保存）はA/Bの成果を取り込んだ次のD PRで接続する。それまでは推薦を作らず503を返す。

ローカルserverにはJWT authorizerがないため、評価ルートは401になる。

## ログ

JSONログにはrequest ID、route分類、HTTP status、評価mode、エラーコードだけを記録する。token、claims、body、query、raw pathは記録しない。

`pnpm build`はNode.js 24向けの`dist/handler.cjs`も生成する。CDKは`NodejsFunction`で同じhandlerをbundleする。
