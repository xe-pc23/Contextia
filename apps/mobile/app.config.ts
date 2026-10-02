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
  android: {
    package: `com.contextia.${stage}`,
    permissions: ['android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.READ_CALENDAR']
  },
  plugins: [
    'expo-dev-client',
    [
      'expo-location',
      { locationWhenInUsePermission: 'Contextia uses your location while you use the app to prepare relevant suggestions.' }
    ],
    [
      'expo-calendar',
      { calendarPermission: 'Contextia uses event titles, times, and locations to prepare relevant suggestions.' }
    ],
    ['expo-secure-store', { configureAndroidBackup: true }]
  ]
};

export default config;
