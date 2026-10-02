import { beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({
  platform: 'ios', permission: vi.fn(), request: vi.fn(), available: vi.fn(), history: vi.fn(),
  sdk: vi.fn(), initialize: vi.fn(), grants: vi.fn(), healthRequest: vi.fn(), aggregate: vi.fn()
}));
vi.mock('react-native', () => ({ Platform: { get OS() { return native.platform; } } }));
vi.mock('expo-sensors', () => ({ Pedometer: { getPermissionsAsync: native.permission, requestPermissionsAsync: native.request, isAvailableAsync: native.available, getStepCountAsync: native.history } }));
vi.mock('react-native-health-connect', () => ({ getSdkStatus: native.sdk, SdkAvailabilityStatus: { SDK_AVAILABLE: 3 }, initialize: native.initialize, getGrantedPermissions: native.grants, requestPermission: native.healthRequest, aggregateRecord: native.aggregate }));
import { createNativeStepSource } from '../src/context/nativeSteps';

beforeEach(() => {
  vi.resetAllMocks(); native.platform = 'ios';
  native.available.mockResolvedValue(true); native.permission.mockResolvedValue({ granted: false, canAskAgain: true });
  native.request.mockResolvedValue({ granted: true }); native.history.mockResolvedValue({ steps: 91 });
  native.sdk.mockResolvedValue(3); native.initialize.mockResolvedValue(true); native.grants.mockResolvedValue([]);
  native.healthRequest.mockResolvedValue([{ recordType: 'Steps', accessType: 'read' }]); native.aggregate.mockResolvedValue({ COUNT_TOTAL: 304, dataOrigins: ['com.example.step-source'] });
});
it('requests iOS motion permission only during an explicit foreground read', async () => {
  expect(await createNativeStepSource().getTodaySteps(new Date())).toMatchObject({ steps: 91, source: 'ios-pedometer' });
  expect(native.request).toHaveBeenCalledTimes(1);
});
it('never prompts from a headless iOS read', async () => {
  expect(await createNativeStepSource({ background: true }).getTodaySteps(new Date())).toEqual({ status: 'denied' });
  expect(native.request).not.toHaveBeenCalled(); expect(native.history).not.toHaveBeenCalled();
});
it('uses aggregate Health Connect steps on Android without Pedometer history', async () => {
  native.platform = 'android';
  expect(await createNativeStepSource().getTodaySteps(new Date())).toMatchObject({ steps: 304, source: 'android-health-connect' });
  expect(native.history).not.toHaveBeenCalled();
  expect(native.aggregate).toHaveBeenCalledWith(expect.objectContaining({ recordType: 'Steps', timeRangeFilter: expect.objectContaining({ operator: 'between' }) }));
});
it('does not request health authorization or aggregate without a granted background permission', async () => {
  native.platform = 'android'; native.grants.mockResolvedValue([{ recordType: 'Steps', accessType: 'read' }]);
  expect(await createNativeStepSource({ background: true }).getTodaySteps(new Date())).toEqual({ status: 'unavailable' });
  expect(native.healthRequest).not.toHaveBeenCalled(); expect(native.aggregate).not.toHaveBeenCalled();
  native.grants.mockResolvedValue([{ recordType: 'Steps', accessType: 'read' }, { recordType: 'BackgroundAccessPermission', accessType: 'read' }]);
  expect(await createNativeStepSource({ background: true }).getTodaySteps(new Date())).toMatchObject({ steps: 304 });
});
it('keeps an empty Health Connect store unknown while accepting a measured zero from a source', async () => {
  native.platform = 'android';
  native.aggregate.mockResolvedValue({ COUNT_TOTAL: 0, dataOrigins: [] });
  expect(await createNativeStepSource().getTodaySteps(new Date())).toEqual({ status: 'unavailable' });
  native.aggregate.mockResolvedValue({ COUNT_TOTAL: 0, dataOrigins: ['com.example.steps'] });
  expect(await createNativeStepSource().getTodaySteps(new Date())).toMatchObject({ status: 'granted', steps: 0 });
});
