# iPhone 実機テスト引き継ぎ

2026-10-03 に所有者が実機テストを他メンバーへ委任。担当メンバーの Mac と iPhone を使う。
Android の作業は中断中。この文書は手順であり、実機テストの成功記録ではない。

## 1. 対象と準備

- ブランチ: `codex/local-delivery`。実装基準 SHA: `8bb6c9af94103a41bbad28a960a18397f4da1cc2`。
  その後の文書変更を含む場合も、実際の `git rev-parse HEAD` を結果に記録する。
- stage: `dev`。Expo Go ではなく React Native / Expo development build を使う。
- Node 24.13.1 / pnpm 10.29.3、CocoaPods、iPhone の OS に対応する Xcode を用意する。
  現在の iOS deployment target は 16.4。Git 管理外の `apps/mobile/ios/.xcode.env.local` に
  `NODE_BINARY` がある場合は、担当 Mac の Node 24.13.1 のパスを指していることを確認する。
- iPhone を担当 Mac とペアリングし、Developer Mode を有効にする。接続方法は
  [Apple の手順](https://developer.apple.com/documentation/xcode/managing-your-simulated-and-physical-devices-in-device-hub)
  に従う。担当 Mac で有線接続できるなら、それを使える。
- 担当者の Apple 開発チームで署名する。現在の通知 plugin は `aps-environment` を生成するため、
  Push Notifications に対応するチーム／profile が必要。無料 Personal Team でこの構成が署名できると
  は扱わない。[Apple の capability 対応表](https://developer.apple.com/help/account/reference/supported-capabilities-ios/)
  を確認し、署名エラーはそのまま `blocked` と報告する。
- Apple Account、署名秘密鍵、AWS 資格情報は共有不要。テストアカウントは所有者から私的な経路で受け取る。
  CI の smoke アカウントとは別の担当者用アカウントを使う。Git、画像、公開 PR に資格情報を記載しない。

公開 dev 設定（所有者の CDK outputs から確認。再配備で変更された場合は最新値を使う）を
`apps/mobile/.env.example` から作った **Git 管理外** の `apps/mobile/.env.local` に記入する:

```dotenv
EXPO_PUBLIC_STAGE=dev
EXPO_PUBLIC_API_BASE_URL=https://d9abk3hw01.execute-api.ap-northeast-1.amazonaws.com
EXPO_PUBLIC_COGNITO_ISSUER=https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_AlEQi8Vq9
EXPO_PUBLIC_COGNITO_CLIENT_ID=59ju2dibjn5aq3sjsq0hboclu6
EXPO_PUBLIC_COGNITO_REDIRECT_URI=contextia-dev://auth/callback
```

上記 client ID は Mobile 用。Web client に差し替えない。パスワード・token はこのファイルに入れない。

## 2. ローカルビルドと接続

リポジトリのルートから実行する:

```bash
pnpm install --frozen-lockfile
EXPO_PUBLIC_STAGE=dev pnpm --filter @contextia/mobile exec expo prebuild \
  --platform ios --no-install --skip-dependency-update react,react-native
cd apps/mobile/ios
COCOAPODS_DISABLE_STATS=1 pod install
```

Xcode で `apps/mobile/ios/Contextiadev.xcworkspace` を開き、app target の Signing & Capabilities で
担当者の Team と自動署名を選ぶ。実機を実行先に設定する。Apple ログイン・MFA・端末の信頼確認は担当者が行う。
Simulator 用の `CODE_SIGNING_ALLOWED=NO` や ad hoc 署名を実機へ流用しない。

リポジトリのルートに戻り、Metro を起動する:

```bash
EXPO_PUBLIC_STAGE=dev NODE_OPTIONS=--dns-result-order=ipv4first \
  pnpm --filter @contextia/mobile dev --lan --max-workers 2
```

別ターミナルの同じルートから実機へビルド・インストールする:

```bash
EXPO_PUBLIC_STAGE=dev pnpm --filter @contextia/mobile ios --device --no-bundler
```

iPhone と Mac を同じ信頼できる LAN に接続する。開発 client が接続を求めたら、Metro が表示する
Mac の LAN URL（例 `http://<MacのLAN IP>:8081`）を選ぶ。`127.0.0.1` は iPhone 自身を指すため使わない。
Local Network の許可が出たら確認する。接続できない場合は到達性／ネットワーク設定を確認し、
ファイアウォール全体の無効化や公開 tunnel で解決しない。
iPhone の Safari で `http://<MacのLAN IP>:8081/status` が `packager-status:running` を返すかが
到達性の確認になる。Debug 検証中は Mac と Metro を起動したままにする。

## 3. 時間内に優先して確認する順序

1. **起動・認証:** Contextia が表示される → PKCE サインイン → owned 履歴／設定が読み込まれる。
2. **foreground:** 位置・Calendar・Motion を許可して収集。中立的なテスト予定の title/time/location を
   使用する。Calendar の拒否、位置の拒否も別ケースとして確認する。
3. **API／画面:** dev 評価 → 提案の detail → follow-up chat。silent／provider degraded も正当な結果として
   診断を記録する。配信回数上限や重複 guard を解除したり、成功が出るまで無制限に評価しない。
4. **保存・終了:** preference 保存／再取得 → 元へ戻す → サインアウト。位置／予定／結果／chat の private UI が消える。
5. **実機固有:** 今日の歩数を独立した基準と照合、local notification の表示・重複防止・tap → owned detail、
   populated pending/displayed notification の logout cleanup、map/route の deep link、access refresh を確認する。
6. **別枠:** background location callback の観測、通知拒否、remote notification の OS 表示。
   background callback は一定間隔を保証しない。SNS は未設定／無効のため、その経路は設定なしのまま成功としない。

許可されない／読めない歩数は `unknown`。0 として扱わない。OS 通知の実表示と API の予約・provider acceptance は
別の結果として記録する。完全な必須行は [Mobile validation の表](MOBILE_VALIDATION.md#record-actual-results) を使う。

## 4. 返してほしい結果

```text
testedAt (JST):
appCommit (git rev-parse HEAD):
nativeBuildSourceCommit（インストールした binary のソース）:
metroSourceCommit（binary と異なる場合）:
backendVersion (public API /health):
stage: dev
deviceModel / iOSVersion / XcodeVersion:
buildType: native development build
signing: compatible team / blocked（Apple ID・Team ID・秘密鍵は不要）

check | passed / failed / not available / blocked | observed result
起動・PKCE:
refresh・sign-out:
GPS allow / deny:
Calendar allow / deny:
評価・detail・chat:
preferences 保存・復元:
今日の歩数:
local notification / dedup / tap / logout cleanup:
background callback:
map / route deep link:
remote notification:

failure reproduction: 操作順、期待値、実際の表示、再現回数
evidence: 資格情報・私的な予定／正確な位置を除いた画面
```

token／push token／パスワード／Apple Account 画面、私的な予定の詳細や GPS 履歴は送らない。
アプリ通知に専用アカウントが表示される場合も、公開証跡では識別情報を除く。
担当メンバーから結果が返るまで、実機・sensor・background・OS 通知の完了判定は保留する。
