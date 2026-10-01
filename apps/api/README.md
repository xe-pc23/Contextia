# API — Phase 0

`pnpm dev:api`をルートから実行すると`http://127.0.0.1:3001/health`を確認できる。

Lambdaの`src/handler.ts`とローカルHTTP serverは同じrequest handlerを使用する。healthは外部provider、DynamoDB、認証にアクセスせず、statusとBUILD_IDだけを返す。他のルートは404。

`pnpm build`はNode.js 24向けの`dist/handler.cjs`も生成する。CDKは`NodejsFunction`で同じhandlerをbundleする。JSONログにはrequest ID、既知route分類、HTTP statusだけを記録する。

次はAのcontracts・Bのportsを取り込み、Phase 1でJWT認証とevaluation application serviceを接続する。Phase 0のhealthだけを推薦アプリとして本番公開しない。
