export const configFixture = {
  stage: 'dev', buildId: 'tested-sha', apiBaseUrl: 'https://api.example.com',
  auth: { cognitoDomain: 'https://pool.auth.ap-northeast-1.amazoncognito.com', clientId: 'web-client', redirectUri: 'https://console.example.com/', scopes: ['openid', 'email'] },
  map: { region: 'ap-northeast-1', styleName: 'Standard', apiKey: 'public-restricted-test-key' }
};
