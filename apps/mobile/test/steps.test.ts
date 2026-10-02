import { describe, expect, it } from 'vitest';
import { AndroidHealthConnectStepSource, ForegroundPedometerFallbackSource, IosPedometerStepSource, selectStepSource } from '../src/context/steps';
import type { StepSource } from '../src/context/types';

describe('native daily steps', () => {
  it('aligns the history window to the saved timezone, including 23/25-hour DST days', async () => {
    const starts: string[] = [];
    const source = new IosPedometerStepSource({ permission: async () => 'granted', available: async () => true, read: async date => { starts.push(date.toISOString()); return 5; } });
    await source.getTodaySteps(new Date('2026-10-03T16:30:00Z'), 'Asia/Tokyo');
    expect(starts.at(-1)).toBe('2026-10-03T15:00:00.000Z');
    await source.getTodaySteps(new Date('2026-03-09T03:59:59Z'), 'America/New_York');
    expect(starts.at(-1)).toBe('2026-03-08T05:00:00.000Z');
    await source.getTodaySteps(new Date('2026-11-02T04:59:59Z'), 'America/New_York');
    expect(starts.at(-1)).toBe('2026-11-01T04:00:00.000Z');
  });
  it('uses iOS history from local midnight and validates the count', async () => {
    const now = new Date(2026, 9, 3, 9, 30);
    let range: Date[] = [];
    const source = new IosPedometerStepSource({
      permission: async () => 'granted', available: async () => true,
      read: async (start, end) => { range = [start, end]; return 10432; }
    });
    expect(await source.getTodaySteps(now)).toEqual({ status: 'granted', steps: 10432, source: 'ios-pedometer', confidence: 'high' });
    expect(range.map(date => date.getTime())).toEqual([new Date(2026, 9, 3).getTime(), now.getTime()]);
    expect(await new IosPedometerStepSource({ permission: async () => 'granted', available: async () => true, read: async () => NaN }).getTodaySteps(now)).toEqual({ status: 'unavailable' });
  });

  it('keeps denial and unsupported hardware distinct from a measured zero', async () => {
    const now = new Date();
    const ports = { permission: async () => 'denied' as const, available: async () => true, read: async () => { throw new Error('must not read'); } };
    expect(await new IosPedometerStepSource(ports).getTodaySteps(now)).toEqual({ status: 'denied' });
    expect(await new IosPedometerStepSource({ ...ports, available: async () => false }).getTodaySteps(now)).toEqual({ status: 'unavailable' });
    expect(await new IosPedometerStepSource({ ...ports, permission: async () => 'granted', read: async () => 0 }).getTodaySteps(now)).toMatchObject({ status: 'granted', steps: 0 });
  });

  it('uses Health Connect aggregation on Android and requires background authorization for a headless read', async () => {
    const now = new Date(2026, 9, 3, 10);
    let range: string[] = [];
    const ports = { initialize: async () => true, permissions: async () => ({ steps: true, background: false }), read: async (start: string, end: string) => { range = [start, end]; return 12001; } };
    expect(await new AndroidHealthConnectStepSource(ports).getTodaySteps(now)).toEqual({ status: 'granted', steps: 12001, source: 'android-health-connect', confidence: 'high' });
    expect(range).toEqual([new Date(2026, 9, 3).toISOString(), now.toISOString()]);
    range = [];
    expect(await new AndroidHealthConnectStepSource(ports, true).getTodaySteps(now)).toEqual({ status: 'unavailable' });
    expect(range).toEqual([]);
    expect(await new AndroidHealthConnectStepSource({ ...ports, permissions: async () => ({ steps: false, background: true }) }).getTodaySteps(now)).toEqual({ status: 'denied' });
  });

  it('selects OS-specific sources without Android historical Pedometer access', async () => {
    const ios: StepSource = { getTodaySteps: async () => ({ status: 'denied' }) };
    const android: StepSource = { getTodaySteps: async () => ({ status: 'granted', steps: 3, source: 'android-health-connect', confidence: 'high' }) };
    expect(selectStepSource('android', ios, android)).toBe(android);
    expect(selectStepSource('ios', ios, android)).toBe(ios);
    expect(await selectStepSource('web', ios, android).getTodaySteps(new Date())).toEqual({ status: 'unavailable' });
  });

  it('reports only observed foreground steps with low confidence and resets across local days', async () => {
    const source = new ForegroundPedometerFallbackSource();
    const first = new Date(2026, 9, 3, 23, 59);
    expect(await source.getTodaySteps(first)).toEqual({ status: 'unavailable' });
    source.observe(20, first);
    source.observe(45, first);
    expect(await source.getTodaySteps(first)).toEqual({ status: 'granted', steps: 45, source: 'foreground-sensor', confidence: 'low' });
    const tomorrow = new Date(2026, 9, 4, 0, 1);
    expect(await source.getTodaySteps(tomorrow)).toEqual({ status: 'unavailable' });
    source.observe(50, tomorrow);
    source.observe(56, tomorrow);
    expect(await source.getTodaySteps(tomorrow)).toMatchObject({ steps: 6, confidence: 'low' });
    source.reset();
    expect(await source.getTodaySteps(tomorrow)).toEqual({ status: 'unavailable' });
  });

  it('fails safely for unavailable providers, invalid dates and counts beyond the contract', async () => {
    const ios = new IosPedometerStepSource({ permission: async () => 'granted', available: async () => true, read: async () => 200001 });
    const android = new AndroidHealthConnectStepSource({ initialize: async () => { throw new Error('offline'); }, permissions: async () => ({ steps: true, background: true }), read: async () => 0 });
    expect(await ios.getTodaySteps(new Date())).toEqual({ status: 'unavailable' });
    expect(await ios.getTodaySteps(new Date(NaN))).toEqual({ status: 'unavailable' });
    expect(await android.getTodaySteps(new Date())).toEqual({ status: 'unavailable' });
  });
});
