import type { GuardCode, ProviderStatusMap, ProviderStatusValue, SignalName, UserPreferences, WeatherReading } from '@contextia/contracts';

export type Language = 'ja' | 'en';

export type AuthMessageKey =
  | 'serviceUnreachable' | 'restoreFailed' | 'checkServiceThenSignIn' | 'signInFailed'
  | 'signInNetworkFailed' | 'localClearFailed' | 'remoteSignOutUnconfirmed';

/** Every user-visible mobile string. Both languages must provide every key. */
export type Messages = {
  intlLocale: string;
  common: { loading: string; processing: string; fetching: string; notFetched: string; listSeparator: string };
  nav: { home: string; settings: string };
  auth: {
    title: string; signedIn: string; checking: string; signInPrompt: string; signIn: string; signOut: string; language: string;
    notConfiguredTitle: string; notConfiguredBody: string; apiNotConfiguredTitle: string; apiNotConfiguredBody: string;
    messages: Record<AuthMessageKey, string>;
  };
  signals: Record<SignalName, string>;
  guards: Record<GuardCode, string>;
  failures: {
    invalidRequest: string; unauthenticated: string; invalidResponse: string; networkError: string; timeout: string;
    cancelled: string; locationRequired: string; invalidContext: string; profileRequired: string;
    http401: string; http403: string; profileNotFound: string; http404: string; chatLimit: string; http429: string;
    http503: string; generic: string; requestId: string;
  };
  weather: {
    notFetched: string; conditions: Record<WeatherReading['condition'], string>; temperatureUnknown: string;
    forecast: (start: string, end: string) => string; observed: (at: string) => string;
  };
  permission: { granted: string; denied: string; unknown: string };
  collection: {
    notRead: string; locationUnavailable: string; invalid: string; location: string; capturedAt: string;
    calendar: string; calendarCount: (count: number) => string; stepsToday: string; steps: (value: string) => string;
    stepGoal: string; lowConfidenceSteps: string;
  };
  providers: Record<keyof ProviderStatusMap, string>;
  providerStates: Record<ProviderStatusValue, string>;
  providerHealthTitle: string;
  cards: {
    travelTime: (minutes: number) => string; transfers: (count: number) => string; depart: string; arrive: string;
    openSource: string; openMap: string; openRoute: string; openWebsite: string; linkFailed: string;
  };
  dashboard: {
    contextTitle: string; contextNote: string; nextEvent: string; noNextEvent: string; calendarPrivacy: string;
    reading: string; read: string; evaluating: string; evaluate: string;
    latestTitle: string; notifyTitle: string; silentTitle: string; idleHint: string; evaluatingBody: string;
    usedSignals: string; viewDetail: string;
    weatherTitle: string; weatherNotRequested: string; weatherUnavailable: string; weatherHint: string;
    historyTitle: string; refresh: string; noHistory: string; detail: string; loadMore: string;
  };
  settings: {
    title: string; reload: string; loadingBody: string; editAfterLoad: string;
    interests: string; stepGoal: string; frequency: string; frequencies: Record<UserPreferences['notificationFrequency'], string>;
    notificationsEnabled: string; language: string; languageQuick: string; timezone: string; invalid: string;
    saving: string; save: string; saved: string;
  };
  detail: { title: string; loading: string; retry: string; ask: string; questionLabel: string; sending: string; send: string };
  background: {
    title: string; enabled: string; disabled: string; note: string; configuring: string; stop: string; start: string;
    startFailed: string; checkFailed: string; androidServiceBody: string;
  };
};

