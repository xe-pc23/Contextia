import { describe, expect, it } from 'vitest';
import { readCognitoConfiguration } from '../src/auth/cognitoConfig';
import { createCognitoLogoutUrl, performCognitoBrowserLogout } from '../src/auth/cognitoLogout';
import { parseStoredSession, toStoredSession } from '../src/auth/sessionModel';

describe('Cognito public configuration', () => {
  it('builds a stage-specific callback for the mobile app', () => {
    expect(readCognitoConfiguration({
      EXPO_PUBLIC_STAGE: 'dev',
      EXPO_PUBLIC_COGNITO_ISSUER: 'https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_example',
      EXPO_PUBLIC_COGNITO_CLIENT_ID: 'mobile-client-id'
    })).toEqual({
      stage: 'dev',
      scheme: 'contextia-dev',
      issuer: 'https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_example',
      clientId: 'mobile-client-id',
      redirectUri: 'contextia-dev://auth/callback'
    });
  });

  it('rejects incomplete, insecure, and cross-stage settings', () => {
    expect(readCognitoConfiguration({ EXPO_PUBLIC_COGNITO_CLIENT_ID: 'client' })).toBeNull();
    expect(readCognitoConfiguration({
      EXPO_PUBLIC_COGNITO_ISSUER: 'http://issuer.example.test',
      EXPO_PUBLIC_COGNITO_CLIENT_ID: 'client'
    })).toBeNull();
    expect(readCognitoConfiguration({
      EXPO_PUBLIC_STAGE: 'prod',
      EXPO_PUBLIC_COGNITO_ISSUER: 'https://issuer.example.test/pool',
      EXPO_PUBLIC_COGNITO_CLIENT_ID: 'client',
      EXPO_PUBLIC_COGNITO_REDIRECT_URI: 'contextia-dev://auth'
    })).toBeNull();
  });
});

describe('Cognito browser logout', () => {
  const input = {
    authorizationEndpoint: 'https://contextia-dev.auth.ap-northeast-1.amazoncognito.com/oauth2/authorize',
    clientId: 'mobile-client-id',
    redirectUri: 'contextia-dev://auth'
  };

  it('builds a Hosted UI logout URL using the authorization domain and sign-out callback', () => {
    const logoutUrl = createCognitoLogoutUrl(input);
    expect(logoutUrl).not.toBeNull();
    const parsed = new URL(logoutUrl ?? 'https://invalid.example.test');
    expect(parsed.origin).toBe('https://contextia-dev.auth.ap-northeast-1.amazoncognito.com');
    expect(parsed.pathname).toBe('/logout');
    expect(parsed.searchParams.get('client_id')).toBe(input.clientId);
    expect(parsed.searchParams.get('logout_uri')).toBe(input.redirectUri);
  });

  it('uses the same auth browser session and waits for the configured callback', async () => {
    const calls: Array<{ url: string; redirectUri: string }> = [];
    const completed = await performCognitoBrowserLogout(input, async (url, redirectUri) => {
      calls.push({ url, redirectUri });
      return { type: 'success' };
    });

    expect(completed).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.redirectUri).toBe(input.redirectUri);
    expect(new URL(calls[0]?.url ?? 'https://invalid.example.test').pathname).toBe('/logout');
  });

  it('rejects invalid endpoints and treats a dismissed browser as incomplete logout', async () => {
    expect(createCognitoLogoutUrl({ ...input, authorizationEndpoint: 'http://auth.example.test/oauth2/authorize' })).toBeNull();

    const completed = await performCognitoBrowserLogout(input, async () => ({ type: 'cancel' }));
    expect(completed).toBe(false);
  });
});

describe('Cognito token session projection', () => {
  it('keeps only the access token, optional refresh token, and expiry', () => {
    const session = toStoredSession({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 3600,
      idToken: 'id-token-not-needed',
      tokenType: 'Bearer'
    }, 1_800_000_000);

    expect(session).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAtEpochSeconds: 1_800_003_600
    });
    expect(JSON.stringify(session)).not.toContain('idToken');
    expect(JSON.stringify(session)).not.toContain('id-token-not-needed');
  });

  it('rejects malformed stored sessions', () => {
    expect(parseStoredSession({ accessToken: '', expiresAtEpochSeconds: 0 })).toBeNull();
    expect(parseStoredSession({ accessToken: 'token', expiresAtEpochSeconds: 'later' })).toBeNull();
    expect(toStoredSession({ accessToken: 'token', expiresIn: 0 }, 100)).toBeNull();
  });
});
