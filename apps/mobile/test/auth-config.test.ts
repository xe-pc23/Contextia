import { describe, expect, it } from 'vitest';
import { readCognitoConfiguration } from '../src/auth/cognitoConfig';
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
      redirectUri: 'contextia-dev://auth'
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
