import type { ExpoConfig } from 'expo/config';

const stage = process.env['EXPO_PUBLIC_STAGE'] ?? 'dev';
if (stage !== 'dev' && stage !== 'prod') throw new Error('EXPO_PUBLIC_STAGE must be dev or prod');

const config: ExpoConfig = {
  name: `Contextia ${stage}`,
  slug: 'contextia',
  version: '0.0.1',
  orientation: 'portrait',
  platforms: ['ios', 'android'],
  scheme: `contextia-${stage}`,
  ios: { bundleIdentifier: `com.contextia.${stage}`, supportsTablet: true },
  android: { package: `com.contextia.${stage}` },
  plugins: ['expo-dev-client']
};

export default config;
