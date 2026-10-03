import { describe, expect, it } from 'vitest';
import type { RouteSummary } from '@contextia/contracts';
import { journeyArrival } from '../src/triggers/evidence.js';

const route: RouteSummary = { routeId: 'fractional', mode: 'pedestrian', origin: { latitude: 0, longitude: 0 }, destination: { latitude: 0, longitude: 0 },
  departAt: '2026-10-01T05:00:00Z', arriveAt: '2026-10-01T05:10:00.500000001Z', durationMinutes: 600_501 / 60_000, legs: [], warnings: [] };
describe('scheduled journey feasibility precision', () => {
  it('ceil-rounds scheduled arrival for conservative activity budgets', () => {
    expect(journeyArrival(route, Date.parse(route.departAt!))).toBe(Date.parse('2026-10-01T05:10:00.501Z'));
  });
  it('rejects a departure one nanosecond before the requested instant', () => {
    expect(journeyArrival({ ...route, departAt: '2026-10-01T04:59:59.999999999Z' }, Date.parse('2026-10-01T05:00:00Z'))).toBeNull();
  });
  it('rejects a duration that exceeds the canonical span by a millisecond', () => {
    expect(journeyArrival({ ...route, durationMinutes: 600_502 / 60_000 }, Date.parse(route.departAt!))).toBeNull();
  });
});
