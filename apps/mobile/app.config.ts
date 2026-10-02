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
    permissions: ['android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.READ_CALENDAR', 'android.permission.health.READ_STEPS', 'android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND']
  },
  plugins: [
    'expo-dev-client',
    ['expo-build-properties', { android: { minSdkVersion: 26 } }],
    [
      'expo-location',
      {
        locationWhenInUsePermission: 'Contextia uses your location while you use the app to prepare relevant suggestions.',
        locationAlwaysAndWhenInUsePermission: 'With your permission, Contextia checks location in the background to prepare timely suggestions.',
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true
      }
    ],
    [
      'expo-calendar',
      { calendarPermission: 'Contextia uses event titles, times, and locations to prepare relevant suggestions.' }
    ],
    ['expo-secure-store', { configureAndroidBackup: true }],
    ['expo-sensors', { motionPermission: 'Contextia reads today’s steps to suggest a rest after your goal.' }],
    'expo-notifications',
    'react-native-health-connect'
  ]
};

export default config;
