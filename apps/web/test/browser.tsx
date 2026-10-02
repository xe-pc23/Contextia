// Local browser fixture only; Vite's production entry does not include this page.
import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../src/App.js';
import { WebAuthSession } from '../src/auth/webAuth.js';
import { createScenarioApiClient } from '../src/execution/scenarioApiClient.js';
import { parseWebConfig } from '../src/runtimeConfig.js';
import { configFixture } from './support/config.js';
import { envelope, notifyResult } from './support/evaluation.js';
import '../src/styles.css';

const config = parseWebConfig({ ...configFixture, auth: { ...configFixture.auth, redirectUri: `${window.location.origin}/` } });
let destination = ''; let requests = 0; let unauthorized = false;
const auth = new WebAuthSession(config, {
  storage: window.sessionStorage, crypto: window.crypto, now: Date.now, origin: window.location.origin,
  navigate: url => { destination = url; }, clearCallback: () => {},
  fetch: async () => Response.json({ access_token: 'test-double', refresh_token: 'test-double-refresh', expires_in: 3600, token_type: 'Bearer' })
});
const evaluator = createScenarioApiClient({ baseUrl: config.apiBaseUrl, getAccessToken: auth.getAccessToken, onUnauthorized: auth.invalidate, fetch: async (_url, options) => {
  if (unauthorized) return Response.json({ message: 'Unauthorized' }, { status: 401 });
  const input: unknown = JSON.parse(String(options?.body));
  if (typeof input !== 'object' || input === null || !('deliveryMode' in input) || input.deliveryMode !== 'preview') throw new Error('Expected preview');
  requests++;
  const result = notifyResult();
  result.delivery = requests > 1
    ? { mode: 'preview', status: 'preview', wouldSuppress: true, guardCodes: ['DUPLICATE_CONTEXT'] }
    : { mode: 'preview', status: 'preview', wouldSuppress: false, guardCodes: [] };
  return Response.json(envelope(result));
} });
function Fixture() {
  const state = useSyncExternalStore(auth.subscribe, auth.getSnapshot);
  return <>
    <p>ブラウザ操作テスト用の応答です。AWS 実測ではありません。</p>
    <button type="button" onClick={() => { unauthorized = true; }}>次の API 応答を 401 にする</button>
    <App access={state.status === 'signed-in' ? { status: 'ready', evaluator, accountLabel: 'ブラウザテスト' } : { status: 'unconnected', pending: ['再ログインが必要'] }} />
  </>;
}
await auth.signIn();
await auth.initialize(`${window.location.origin}/?code=test-double-code&state=${new URL(destination).searchParams.get('state')}`);
const root = document.getElementById('root');
if (!root) throw new Error('Missing root');
createRoot(root).render(<Fixture />);
