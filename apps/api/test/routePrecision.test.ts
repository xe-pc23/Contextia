import { describe, expect, it } from 'vitest';
import { AmazonLocationRouteProvider } from '@contextia/providers';
import { getScenarioEvidence, upcomingTransit } from '@contextia/test-fixtures';
import { createEvaluationDomain } from '../src/composition/evaluationDomain.js';

describe('provider schedule precision through domain refinement', () => {
  it.each(['500000000', '500000001'])('retains a valid fractional scheduled route at .%s seconds', async fraction => {
    const evidence = getScenarioEvidence(upcomingTransit);
    const entry = evidence.routes[0];
    const original = entry?.result.data;
    if (!entry || !original || !entry.arriveBy) throw new Error('Missing route fixture');
    const provider = new AmazonLocationRouteProvider({ region: 'ap-northeast-1', timeoutMs: 100,
      client: { calculateRoutes: async () => ({ Routes: [{ Summary: { Duration: 2040 }, Legs: [{
        Type: 'Transit', TravelMode: 'Subway', TransitLegDetails: {
          Departure: { Time: '2026-10-01T15:10:00+09:00' }, Arrival: { Time: `2026-10-01T15:44:00.${fraction}+09:00` },
          Summary: { TravelOnly: { Duration: 2040 }, Overview: { Duration: 2040 } }
        }
      }] }] }) } });
    const result = await provider.getRoute({ origin: original.origin, destination: original.destination, mode: 'transit', arriveBy: entry.arriveBy });
    expect(['ok', 'degraded']).toContain(result.status);
    evidence.routes = [{ ...entry, result }];
    const domain = createEvaluationDomain();
    const context = upcomingTransit.context; const preferences = upcomingTransit.preferences; const now = new Date(context.capturedAt);
    const candidates = (await domain.detectCandidates({ context, preferences, now })).filter(candidate => candidate.type === 'UPCOMING_EVENT_TRANSIT');
    const refined = await domain.refineCandidates({ context, preferences, now, candidates, evidence });
    expect(refined).toHaveLength(1);
    expect(refined[0]?.facts.routeId).toBe(result.data?.routeId);
  });
});
