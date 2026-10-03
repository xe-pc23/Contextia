import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import type { CognitoConfiguration } from './cognitoConfig';
import { performCognitoBrowserLogout } from './cognitoLogout';
import { createSecureSessionStore } from './secureSessionStore';
import { SessionManager } from './sessionManager';
import { toStoredSession, type StoredSession } from './sessionModel';
import { withTimeout } from '../async/withTimeout';
import { disableBackground } from '../background/control';
import type { AuthMessageKey } from '../i18n/messages';

export type CognitoAuthState = {
  status: 'loading' | 'signed-out' | 'signed-in' | 'error';
  busy: boolean;
  /** Key into the localized auth messages; the screen chooses the language. */
  message: AuthMessageKey | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  getSessionSignal: () => AbortSignal;
  rejectAccessToken: (accessToken: string, sessionSignal: AbortSignal | undefined) => Promise<void>;
};

function toSession(token: AuthSession.TokenResponse, previousRefreshToken?: string): StoredSession | null {
  const refreshToken = token.refreshToken ?? previousRefreshToken;
  return toStoredSession({
    accessToken: token.accessToken, expiresIn: token.expiresIn,
    ...(refreshToken === undefined ? {} : { refreshToken })
  }, Math.floor(Date.now() / 1000));
}

export function useCognitoAuth(config: CognitoConfiguration): CognitoAuthState {
  const discovery = AuthSession.useAutoDiscovery(config.issuer);
  const discoveryRef = useRef(discovery);
  const lifecycle = useRef(0);
  const working = useRef(false);
  const [status, setStatus] = useState<CognitoAuthState['status']>('loading');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<AuthMessageKey | null>(null);
  const requestConfiguration = useMemo<AuthSession.AuthRequestConfig>(() => ({
    clientId: config.clientId, redirectUri: config.redirectUri, scopes: ['openid'],
    responseType: AuthSession.ResponseType.Code, usePKCE: true,
    codeChallengeMethod: AuthSession.CodeChallengeMethod.S256
  }), [config.clientId, config.redirectUri]);
  const [request, , promptAsync] = AuthSession.useAuthRequest(requestConfiguration, discovery);
  const manager = useMemo(() => new SessionManager({
    store: createSecureSessionStore(config),
    now: () => Date.now() / 1000,
    onSessionChange: signedIn => setStatus(signedIn ? 'signed-in' : 'signed-out'),
    onSessionCleared: () => disableBackground(config),
    refresh: async stored => {
      const tokenEndpoint = discoveryRef.current?.tokenEndpoint;
      if (!tokenEndpoint || !stored.refreshToken) return { kind: 'unavailable' };
      try {
        const token = await AuthSession.refreshAsync({ clientId: config.clientId, refreshToken: stored.refreshToken }, { tokenEndpoint });
        const session = toSession(token, stored.refreshToken);
        return session ? { kind: 'success', session } : { kind: 'unavailable' };
      } catch (error) {
        return { kind: error instanceof AuthSession.TokenError && error.code === 'invalid_grant' ? 'rejected' : 'unavailable' };
      }
    }
  }), [config.stage, config.clientId]);

  useEffect(() => { discoveryRef.current = discovery; }, [discovery]);
  useEffect(() => () => {
    lifecycle.current++;
    manager.deactivate();
  }, [manager]);

  useEffect(() => {
    if (discovery?.authorizationEndpoint && discovery.tokenEndpoint) return;
    const timer = setTimeout(() => {
      setStatus('error');
      setMessage('serviceUnreachable');
    }, 12_000);
    return () => clearTimeout(timer);
  }, [discovery?.authorizationEndpoint, discovery?.tokenEndpoint]);

  useEffect(() => {
    if (!discovery?.tokenEndpoint) return;
    const generation = lifecycle.current;
    void manager.restore().catch(async () => {
      if (generation !== lifecycle.current) return;
      await manager.clear().catch(() => undefined);
      if (generation === lifecycle.current) setMessage('restoreFailed');
    });
  }, [manager, discovery?.tokenEndpoint]);

  const signIn = useCallback(async () => {
    if (working.current) return;
    if (!request || !discovery?.tokenEndpoint) {
      setMessage('checkServiceThenSignIn');
      return;
    }
    working.current = true;
    const generation = ++lifecycle.current;
    setBusy(true);
    setMessage(null);
    try {
      const result = await promptAsync();
      if (generation !== lifecycle.current) return;
      if (result.type !== 'success') {
        setStatus(result.type === 'error' ? 'error' : 'signed-out');
        if (result.type === 'error') setMessage('signInFailed');
        return;
      }
      const code = result.params['code'];
      const token = result.authentication ?? (code && request.codeVerifier
        ? await withTimeout(AuthSession.exchangeCodeAsync({
            clientId: config.clientId, code, redirectUri: config.redirectUri,
            extraParams: { code_verifier: request.codeVerifier }
          }, { tokenEndpoint: discovery.tokenEndpoint }), 12_000)
        : null);
      if (generation !== lifecycle.current) return;
      const session = token ? toSession(token) : null;
      if (!session) throw new Error('Invalid token response');
      await manager.accept(session);
    } catch {
      if (generation === lifecycle.current) {
        setStatus('error');
        setMessage('signInNetworkFailed');
      }
    } finally {
      if (generation === lifecycle.current) { working.current = false; setBusy(false); }
    }
  }, [config.clientId, config.redirectUri, discovery, manager, promptAsync, request]);

  const signOut = useCallback(async () => {
    if (working.current) return;
    working.current = true;
    const generation = ++lifecycle.current;
    const stored = manager.sessionForRevocation();
    setBusy(true);
    setMessage(null);
    let cleared = true;
    let browserCompleted = false;
    try {
      // Hide private screens and invalidate refresh before any remote logout.
      const clearing = manager.clear().catch(() => { cleared = false; });
      await clearing;
      if (stored?.refreshToken && discovery?.revocationEndpoint) {
        await withTimeout(AuthSession.revokeAsync({
          clientId: config.clientId, token: stored.refreshToken,
          tokenTypeHint: AuthSession.TokenTypeHint.RefreshToken
        }, { revocationEndpoint: discovery.revocationEndpoint }), 12_000).catch(() => undefined);
      }
      browserCompleted = await performCognitoBrowserLogout({
        authorizationEndpoint: discovery?.authorizationEndpoint,
        clientId: config.clientId, redirectUri: config.redirectUri
      }, (url, redirectUri) => WebBrowser.openAuthSessionAsync(url, redirectUri, { preferEphemeralSession: false }));
    } catch {
      // The local session was already invalidated; never expose upstream errors.
    } finally {
      if (generation === lifecycle.current) {
        if (!cleared) setMessage('localClearFailed');
        else if (!browserCompleted) setMessage('remoteSignOutUnconfirmed');
        working.current = false;
        setBusy(false);
      }
    }
  }, [config.clientId, config.redirectUri, discovery, manager]);

  return {
    status, busy, message, signIn, signOut, getAccessToken: manager.getAccessToken,
    getSessionSignal: manager.getSessionSignal, rejectAccessToken: manager.rejectAccessToken
  };
}