const ja: Messages = {
  intlLocale: 'ja-JP',
  common: { loading: '取得しています…', processing: '処理中…', fetching: '取得中…', notFetched: '未取得', listSeparator: '、' },
  nav: { home: 'ホーム', settings: '設定' },
  auth: {
    title: 'アカウント', signedIn: 'サインイン済み', checking: '認証を確認しています…', signInPrompt: 'サインインして提案を受け取る',
    signIn: 'サインイン', signOut: 'サインアウト', language: '表示言語',
    notConfiguredTitle: '認証が未設定です', notConfiguredBody: 'アプリの認証設定を用意してから、再度開いてください。',
    apiNotConfiguredTitle: '接続先が未設定です', apiNotConfiguredBody: 'アプリの API 接続設定を用意してから、再度開いてください。',
    messages: {
      serviceUnreachable: '認証サービスに接続できません。ネットワークを確認してください。',
      restoreFailed: '保存済みの認証を復元できませんでした。もう一度サインインしてください。',
      checkServiceThenSignIn: '認証サービスへの接続を確認してから、もう一度サインインしてください。',
      signInFailed: 'サインインできませんでした。認証設定を確認してください。',
      signInNetworkFailed: 'サインインできませんでした。ネットワークと認証設定を確認してください。',
      localClearFailed: '端末に保存した認証を削除できませんでした。端末の設定を確認してください。',
      remoteSignOutUnconfirmed: '認証サービスからのサインアウトを確認できませんでした。ネットワークを確認してください。'
    }
  },
  signals: {
    time: '時刻', location: '現在地', calendar: '予定', steps: '歩数',
    weather: '天気', places: '周辺の場所', transit: '移動経路', preferences: '好み'
  },
  guards: {
    NOTIFICATIONS_DISABLED: '通知を無効にしています', DAILY_CAP_REACHED: '今日の通知上限に達しました',
    DUPLICATE_CONTEXT: '直近に同じ状況を評価しました', RECENT_SAME_TRIGGER: '同じきっかけの提案をお知らせ済みです',
    NO_CANDIDATE: '提案のきっかけがありません', NO_MEANINGFUL_OPPORTUNITY: '今は新しい提案を控えます'
  },
  failures: {
    invalidRequest: '入力内容を確認してください。',
    unauthenticated: '認証を確認できません。ネットワークを確認して、もう一度お試しください。',
    invalidResponse: '応答を確認できませんでした。もう一度お試しください。',
    networkError: '接続できません。ネットワークを確認してください。',
    timeout: '処理に時間がかかっています。通信や端末の設定を確認して再実行してください。',
    cancelled: '処理を取り消しました。',
    locationRequired: '位置情報の許可と端末の GPS 設定を確認してください。',
    invalidContext: '端末の情報を確認できませんでした。もう一度読み取ってください。',
    profileRequired: '設定を取得してから保存してください。',
    http401: '認証の有効期限が切れました。サインアウトしてから再度サインインしてください。',
    http403: 'このアカウントまたはアプリでは実行できません。認証設定を確認してください。',
    profileNotFound: 'アカウントの設定がまだ用意されていません。',
    http404: 'データが見つかりません。保存期間の終了や接続先の準備状況を確認してください。',
    chatLimit: 'この提案への質問回数の上限に達しました。',
    http429: 'リクエストが集中しています。少し待ってから再実行してください。',
    http503: 'サービスを現在利用できません。時間をおいて再実行してください。',
    generic: '処理に失敗しました。もう一度お試しください。',
    requestId: '問い合わせ ID'
  },
  weather: {
    notFetched: '天気は未取得',
    conditions: { clear: '晴れ', cloudy: '曇り', rain: '雨', snow: '雪', storm: '荒天', unknown: '天候不明' },
    temperatureUnknown: '気温不明',
    forecast: (start, end) => `予報: ${start}〜${end}`, observed: at => `観測: ${at}`
  },
  permission: { granted: '取得済み', denied: '許可なし', unknown: '未取得' },
  collection: {
    notRead: '端末の情報はまだ読み取っていません。', locationUnavailable: '現在地を取得できませんでした。',
    invalid: '取得した情報を確認できませんでした。', location: '現在地', capturedAt: '取得時刻', calendar: '予定',
    calendarCount: count => `${count} 件`, stepsToday: '今日の歩数', steps: value => `${value} 歩`, stepGoal: '歩数目標',
    lowConfidenceSteps: '歩数は前景センサーの参考値です。'
  },
  providers: { weather: '天気', places: '周辺の場所', routes: '移動経路', geocoding: '目的地の確認', bedrock: '提案の生成' },
  providerStates: {
    ok: '取得済み', degraded: '一部取得', unavailable: '取得できません',
    timeout: '時間切れ', error: '取得に失敗', not_requested: '未取得'
  },
  providerHealthTitle: '情報の取得状況',
  cards: {
    travelTime: minutes => `移動時間: ${minutes} 分`, transfers: count => ` / 乗換 ${count} 回`, depart: '出発', arrive: '到着',
    openSource: '提供元を開く', openMap: '地図を開く', openRoute: '移動経路を開く', openWebsite: 'Web サイトを開く',
    linkFailed: 'リンクを開けませんでした。'
  },
  dashboard: {
    contextTitle: '現在地と予定',
    contextNote: '位置と予定は操作した時に読み取ります。「今評価」では、読み取った情報を送って提案を確認します。',
    nextEvent: '次の予定', noNextEvent: '読み取った範囲に次の予定はありません。',
    calendarPrivacy: '送る予定情報は ID ハッシュ・タイトル・日時・場所だけです。参加者や説明・メモは含みません。',
    reading: '読み取り中…', read: '端末の情報を読み取る', evaluating: '評価中…', evaluate: '今評価',
    latestTitle: '最新の評価', notifyTitle: '今のあなたへの提案', silentTitle: '今は提案を控えます',
    idleHint: '「今評価」で現在の状況に合う提案を確認できます。', evaluatingBody: '端末の情報と提案を確認しています…',
    usedSignals: '使った情報', viewDetail: '提案の詳細を見る',
    weatherTitle: '天気', weatherNotRequested: 'この評価では天気を取得していません。',
    weatherUnavailable: '利用できる天気情報がありません。', weatherHint: '今評価で天気を確認できます。',
    historyTitle: '最近の提案', refresh: '一覧を更新', noHistory: '最近の提案はありません。', detail: '詳細を見る',
    loadMore: '続きを読み込む'
  },
  settings: {
    title: '設定', reload: '設定を再取得', loadingBody: '設定を取得しています…', editAfterLoad: '設定の取得後に編集できます。',
    interests: '興味・好み（カンマ区切り）', stepGoal: '歩数目標', frequency: '通知の頻度',
    frequencies: { low: '控えめ', normal: '標準', high: '多め' },
    notificationsEnabled: '通知を有効にする', language: '言語（例: ja-JP）。画面と提案の言語に使います',
    languageQuick: '言語を選ぶ', timezone: 'タイムゾーン（例: Asia/Tokyo）',
    invalid: '歩数目標は 1～200000 の整数、好みは各64文字以内で20件まで、タイムゾーンは IANA 名で入力してください。',
    saving: '保存中…', save: '設定を保存', saved: '設定を保存しました。'
  },
  detail: {
    title: '提案の詳細', loading: '取得しています…', retry: '再取得', ask: 'この提案について質問',
    questionLabel: '提案への質問', sending: '送信中…', send: '質問を送る'
  },
  background: {
    title: 'バックグラウンドの提案', enabled: '有効', disabled: '無効',
    note: '許可すると、OS が位置の変化を知らせた時に提案を確認します。実行間隔は端末により異なります。認証が期限切れの時はアプリを開いてください。',
    configuring: '設定中…', stop: 'バックグラウンドを停止', start: 'バックグラウンドを有効にする',
    startFailed: '開始できませんでした。通知設定、位置情報の「常に許可」、認証を確認してください。',
    checkFailed: '端末の設定を確認できませんでした。もう一度お試しください。',
    androidServiceBody: 'バックグラウンドで周辺の提案を確認しています'
  }
};

