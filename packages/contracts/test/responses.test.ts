import { describe, expect, it } from 'vitest';
import {
  ChatRequestSchema, ContextEvaluateResponseSchema, ErrorResponseSchema,
  ProviderStatusMapSchema, RecommendationDecisionSchema, RecommendationsQuerySchema,
  RegisterDeviceRequestSchema
} from '../src/index.js';

const item = { title: '休憩候補', reason: '目標歩数を達成したため', place: null, route: null, action: { type: 'NONE', url: null } };
const notify = { decision: 'notify', decisionReason: 'Rest opportunity', urgency: 'low', message: '休憩するのはどう？', recommendations: [item], usedSignals: ['steps'] };
const silent = { decision: 'silent', decisionReason: 'No opportunity', urgency: null, message: null, recommendations: [], usedSignals: [] };
const providerStatus = Object.fromEntries(['geocoding', 'places', 'weather', 'routes', 'bedrock'].map(key => [key, { status: 'not_requested' }]));
const evaluation = {
  evaluationId: 'eval-1', recommendationId: 'rec-1', ...notify, triggerType: 'STEP_GOAL_REST',
  recommendations: [{ id: 'item-1', ...item }], providerStatus,
  delivery: { mode: 'preview', status: 'preview', wouldSuppress: true, guardCodes: ['DAILY_CAP_REACHED'] },
  contextExpiresAt: '2026-10-02T05:10:00Z'
};

describe('response and model contracts', () => {
  it('accepts notify, silent and preview diagnostics without hiding a useful recommendation', () => {
    expect(RecommendationDecisionSchema.safeParse(notify).success).toBe(true);
    expect(RecommendationDecisionSchema.safeParse(silent).success).toBe(true);
    expect(ContextEvaluateResponseSchema.parse({ requestId: 'req-1', data: evaluation }).data.decision).toBe('notify');
    expect(ContextEvaluateResponseSchema.safeParse({ requestId: 'req-1', data: { ...evaluation, ...silent, recommendationId: null, triggerType: null, delivery: { mode: 'proactive', status: 'suppressed', wouldSuppress: true, guardCodes: ['NO_CANDIDATE'] } } }).success).toBe(true);
  });

  it.each([
    { ...notify, recommendations: [] }, { ...notify, recommendations: Array.from({ length: 4 }, () => item) },
    { ...notify, message: null }, { ...silent, recommendations: [item] }, { ...silent, urgency: 'low' },
    { ...notify, usedSignals: ['gps'] }, { ...notify, chainOfThought: 'hidden reasoning' },
    { ...notify, recommendations: [{ ...item, action: { type: 'MAP', url: 'javascript:alert(1)' } }] }
  ])('rejects invalid model output %j', output => expect(RecommendationDecisionSchema.safeParse(output).success).toBe(false));

  it.each([
    { recommendationId: null }, { triggerType: null }, { recommendations: [{ ...item }] },
    { delivery: { mode: 'preview', status: 'sent', wouldSuppress: false, guardCodes: [] } },
    { providerStatus: { places: { status: 'ok' } } }
  ])('rejects inconsistent evaluation response %j', patch => {
    expect(ContextEvaluateResponseSchema.safeParse({ requestId: 'req-1', data: { ...evaluation, ...patch } }).success).toBe(false);
  });

  it('rejects a proactive notify hidden by a guard or a silent result claiming delivery', () => {
    const parse = (data: unknown) => ContextEvaluateResponseSchema.safeParse({ requestId: 'req-1', data }).success;
    expect(parse({ ...evaluation, delivery: { mode: 'proactive', status: 'suppressed', wouldSuppress: true, guardCodes: ['DAILY_CAP_REACHED'] } })).toBe(false);
    expect(parse({ ...evaluation, ...silent, recommendationId: null, triggerType: null, delivery: { mode: 'proactive', status: 'sent', wouldSuppress: false, guardCodes: [] } })).toBe(false);
    expect(parse({ ...evaluation, delivery: { mode: 'preview', status: 'preview', wouldSuppress: false, guardCodes: ['DUPLICATE_CONTEXT'] } })).toBe(false);
  });

  it('requires all five normalized provider statuses and no upstream error body', () => {
    expect(ProviderStatusMapSchema.safeParse(providerStatus).success).toBe(true);
    expect(ProviderStatusMapSchema.safeParse({ ...providerStatus, weather: { status: 'timeout', latencyMs: -1 } }).success).toBe(false);
    expect(ProviderStatusMapSchema.safeParse({ ...providerStatus, routes: { status: 'error', rawResponse: { token: 'sensitive' } } }).success).toBe(false);
  });

  it('validates standard errors', () => {
    expect(ErrorResponseSchema.safeParse({ requestId: 'req-1', error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: [{ path: 'location.latitude', message: 'Out of range' }] } }).success).toBe(true);
    expect(ErrorResponseSchema.safeParse({ requestId: 'req-1', error: { code: 'ERROR', message: 'Invalid', stack: 'private' } }).success).toBe(false);
  });

  it('bounds query pagination and chat input', () => {
    expect(RecommendationsQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(RecommendationsQuerySchema.parse({ limit: '50', cursor: 'opaque' }).limit).toBe(50);
    for (const limit of ['0', '51', '1.5', '', 'abc']) expect(RecommendationsQuerySchema.safeParse({ limit }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ message: 'x'.repeat(1000) }).success).toBe(true);
    expect(ChatRequestSchema.safeParse({ message: 'x'.repeat(1001) }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ message: '' }).success).toBe(false);
  });

  it('registers opaque device tokens and rejects unknown token fields', () => {
    expect(RegisterDeviceRequestSchema.safeParse({ deviceId: 'device-1', platform: 'android', provider: 'sns', token: 'synthetic-token' }).success).toBe(true);
    expect(RegisterDeviceRequestSchema.safeParse({ deviceId: 'device-1', platform: 'ios', provider: 'expo', token: '' }).success).toBe(false);
  });
});
