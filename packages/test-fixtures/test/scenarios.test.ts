import { describe, expect, it } from 'vitest';
import {
  ContextInputSchema, GeocodedPlaceSchema, PlaceSchema, RouteSummarySchema,
  ScenarioIdSchema, UserPreferencesSchema, WeatherSnapshotSchema, providerResultSchema
} from '@contextia/contracts';
import { getScenarioInput, scenarios } from '../src/index.js';

describe('shared synthetic scenarios', () => {
  it('covers the five agreed input presets', () => {
    expect(scenarios.map(value => value.id).sort()).toEqual([...ScenarioIdSchema.options].sort());
    expect(new Set(scenarios.map(value => value.primaryTrigger)).size).toBe(5);
  });

  it('keeps every input and mock enrichment schema-valid after a JSON round trip', () => {
    for (const fixture of scenarios) {
      expect(ContextInputSchema.safeParse(JSON.parse(JSON.stringify(fixture.context))).success).toBe(true);
      expect(UserPreferencesSchema.safeParse(fixture.preferences).success).toBe(true);
      expect(providerResultSchema(GeocodedPlaceSchema.array()).safeParse(fixture.providers.geocoding).success).toBe(true);
      expect(providerResultSchema(PlaceSchema.array()).safeParse(fixture.providers.places).success).toBe(true);
      expect(providerResultSchema(WeatherSnapshotSchema).safeParse(fixture.providers.weather).success).toBe(true);
      expect(providerResultSchema(RouteSummarySchema.array()).safeParse(fixture.providers.routes).success).toBe(true);
    }
  });

  it('gives clients a detached input without a fixed recommendation or mock provider result', () => {
    const first = getScenarioInput('step-goal');
    first.location.latitude = 0;
    first.calendar.push({ id: 'new', title: 'New event', startAt: first.capturedAt, endAt: first.capturedAt });
    const next = getScenarioInput('step-goal');
    expect(next.location.latitude).not.toBe(0);
    expect(next.calendar).toEqual([]);
    expect(Object.keys(next)).not.toContain('providers');
    expect(Object.keys(next)).not.toContain('decision');
  });
});
