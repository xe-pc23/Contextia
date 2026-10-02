import { describe, expect, it, vi } from 'vitest';
import type { BedrockConverseClient } from '../src/adapters/bedrock.js';
import type { BedrockConverseRequest } from '../src/adapters/bedrock.js';
import { BedrockRecommendationModel } from '../src/adapters/bedrock.js';
import type { RecommendationModelInput } from '../src/ports/RecommendationModel.js';

const place = {
  provider: 'amazon-location' as const,
  placeId: 'place-1',
  name: 'Coffee Stand',
  latitude: 35.6812,
  longitude: 139.7671,
  distanceMeters: 250
};

const route = {
  routeId: 'route-1',
  mode: 'transit' as const,
  durationMinutes: 18,
  departAt: '2026-10-01T10:00:00+09:00',
  arriveAt: '2026-10-01T10:18:00+09:00',
  transfers: 1,
  origin: { latitude: 35.68, longitude: 139.76 },
  destination: { latitude: 35.6812, longitude: 139.7671 },
  legs: [],
  warnings: []
};

const recommendation = {
  title: '休憩しませんか',
  reason: '次の予定まで少し時間があります',
  place,
  route: {
    mode: 'transit' as const,
    durationMinutes: 18,
    departAt: route.departAt,
    arriveAt: route.arriveAt,
    transfers: 1
  },
  action: { type: 'MAP' as const }
};

const notifyDecision = {
  decision: 'notify' as const,
  decisionReason: '近くに休憩できる場所があります',
  usedSignals: ['location' as const, 'calendar' as const],
  urgency: 'low' as const,
  message: '近くで少し休憩できます。',
  recommendations: [recommendation]
};

function modelInput(overrides: Partial<RecommendationModelInput> = {}): RecommendationModelInput {
  return {
    now: '2026-10-01T09:45:00+09:00',
    context: {
      mode: 'simulation',
      deliveryMode: 'preview',
      capturedAt: '2026-10-01T09:44:00+09:00',
      location: {
        latitude: 35.68,
        longitude: 139.76,
        capturedAt: '2026-10-01T09:44:00+09:00',
        source: 'scenario'
      },
      calendar: []
    },
    preferences: {
      interests: ['coffee'],
      stepGoal: 8000,
      notificationFrequency: 'normal',
      notificationsEnabled: true,
      locale: 'ja-JP',
      timezone: 'Asia/Tokyo'
    },
    candidates: [{
      type: 'FREE_TIME_NEARBY',
      confidence: 0.9,
      anchorKey: 'free-time:2026-10-01T10:00:00+09:00',
      requiredSignals: ['location', 'calendar'],
      providerNeeds: ['places-near-current', 'route-to-place-candidates'],
      facts: { freeMinutes: 30 }
    }],
    enrichment: {
      geocoding: [],
      places: [{
        need: 'places-near-current',
        anchorKey: 'current',
        result: { status: 'ok', data: [place] }
      }],
      weather: [],
      routes: [{
        need: 'route-to-place-candidates',
        anchorKey: 'current',
        result: { status: 'ok', data: route }
      }]
    },
    recentRecommendations: [],
    ...overrides
  };
}

function response(value: unknown): unknown {
  return { output: { message: { role: 'assistant', content: [{ text: JSON.stringify(value) }] } } };
}

function fakeClient(responses: unknown[]): { client: BedrockConverseClient; requests: BedrockConverseRequest[] } {
  const requests: BedrockConverseRequest[] = [];
  const converse = vi.fn(async (input: BedrockConverseRequest): Promise<unknown> => {
    requests.push(input);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  return { client: { converse }, requests };
}

function model(client: BedrockConverseClient, timeoutMs = 100): BedrockRecommendationModel {
  return new BedrockRecommendationModel({ client, modelId: 'test-model', timeoutMs });
}

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...collectKeys(child)]);
}

function hasFalseItems(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasFalseItems);
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.items === false || Object.values(record).some(hasFalseItems);
}

