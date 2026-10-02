import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { App } from './App.js';
import type { EvaluationAccess } from './App.js';
import { ensureWebProfile } from './auth/profile.js';
import { WebAuthSession } from './auth/webAuth.js';
import { createScenarioApiClient } from './execution/scenarioApiClient.js';
import { loadWebConfig } from './runtimeConfig.js';
import type { WebConfig } from './runtimeConfig.js';

let configPromise: Promise<WebConfig> | null = null;
export function Bootstrap() {
  const [state, setState] = useState<{ config: WebConfig } | { error: string } | null>(null);
  useEffect(() => {
    let disposed = false;
    configPromise ??= loadWebConfig();
    void configPromise.then(config => { if (!disposed) setState({ config }); }, () => { if (!disposed) setState({ error: '設定を読み込めません。ページを再読み込みしてください。' }); });
    return () => { disposed = true; };
  }, []);
  if (!state || 'error' in state) return <App access={{ status: 'unconnected', pending: [state?.error ?? '接続設定を読み込み中'] }} />;
  return <ConnectedConsole config={state.config} />;
}

function ConnectedConsole({ config }: { config: WebConfig }) {
  const authResult = useMemo(() => {
    try {
      return { auth: new WebAuthSession(config, { storage: window.sessionStorage, crypto: window.crypto, fetch: window.fetch.bind(window), now: Date.now, navigate: url => { window.location.assign(url); }, origin: window.location.origin, clearCallback: () => { window.history.replaceState(null, '', window.location.pathname); } }) };
    } catch { return { error: 'ログインの接続設定を確認してください。' }; }
  }, [config]);
  if (!authResult.auth) return <App mapConfig={config.map} access={{ status: 'unconnected', pending: [authResult.error ?? 'ログイン設定'] }} />;
  return <AuthenticatedConsole config={config} auth={authResult.auth} />;
}

function AuthenticatedConsole({ config, auth }: { config: WebConfig; auth: WebAuthSession }) {
  const session = useSyncExternalStore(auth.subscribe, auth.getSnapshot);
  const [profile, setProfile] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loginError, setLoginError] = useState<string | null>(null);
  const evaluator = useMemo(() => createScenarioApiClient({ baseUrl: config.apiBaseUrl, stage: config.stage, getAccessToken: auth.getAccessToken, onUnauthorized: auth.invalidate }), [config.apiBaseUrl, config.stage, auth]);
  useEffect(() => { void auth.initialize(window.location.href); }, [auth]);
  useEffect(() => {
    if (session.status !== 'signed-in') { setProfile('loading'); return; }
    let disposed = false;
    void auth.getAccessToken().then(async token => {
      if (!token) throw new Error('Signed out');
      await ensureWebProfile(config.apiBaseUrl, token);
      if (!disposed) setProfile('ready');
    }).catch(() => { if (!disposed) setProfile('error'); });
    return () => { disposed = true; };
  }, [session, auth, config.apiBaseUrl]);
  const access: EvaluationAccess = session.status === 'signed-in' && profile === 'ready'
    ? { status: 'ready', evaluator, accountLabel: `${config.stage}・ログイン中` }
    : { status: 'unconnected', pending: [session.status === 'loading' ? 'ログイン確認中' : session.status === 'signed-out' ? session.message ?? 'Cognito ログイン' : profile === 'error' ? 'プロフィールを取得できません。ログインし直してください。' : 'プロフィール確認中', ...(loginError ? [loginError] : [])] };
  const control = session.status === 'signed-in'
    ? <button type="button" onClick={() => auth.signOut()}>ログアウト</button>
    : <button type="button" disabled={session.status === 'loading'} onClick={() => { void auth.signIn().catch(() => { setLoginError('ログインを開始できません。ブラウザの設定を確認してください。'); }); }}>ログイン</button>;
  return <App key={access.status} stage={config.stage} access={access} mapConfig={config.map} accountControl={control} />;
}
