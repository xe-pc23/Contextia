import { Platform } from 'react-native';
import { Pedometer } from 'expo-sensors';
import { AndroidHealthConnectStepSource, IosPedometerStepSource, selectStepSource } from './steps';
import type { StepSource } from './types';

export function createNativeStepSource(options: { background?: boolean } = {}): StepSource {
  const background = options.background === true;
  const ios = new IosPedometerStepSource({
    available: () => Pedometer.isAvailableAsync(),
    permission: async () => {
      const current = await Pedometer.getPermissionsAsync();
      const permission = !background && !current.granted && current.canAskAgain
        ? await Pedometer.requestPermissionsAsync() : current;
      return permission.granted ? 'granted' : 'denied';
    },
    read: async (start, end) => (await Pedometer.getStepCountAsync(start, end)).steps
  });
  // Android-only native module is loaded only when Android actually needs it.
  const android = new AndroidHealthConnectStepSource({
    initialize: async () => {
      const health = await import('react-native-health-connect');
      return await health.getSdkStatus() === health.SdkAvailabilityStatus.SDK_AVAILABLE && await health.initialize();
    },
    permissions: async () => {
      const health = await import('react-native-health-connect');
      let grants: Awaited<ReturnType<typeof health.requestPermission>> = await health.getGrantedPermissions();
      if (!background && !grants.some(permission => permission.recordType === 'Steps' && permission.accessType === 'read')) {
        grants = await health.requestPermission([{ recordType: 'Steps', accessType: 'read' }]);
      }
      return {
        steps: grants.some(permission => permission.recordType === 'Steps' && permission.accessType === 'read'),
        background: grants.some(permission => permission.recordType === 'BackgroundAccessPermission' && permission.accessType === 'read')
      };
    },
    read: async (startTime, endTime) => {
      const health = await import('react-native-health-connect');
      const result = await health.aggregateRecord({ recordType: 'Steps', timeRangeFilter: { operator: 'between', startTime, endTime } });
      if (!result.dataOrigins.length) throw new Error('No step measurements');
      return result.COUNT_TOTAL;
    }
  }, background);
  return selectStepSource(Platform.OS, ios, android);
}