describe('BedrockRecommendationModel', () => {
  it('does not call Bedrock when deterministic evaluation found no candidates', async () => {
    const fake = fakeClient([]);
    const result = await model(fake.client).decide(modelInput({ candidates: [] }));

    expect(result).toMatchObject({ status: 'not_requested', data: null });
    expect(fake.requests).toHaveLength(0);
  });

  it('uses Converse structured output with the contract and normalizes notify and silent decisions', async () => {
    const fake = fakeClient([response(notifyDecision)]);
    const result = await model(fake.client).decide(modelInput());

    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({
      modelId: 'test-model',
      outputConfig: {
        textFormat: {
          type: 'json_schema',
          structure: { jsonSchema: { name: 'recommendation_decision' } }
        }
      }
    });
    const schema = fake.requests[0]!.outputConfig!.textFormat!.structure!.jsonSchema!.schema;
    expect(schema).toBeDefined();
    expect(JSON.parse(schema ?? '{}')).toHaveProperty('anyOf');
    expect(collectKeys(JSON.parse(schema ?? '{}'))).not.toEqual(expect.arrayContaining([
      'oneOf', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'multipleOf', 'pattern', 'prefixItems'
    ]));
    expect(hasFalseItems(JSON.parse(schema ?? '{}'))).toBe(false);
    expect(fake.requests[0]!.system?.map(block => block.text).join(' ')).not.toMatch(/chain.of.thought|hidden reasoning/i);
    expect(result).toMatchObject({ status: 'ok', data: notifyDecision });

    const silent = { decision: 'silent', decisionReason: '提案なし', usedSignals: ['time'], urgency: null, message: null, recommendations: [] };
    const silentModel = model(fakeClient([response(silent)]).client);
    await expect(silentModel.decide(modelInput())).resolves.toMatchObject({ status: 'ok', data: silent });
  });

  it('falls back to locally validated JSON when the selected model rejects structured output', async () => {
    const unsupported = Object.assign(new Error('JSON schema structured output is not supported'), { name: 'ValidationException' });
    const fake = fakeClient([unsupported, response(notifyDecision)]);

    const result = await model(fake.client).decide(modelInput());

    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[0]!.outputConfig).toBeDefined();
    expect(fake.requests[1]!.outputConfig).toBeUndefined();
    expect(result).toMatchObject({ status: 'ok', data: notifyDecision });
  });

  it('rejects place and route facts that were not supplied, then repairs once', async () => {
    const invalid = structuredClone(notifyDecision);
    invalid.recommendations[0]!.place!.placeId = 'invented-place';
    invalid.recommendations[0]!.route!.durationMinutes = 99;
    const fake = fakeClient([response(invalid), response(notifyDecision)]);

    const result = await model(fake.client).decide(modelInput());

    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[1]!.messages?.[0]?.content?.[0]).toMatchObject({ text: expect.stringMatching(/prior result failed/i) });
    expect(result).toMatchObject({ status: 'degraded', code: 'REPAIRED_OUTPUT', data: notifyDecision });
  });

  it('allows only one repair attempt and returns a sanitized invalid-output error', async () => {
    const fake = fakeClient([response({ ...notifyDecision, recommendations: [] }), response({ secret: 'raw-model-output' })]);

    const result = await model(fake.client).decide(modelInput());

    expect(fake.requests).toHaveLength(2);
    expect(result).toMatchObject({ status: 'error', data: null, code: 'INVALID_MODEL_OUTPUT' });
    expect(JSON.stringify(result)).not.toContain('raw-model-output');
  });

  it('shares one timeout deadline across the initial decision and output repair', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      let repairAbortedAt: number | undefined;
      const invalid = { ...notifyDecision, recommendations: [] };
      const client: BedrockConverseClient = {
        converse: vi.fn(async (_request, signal) => {
          calls += 1;
          if (calls === 1) {
            await new Promise<void>(resolve => setTimeout(resolve, 8));
            return response(invalid);
          }
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              repairAbortedAt = performance.now();
              reject(new Error('repair aborted'));
            }, { once: true });
          });
        })
      };

      const pending = model(client, 10).decide(modelInput());
      await vi.advanceTimersByTimeAsync(8);
      expect(calls).toBe(2);
      await vi.advanceTimersByTimeAsync(2);
      const abortedAtSharedDeadline = repairAbortedAt;
      await vi.advanceTimersByTimeAsync(20);
      await expect(pending).resolves.toMatchObject({ status: 'timeout', code: 'TIMEOUT', data: null });
      expect(abortedAtSharedDeadline).toBe(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it('enforces the contract maximum of three recommendations', async () => {
    const tooMany = { ...notifyDecision, recommendations: Array.from({ length: 4 }, () => recommendation) };
    const fake = fakeClient([response(tooMany), response(tooMany)]);

    const result = await model(fake.client).decide(modelInput());

    expect(fake.requests).toHaveLength(2);
    expect(result).toMatchObject({ status: 'error', data: null, code: 'INVALID_MODEL_OUTPUT' });
  });

  it('returns timeout and sanitized upstream failures', async () => {
    const timeoutFake = fakeClient([new Promise<unknown>(() => {})]);
    await expect(model(timeoutFake.client, 5).decide(modelInput())).resolves.toMatchObject({ status: 'timeout', code: 'TIMEOUT', data: null });

    const deniedFake = fakeClient([Object.assign(new Error('secret account details'), { name: 'AccessDeniedException' })]);
    const denied = await model(deniedFake.client).decide(modelInput());
    expect(denied).toMatchObject({ status: 'error', code: 'UPSTREAM_AUTH', data: null });
    expect(JSON.stringify(denied)).not.toContain('secret account details');
  });

  it('returns NOT_IMPLEMENTED for follow-up without a model request', async () => {
    const fake = fakeClient([]);
    const input = modelInput();
    const followUp = await model(fake.client).followUp({
      recommendationId: 'rec-1',
      message: 'why?',
      recommendations: [recommendation],
      context: input.context,
      preferences: input.preferences,
      enrichment: input.enrichment,
      messages: []
    });

    expect(followUp).toMatchObject({ status: 'error', data: null, code: 'NOT_IMPLEMENTED' });
    expect(fake.requests).toHaveLength(0);
  });
});