const en: Messages = {
  intlLocale: 'en-US',
  common: { loading: 'Loading…', processing: 'Working…', fetching: 'Loading…', notFetched: 'Not available', listSeparator: ', ' },
  nav: { home: 'Home', settings: 'Settings' },
  auth: {
    title: 'Account', signedIn: 'Signed in', checking: 'Checking sign-in…', signInPrompt: 'Sign in to receive suggestions',
    signIn: 'Sign in', signOut: 'Sign out', language: 'Display language',
    notConfiguredTitle: 'Sign-in is not configured', notConfiguredBody: 'Configure the app’s sign-in settings, then reopen the app.',
    apiNotConfiguredTitle: 'Server is not configured', apiNotConfiguredBody: 'Configure the app’s API connection, then reopen the app.',
    messages: {
      serviceUnreachable: 'Cannot reach the sign-in service. Check your network.',
      restoreFailed: 'Could not restore your saved sign-in. Please sign in again.',
      checkServiceThenSignIn: 'Check your connection to the sign-in service, then sign in again.',
      signInFailed: 'Could not sign in. Check the sign-in settings.',
      signInNetworkFailed: 'Could not sign in. Check your network and the sign-in settings.',
      localClearFailed: 'Could not remove the sign-in saved on this device. Check your device settings.',
      remoteSignOutUnconfirmed: 'Could not confirm sign-out with the sign-in service. Check your network.'
    }
  },
  signals: {
    time: 'Time', location: 'Location', calendar: 'Calendar', steps: 'Steps',
    weather: 'Weather', places: 'Nearby places', transit: 'Route', preferences: 'Preferences'
  },
  guards: {
    NOTIFICATIONS_DISABLED: 'Notifications are turned off', DAILY_CAP_REACHED: 'Today’s notification limit has been reached',
    DUPLICATE_CONTEXT: 'The same situation was evaluated recently', RECENT_SAME_TRIGGER: 'A suggestion for the same trigger was already sent',
    NO_CANDIDATE: 'Nothing to suggest right now', NO_MEANINGFUL_OPPORTUNITY: 'Holding off on new suggestions for now'
  },
  failures: {
    invalidRequest: 'Please check your input.',
    unauthenticated: 'Could not verify your sign-in. Check your network and try again.',
    invalidResponse: 'Could not read the response. Please try again.',
    networkError: 'Cannot connect. Check your network.',
    timeout: 'This is taking too long. Check your connection and device settings, then try again.',
    cancelled: 'Cancelled.',
    locationRequired: 'Check location permission and your device’s GPS settings.',
    invalidContext: 'Could not read device information. Please read it again.',
    profileRequired: 'Load your settings before saving.',
    http401: 'Your sign-in has expired. Sign out and sign in again.',
    http403: 'This account or app is not allowed to do this. Check the sign-in settings.',
    profileNotFound: 'Your account settings are not ready yet.',
    http404: 'Not found. It may have expired, or the server may not be ready.',
    chatLimit: 'You have reached the question limit for this suggestion.',
    http429: 'Too many requests. Wait a moment and try again.',
    http503: 'The service is unavailable right now. Try again later.',
    generic: 'Something went wrong. Please try again.',
    requestId: 'Request ID'
  },
  weather: {
    notFetched: 'Weather not available',
    conditions: { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', snow: 'Snow', storm: 'Storm', unknown: 'Unknown' },
    temperatureUnknown: 'Temperature unknown',
    forecast: (start, end) => `Forecast: ${start}–${end}`, observed: at => `Observed: ${at}`
  },
  permission: { granted: 'Available', denied: 'Not allowed', unknown: 'Not available' },
  collection: {
    notRead: 'Device information has not been read yet.', locationUnavailable: 'Could not get your location.',
    invalid: 'Could not verify the information that was read.', location: 'Location', capturedAt: 'Captured', calendar: 'Calendar',
    calendarCount: count => `${count} ${count === 1 ? 'event' : 'events'}`, stepsToday: 'Steps today', steps: value => `${value} steps`,
    stepGoal: 'Step goal', lowConfidenceSteps: 'Steps are an estimate from the foreground sensor.'
  },
  providers: { weather: 'Weather', places: 'Nearby places', routes: 'Routes', geocoding: 'Destination lookup', bedrock: 'Suggestion generation' },
  providerStates: {
    ok: 'OK', degraded: 'Partial', unavailable: 'Unavailable',
    timeout: 'Timed out', error: 'Failed', not_requested: 'Not requested'
  },
  providerHealthTitle: 'Data sources',
  cards: {
    travelTime: minutes => `Travel time: ${minutes} min`, transfers: count => ` / ${count} ${count === 1 ? 'transfer' : 'transfers'}`,
    depart: 'Depart', arrive: 'Arrive',
    openSource: 'Open source', openMap: 'Open map', openRoute: 'Open route', openWebsite: 'Open website',
    linkFailed: 'Could not open the link.'
  },
  dashboard: {
    contextTitle: 'Location and calendar',
    contextNote: 'Location and calendar are read only when you ask. “Evaluate now” sends what was read and checks for suggestions.',
    nextEvent: 'Next event', noNextEvent: 'No upcoming events in the range that was read.',
    calendarPrivacy: 'Only a hashed ID, title, time and location are sent for events. Attendees, descriptions and notes are never included.',
    reading: 'Reading…', read: 'Read device information', evaluating: 'Evaluating…', evaluate: 'Evaluate now',
    latestTitle: 'Latest evaluation', notifyTitle: 'Suggestions for you now', silentTitle: 'No suggestions right now',
    idleHint: 'Tap “Evaluate now” to see suggestions for your current situation.', evaluatingBody: 'Checking device information and suggestions…',
    usedSignals: 'Signals used', viewDetail: 'View suggestion details',
    weatherTitle: 'Weather', weatherNotRequested: 'Weather was not requested for this evaluation.',
    weatherUnavailable: 'No weather information is available.', weatherHint: 'Evaluate now to check the weather.',
    historyTitle: 'Recent suggestions', refresh: 'Refresh', noHistory: 'No recent suggestions.', detail: 'Details',
    loadMore: 'Load more'
  },
  settings: {
    title: 'Settings', reload: 'Reload settings', loadingBody: 'Loading settings…', editAfterLoad: 'Settings can be edited after they load.',
    interests: 'Interests (comma-separated)', stepGoal: 'Step goal', frequency: 'Notification frequency',
    frequencies: { low: 'Low', normal: 'Normal', high: 'High' },
    notificationsEnabled: 'Enable notifications', language: 'Language (e.g. en-US). Used for the app and suggestions',
    languageQuick: 'Choose language', timezone: 'Time zone (e.g. Asia/Tokyo)',
    invalid: 'Step goal must be a whole number from 1 to 200000, up to 20 interests of 64 characters each, and the time zone must be an IANA name.',
    saving: 'Saving…', save: 'Save settings', saved: 'Settings saved.'
  },
  detail: {
    title: 'Suggestion details', loading: 'Loading…', retry: 'Retry', ask: 'Ask about this suggestion',
    questionLabel: 'Question about the suggestion', sending: 'Sending…', send: 'Send question'
  },
  background: {
    title: 'Background suggestions', enabled: 'On', disabled: 'Off',
    note: 'When allowed, suggestions are checked when the OS reports a location change. How often this runs depends on the device. If your sign-in expires, open the app.',
    configuring: 'Updating…', stop: 'Stop background', start: 'Turn on background',
    startFailed: 'Could not start. Check notification settings, “Always” location access, and your sign-in.',
    checkFailed: 'Could not check device settings. Please try again.',
    androidServiceBody: 'Checking for nearby suggestions in the background'
  }
};

const catalogs: Record<Language, Messages> = { ja, en };

/** Japanese for `ja*` locales; English for every other locale. */
export function languageForLocale(locale: string | null | undefined): Language {
  return locale?.trim().toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

export function messagesFor(language: Language): Messages {
  return catalogs[language];
}

export const DEFAULT_LANGUAGE: Language = 'ja';

/**
 * The saved profile locale wins while signed in; otherwise the language last chosen in the app.
 * The device language is never consulted, so the app controls its own display language.
 */
export function resolveLanguage(profileLocale: string | null | undefined, savedLanguage: Language | null): Language {
  return profileLocale ? languageForLocale(profileLocale) : savedLanguage ?? DEFAULT_LANGUAGE;
}
