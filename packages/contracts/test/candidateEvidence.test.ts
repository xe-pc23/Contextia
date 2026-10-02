import { describe, expect, it } from 'vitest';
import { CandidateEvidenceSchema } from '../src/index.js';
import type { CandidateEvidence } from '../src/index.js';
import type { ProviderEnrichment } from '../../providers/src/ports/RecommendationModel.js';

describe('transient candidate evidence', () => {
  it('normalizes absent provider collections without making up results', () => {
    expect(CandidateEvidenceSchema.parse({})).toEqual({ geocoding: [], places: [], weather: [], routes: [] });
  });

  it('accepts the existing normalized provider port without an SDK dependency', () => {
    const port: ProviderEnrichment = { geocoding: [], places: [], weather: [], routes: [] };
    const evidence: CandidateEvidence = port;
    expect(CandidateEvidenceSchema.parse(evidence)).toEqual(port);
  });

  it('keeps failure results scoped to the requested event/place', () => {
    const raw = {
      geocoding: [{ eventId: 'event-1', result: { status: 'unavailable', data: null, code: 'AMBIGUOUS' } }],
      routes: [{ need: 'route-to-next-event', anchorKey: 'event-1', result: { status: 'timeout', data: null } }]
    };
    expect(CandidateEvidenceSchema.parse(raw).routes[0]?.result.status).toBe('timeout');
  });

  it('validates the arrival-planning timestamp as transient route provenance', () => {
    const entry = { need: 'route-to-next-event', anchorKey: 'event-1', arriveBy: '2026-10-01T15:50:00+09:00', result: { status: 'timeout', data: null } };
    expect(CandidateEvidenceSchema.parse({ routes: [entry] }).routes[0]?.arriveBy).toBe(entry.arriveBy);
    expect(CandidateEvidenceSchema.safeParse({ routes: [{ ...entry, arriveBy: 'not-a-time' }] }).success).toBe(false);
  });

  it('enforces the current-place anchor while retaining an opaque destination-event anchor', () => {
    const result = { status: 'not_requested', data: null };
    expect(CandidateEvidenceSchema.safeParse({ places: [{ need: 'places-near-current', anchorKey: 'different-key', result }] }).success).toBe(false);
    expect(CandidateEvidenceSchema.safeParse({ places: [{ need: 'places-near-destination', anchorKey: 'opaque:event', result }] }).success).toBe(true);
  });

  it('rejects raw upstream fields and noncanonical operations', () => {
    expect(CandidateEvidenceSchema.safeParse({ rawSdkResponse: {} }).success).toBe(false);
    expect(CandidateEvidenceSchema.safeParse({
      places: [{ need: 'nearby-search', anchorKey: 'current', result: { status: 'ok', data: [] } }]
    }).success).toBe(false);
    expect(CandidateEvidenceSchema.safeParse({
      geocoding: [{ eventId: 'event-1', result: { status: 'error', data: [], upstreamBody: 'private' } }]
    }).success).toBe(false);
  });
});
