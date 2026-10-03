import { ScenarioContextInputSchema } from '@contextia/contracts';
import type { CandidateEvidence, DetectorPolicy, RouteSummary, ScenarioContextInput } from '@contextia/contracts';
import { getScenarioEvidence } from '@contextia/test-fixtures';
import type { ScenarioFixture } from '@contextia/test-fixtures';
import { createDetectorRegistry, defaultDetectorPolicy, normalizeDetectorContext, refineCandidates } from '../src/index.js';

export function normalized(fixture: ScenarioFixture, patch: Partial<ScenarioContextInput> = {}) {
  const context = ScenarioContextInputSchema.parse({ ...fixture.context, ...patch });
  return normalizeDetectorContext({
    context, preferences: fixture.preferences, profileTimezone: fixture.preferences.timezone,
    clock: { now: () => new Date('2026-10-01T05:10:00Z') }
  });
}
export async function primaryCandidates(
  fixture: ScenarioFixture, patch: Partial<ScenarioContextInput> = {}, policy: Readonly<DetectorPolicy> = defaultDetectorPolicy
) {
  const detector = createDetectorRegistry(policy).find(value => value.type === fixture.primaryTrigger);
  if (!detector) throw new Error('Missing agreed detector');
  return detector.detect(normalized(fixture, patch));
}
export async function refined(
  fixture: ScenarioFixture, patch: Partial<ScenarioContextInput> = {}, evidence: CandidateEvidence = getScenarioEvidence(fixture),
  policy: Readonly<DetectorPolicy> = defaultDetectorPolicy
) {
  const context = normalized(fixture, patch);
  const candidates = await primaryCandidates(fixture, patch, policy);
  return refineCandidates({ context, candidates, evidence, policy });
}
export function changeRoutes(evidence: CandidateEvidence, transform: (route: RouteSummary) => RouteSummary): CandidateEvidence {
  return { ...evidence, routes: evidence.routes.map(entry =>
    entry.result.status === 'ok' || entry.result.status === 'degraded'
      ? { ...entry, result: { ...entry.result, data: transform(entry.result.data) } } : entry) };
}
