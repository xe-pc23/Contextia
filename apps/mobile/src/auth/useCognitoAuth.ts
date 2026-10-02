import { useCallback, useEffect, useMemo, useState } from 'react';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import type { CognitoConfiguration } from './cognitoConfig';
import { performCognitoBrowserLogout } from './cognitoLogout';
import { clearSecureSession, readSecureSession, writeSecureSession } from './secureSessionStore';
import { toStoredSession, type StoredSession } from './sessionModel';

export type CognitoAuthState = {
  status: 'loading' | 'signed-out' | 'signed-in' | 'error';
  busy: boolean;
  message: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

function toSession(tokenResponse: AuthSession.TokenResponse, previousRefreshToken?: string): StoredSession | null {
  return toStoredSession({
    accessToken: tokenResponse.accessToken,
    expiresIn: tokenResponse.expiresIn,
    ...((tokenResponse.refreshToken ?? previousRefreshToken) === undefined
      ? {}
      : { refreshToken: tokenResponse.refreshToken ?? previousRefreshToken })
  }, Math.floor(Date.now() / 1000));
}

export function useCognitoAuth(config: CognitoConfiguration): CognitoAuthState {
  const discovery = AuthSession.useAutoDiscovery(config.issuer);
  const requestConfiguration = useMemo<AuthSession.AuthRequestConfig>(() => ({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    scopes: ['openid'],
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    codeChallengeMethod: AuthSession.CodeChallengeMethod.S256
  }), [config.clientId, config.redirectUri]);
  const [request, , promptAsync] = AuthSession.useAuthRequest(requestConfiguration, discovery);
  const [status, setStatus] = useState<CognitoAuthState['status']>('loading');
  const [session, setSession] = useState<StoredSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (discovery?.authorizationEndpoint && discovery.tokenEndpoint) return;
    const timeout = setTimeout(() => {
      setStatus('error');
      setMessage('Cognito issuer の discovery 情報を取得できません。Issuer とネットワークを確認してください。');
    }, 12_000);
    return () => clearTimeout(timeout);
  }, [discovery?.authorizationEndpoint, discovery?.tokenEndpoint]);

  useEffect(() => {
    const tokenEndpoint = discovery?.tokenEndpoint;
    if (!tokenEndpoint) return;
    let active = true;

    void (async () => {
      try {
        const stored = await readSecureSession();
        if (!active) return;
        if (stored === null) {
          setSession(null);
          setStatus('signed-out');
          return;
        }

        const now = Math.floor(Date.now() / 1000);
        if (stored.expiresAtEpochSeconds > now + 30) {
          setSession(stored);
          setStatus('signed-in');
          return;
        }
        if (!stored.refreshToken) {
          await clearSecureSession();
          if (active) {
            setSession(null);
            setStatus('signed-out');
          }
          return;
        }

        const refreshed = await AuthSession.refreshAsync({
          clientId: config.clientId,
          refreshToken: stored.refreshToken
        }, { tokenEndpoint });
        const nextSession = toSession(refreshed, stored.refreshToken);
        if (nextSession === null) throw new Error('Invalid token response');
        await writeSecureSession(nextSession);
        if (active) {
          setSession(nextSession);
          setStatus('signed-in');
        }
      } catch {
        await clearSecureSession().catch(() => undefined);
        if (active) {
          setSession(null);
          setStatus('signed-out');
          setMessage('保存済みの認証を復元できませんでした。もう一度サインインしてください。');
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [config.clientId, discovery?.tokenEndpoint]);

  const signIn = useCallback(async () => {
    if (!request || !discovery?.tokenEndpoint) {
      setMessage('認証設定を読み込めません。Issuer と Cognito app client を確認してください。');
      setStatus('error');
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const result = await promptAsync();
      if (result.type !== 'success') {
        if (result.type === 'error') {
          setMessage('サインインに失敗しました。Cognito の callback URL と app client 設定を確認してください。');
          setStatus('error');
        } else {
          setStatus('signed-out');
        }
        return;
      }

      const code = result.params['code'];
      const tokens = result.authentication ?? (code && request.codeVerifier
        ? await AuthSession.exchangeCodeAsync({
            clientId: config.clientId,
            code,
            redirectUri: config.redirectUri,
            extraParams: { code_verifier: request.codeVerifier }
          }, { tokenEndpoint: discovery.tokenEndpoint })
        : null);
      if (!tokens) throw new Error('Token exchange did not return an access token');

      const nextSession = toSession(tokens);
      if (!nextSession) throw new Error('Token response was invalid');
      await writeSecureSession(nextSession);
      setSession(nextSession);
      setStatus('signed-in');
    } catch {
      setMessage('サインインできませんでした。Issuer、client ID、callback URL を確認してください。');
      setStatus('error');
    } finally {
      setBusy(false);
    }
  }, [config.clientId, config.redirectUri, discovery, promptAsync, request]);

  const signOut = useCallback(async () => {
    setBusy(true);
    setMessage(null);

    let browserLogoutCompleted = false;
    try {
      let stored = session;
      if (!stored) {
        try {
          stored = await readSecureSession();
        } catch {
          // Continue with browser logout even if SecureStore cannot be read.
        }
      }
      if (stored?.refreshToken && discovery?.revocationEndpoint) {
        try {
          await AuthSession.revokeAsync({
            clientId: config.clientId,
            token: stored.refreshToken,
            tokenTypeHint: AuthSession.TokenTypeHint.RefreshToken
          }, { revocationEndpoint: discovery.revocationEndpoint });
        } catch {
          // Browser logout is still required when token revocation fails.
        }
      }
      browserLogoutCompleted = await performCognitoBrowserLogout({
        authorizationEndpoint: discovery?.authorizationEndpoint,
        clientId: config.clientId,
        redirectUri: config.redirectUri
      }, (url, redirectUri) => WebBrowser.openAuthSessionAsync(url, redirectUri, {
        preferEphemeralSession: false
      }));
    } catch {
      // Local credentials are still cleared when remote sign-out fails.
    } finally {
      await clearSecureSession().catch(() => undefined);
      setSession(null);
      setStatus('signed-out');
      if (!browserLogoutCompleted) {
        setMessage('Cognito のブラウザーセッションを終了できたか確認できませんでした。ネットワークと sign-out URL の許可設定を確認してください。');
      }
      setBusy(false);
    }
  }, [config.clientId, config.redirectUri, discovery, session]);

  return { status, busy, message, signIn, signOut };
}
