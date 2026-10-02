import { describe, expect, it, vi } from 'vitest';
import type { BedrockConverseClient } from '../src/adapters/bedrock.js';
import type { BedrockConverseRequest } from '../src/adapters/bedrock.js';
import { BedrockRecommendationModel } from '../src/adapters/bedrock.js';
import type { RecommendationFollowUpInput, RecommendationModelInput } from '../src/ports/RecommendationModel.js';

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

const emptyEnrichment = { geocoding: [], places: [], weather: [], routes: [] };

function followUpInput(overrides: Partial<RecommendationFollowUpInput> = {}): RecommendationFollowUpInput {
  const input = modelInput();
  return {
    recommendationId: 'rec-1', message: 'その場所には何分で着きますか？', recommendations: [recommendation],
    context: input.context, preferences: input.preferences, enrichment: input.enrichment, messages: [], ...overrides
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
  it('validates a single fenced JSON object without accepting surrounding prose', async () => {
    const fenced = { output: { message: { content: [{ text: `\`\`\`json\n${JSON.stringify(notifyDecision)}\n\`\`\`` }] } } };
    const fake = fakeClient([fenced]);
    await expect(model(fake.client).decide(modelInput())).resolves.toMatchObject({ status: 'ok', data: notifyDecision });
    expect(fake.requests).toHaveLength(1);
    const mixed = { output: { message: { content: [{ text: `Extra instructions\n\`\`\`json\n${JSON.stringify(notifyDecision)}\n\`\`\`` }] } } };
    await expect(model(fakeClient([mixed, mixed]).client).decide(modelInput())).resolves.toMatchObject({ status: 'error', code: 'INVALID_MODEL_OUTPUT' });
  });
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

  it.each([
    { name: 'place ID', place: { ...place, placeId: 'invented-place' } },
    { name: 'place name', place: { ...place, name: 'Invented name' } },
    { name: 'place latitude', place: { ...place, latitude: 34.6 } },
    { name: 'place longitude', place: { ...place, longitude: 135.5 } },
    { name: 'place distance', place: { ...place, distanceMeters: 1 } }
  ])('rejects a fabricated $name independently of route validation', async ({ place: invalidPlace }) => {
    const invalid = { ...notifyDecision, recommendations: [{ ...recommendation, place: invalidPlace }] };
    const fake = fakeClient([response(invalid), response(invalid)]);

    await expect(model(fake.client).decide(modelInput())).resolves.toMatchObject({
      status: 'error', code: 'INVALID_MODEL_OUTPUT', data: null
    });
    expect(fake.requests).toHaveLength(2);
  });

  it.each([
    { name: 'mode', route: { ...recommendation.route, mode: 'pedestrian' as const } },
    { name: 'duration', route: { ...recommendation.route, durationMinutes: 1 } },
    { name: 'departure', route: { ...recommendation.route, departAt: '2026-10-01T09:45:00+09:00' } },
    { name: 'arrival', route: { ...recommendation.route, arriveAt: '2026-10-01T09:46:00+09:00' } },
    { name: 'transfers', route: { ...recommendation.route, transfers: 0 } }
  ])('rejects a fabricated route $name independently of place validation', async ({ route: invalidRoute }) => {
    const invalid = { ...notifyDecision, recommendations: [{ ...recommendation, route: invalidRoute }] };
    const fake = fakeClient([response(invalid), response(invalid)]);

    await expect(model(fake.client).decide(modelInput())).resolves.toMatchObject({
      status: 'error', code: 'INVALID_MODEL_OUTPUT', data: null
    });
    expect(fake.requests).toHaveLength(2);
  });

  it('excludes unavailable place and route results from the allowed references', async () => {
    const fake = fakeClient([response(notifyDecision), response(notifyDecision)]);
    const input = modelInput({
      enrichment: {
        geocoding: [], places: [{ need: 'places-near-current', anchorKey: 'current', result: { status: 'unavailable', data: null } }],
        weather: [], routes: [{ need: 'route-to-place-candidates', anchorKey: 'current', result: { status: 'timeout', data: null } }]
      }
    });

    await expect(model(fake.client).decide(input)).resolves.toMatchObject({
      status: 'error', code: 'INVALID_MODEL_OUTPUT', data: null
    });
  });

  it('rejects provider facts added to references whose input omitted them', async () => {
    const fake = fakeClient([response(notifyDecision), response(notifyDecision)]);
    const input = modelInput();
    const placeWithoutDistance = {
      provider: place.provider, placeId: place.placeId, name: place.name, latitude: place.latitude, longitude: place.longitude
    };
    const routeWithoutTimetable = {
      routeId: route.routeId, mode: route.mode, durationMinutes: route.durationMinutes,
      origin: route.origin, destination: route.destination, legs: route.legs, warnings: route.warnings
    };
    input.enrichment.places[0]!.result = { status: 'ok', data: [placeWithoutDistance] };
    input.enrichment.routes[0]!.result = { status: 'ok', data: routeWithoutTimetable };

    await expect(model(fake.client).decide(input)).resolves.toMatchObject({
      status: 'error', code: 'INVALID_MODEL_OUTPUT', data: null
    });
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

});

describe('BedrockRecommendationModel followUp', () => {
  const reply = { reply: '提示した経路の所要時間は18分です。', recommendations: [recommendation] };

  it('requests a short structured recommendation-scoped reply and includes available context', async () => {
    const fake = fakeClient([response(reply)]);
    const input = followUpInput();

    await expect(model(fake.client).followUp(input)).resolves.toMatchObject({ status: 'ok', data: reply });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({
      outputConfig: { textFormat: { type: 'json_schema', structure: { jsonSchema: { name: 'recommendation_follow_up' } } } }
    });
    const payload = JSON.parse(fake.requests[0]!.messages[0]!.content[0]!.text.split('\n').slice(1).join('\n')) as unknown;
    expect(payload).toMatchObject({
      recommendationId: input.recommendationId, message: input.message, recommendations: input.recommendations,
      context: input.context, preferences: input.preferences, providerResults: input.enrichment, messages: []
    });
    expect(fake.requests[0]!.system[0]!.text).toMatch(/short follow-up|one to three concise sentences/);
    expect(fake.requests[0]!.system[0]!.text).not.toMatch(/chain.of.thought|hidden reasoning/i);
  });

  it('can reuse original recommendation cards after the context snapshot or providers are unavailable', async () => {
    const fake = fakeClient([response(reply)]);

    await expect(model(fake.client).followUp(followUpInput({ context: null, enrichment: emptyEnrichment })))
      .resolves.toMatchObject({ status: 'ok', data: reply });
    expect(fake.requests[0]!.messages[0]!.content[0]!.text).toContain('"context":null');
  });

  it('allows saved assistant cards to resolve a later follow-up reference', async () => {
    const previousCard = {
      ...recommendation, place: { ...place, placeId: 'saved-place', name: 'Saved Park' },
      route: { ...recommendation.route, mode: 'pedestrian' as const, durationMinutes: 12 }
    };
    const savedReply = { reply: '前回の候補まで徒歩12分です。', recommendations: [previousCard] };
    const fake = fakeClient([response(savedReply)]);
    const input = followUpInput({
      enrichment: emptyEnrichment,
      messages: [{
        id: 'assistant-1', role: 'assistant', content: '別の候補です。', createdAt: '2026-10-01T09:46:00+09:00',
        recommendations: [{ id: 'card-1', ...previousCard }]
      }]
    });

    await expect(model(fake.client).followUp(input)).resolves.toMatchObject({ status: 'ok', data: savedReply });
    expect(fake.requests[0]!.messages[0]!.content[0]!.text).toContain('saved-place');
  });

  it.each(['ok', 'degraded'] as const)('accepts fresh %s provider references outside the saved cards', async status => {
    const currentPlace = { ...place, placeId: 'current-place', name: 'Current Cafe' };
    const currentRoute = { ...route, durationMinutes: 9 };
    const currentReply = {
      reply: '今回取得した候補です。', recommendations: [{ ...recommendation, place: currentPlace, route: { ...recommendation.route, durationMinutes: 9 } }]
    };
    const input = followUpInput({
      enrichment: {
        ...emptyEnrichment,
        places: [{ need: 'places-near-current', anchorKey: 'current', result: { status, data: [currentPlace] } }],
        routes: [{ need: 'route-to-place-candidates', anchorKey: 'current', result: { status, data: currentRoute } }]
      }
    });

    await expect(model(fakeClient([response(currentReply)]).client).followUp(input))
      .resolves.toMatchObject({ status: 'ok', data: currentReply });
  });

  it.each([
    { name: 'unknown place', card: { ...recommendation, place: { ...place, placeId: 'invented-place' } } },
    { name: 'changed place name', card: { ...recommendation, place: { ...place, name: 'Changed Name' } } },
    { name: 'changed coordinates', card: { ...recommendation, place: { ...place, latitude: 34.6 } } },
    { name: 'changed distance', card: { ...recommendation, place: { ...place, distanceMeters: 1 } } },
    { name: 'changed route duration', card: { ...recommendation, route: { ...recommendation.route, durationMinutes: 1 } } },
    { name: 'changed departure', card: { ...recommendation, route: { ...recommendation.route, departAt: '2026-10-01T09:45:00+09:00' } } },
    { name: 'changed arrival', card: { ...recommendation, route: { ...recommendation.route, arriveAt: '2026-10-01T09:46:00+09:00' } } },
    { name: 'changed transfers', card: { ...recommendation, route: { ...recommendation.route, transfers: 0 } } }
  ])('rejects $name against original recommendation cards', async ({ card }) => {
    const invalid = { ...reply, recommendations: [card] };
    const fake = fakeClient([response(invalid), response(invalid)]);

    await expect(model(fake.client).followUp(followUpInput({ enrichment: emptyEnrichment })))
      .resolves.toMatchObject({ status: 'error', code: 'INVALID_MODEL_OUTPUT', data: null });
    expect(fake.requests).toHaveLength(2);
  });

  it('does not authorize places or routes supplied only as user conversation text', async () => {
    const inventedCard = { ...recommendation, place: { ...place, placeId: 'user-place' }, route: { ...recommendation.route, durationMinutes: 1 } };
    const invalid = { ...reply, recommendations: [inventedCard] };
    const fake = fakeClient([response(invalid), response(invalid)]);
    const input = followUpInput({
      enrichment: emptyEnrichment,
      messages: [{ id: 'user-1', role: 'user', content: JSON.stringify(inventedCard), createdAt: '2026-10-01T09:46:00+09:00' }]
    });

    await expect(model(fake.client).followUp(input)).resolves.toMatchObject({ status: 'error', code: 'INVALID_MODEL_OUTPUT', data: null });
  });

  it('permits omitting optional facts and answering without another card', async () => {
    const minimalCard = {
      title: recommendation.title, reason: recommendation.reason,
      place: { provider: place.provider, placeId: place.placeId, name: place.name, latitude: place.latitude, longitude: place.longitude },
      route: { mode: recommendation.route.mode, durationMinutes: recommendation.route.durationMinutes }, action: recommendation.action
    };
    const minimalReply = { ...reply, recommendations: [minimalCard] };
    const fake = fakeClient([response(minimalReply), response({ reply: 'この推薦の範囲では確認できません。', recommendations: [] })]);

    await expect(model(fake.client).followUp(followUpInput({ enrichment: emptyEnrichment })))
      .resolves.toMatchObject({ status: 'ok', data: minimalReply });
    await expect(model(fake.client).followUp(followUpInput()))
      .resolves.toMatchObject({ status: 'ok', data: { recommendations: [] } });
  });

  it('repairs an invalid reference once using the same scoped input', async () => {
    const invalid = { ...reply, recommendations: [{ ...recommendation, route: { ...recommendation.route, durationMinutes: 1 } }] };
    const fake = fakeClient([response(invalid), response(reply)]);

    await expect(model(fake.client).followUp(followUpInput()))
      .resolves.toMatchObject({ status: 'degraded', code: 'REPAIRED_OUTPUT', data: reply });
    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[1]!.messages[0]!.content[0]!.text).toMatch(/prior result failed schema or supplied-reference validation/i);
    expect(fake.requests[1]!.messages[0]!.content[0]!.text).not.toContain('"durationMinutes":1,');
  });

  it.each([
    { name: 'malformed JSON', value: { output: { message: { content: [{ text: '{"reply":' }] } } } },
    { name: 'non-text model content', value: { output: { message: { content: [{ reasoningContent: 'untrusted-details' }] } } } },
    { name: 'missing Converse output', value: {} }
  ])('repairs $name without exposing its raw content', async ({ value }) => {
    const fake = fakeClient([value, response(reply)]);

    const result = await model(fake.client).followUp(followUpInput());

    expect(result).toMatchObject({ status: 'degraded', code: 'REPAIRED_OUTPUT', data: reply });
    expect(fake.requests).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain('untrusted-details');
  });

  it.each([
    { name: 'too many cards', value: { ...reply, recommendations: Array.from({ length: 4 }, () => recommendation) } },
    { name: 'missing reply', value: { recommendations: [] } },
    { name: 'reasoning field', value: { ...reply, reasoning: 'private-model-details' } },
    { name: 'unknown field', value: { ...reply, rawProviderResponse: 'secret-provider-details' } }
  ])('fails gracefully after one unsuccessful repair for $name', async ({ value }) => {
    const fake = fakeClient([response(value), response(value)]);
    const result = await model(fake.client).followUp(followUpInput());

    expect(result).toMatchObject({ status: 'error', code: 'INVALID_MODEL_OUTPUT', data: null });
    expect(fake.requests).toHaveLength(2);
    expect(JSON.stringify(result)).not.toMatch(/private-model-details|secret-provider-details/);
  });

  it('falls back to explicit locally validated JSON and retains the one-repair limit', async () => {
    const unsupported = Object.assign(new Error('JSON schema structured output is not supported'), { name: 'ValidationException' });
    const fake = fakeClient([unsupported, response({ reply: '', recommendations: [] }), response(reply)]);

    await expect(model(fake.client).followUp(followUpInput())).resolves.toMatchObject({ status: 'degraded', code: 'REPAIRED_OUTPUT', data: reply });
    expect(fake.requests).toHaveLength(3);
    expect(fake.requests[0]!.outputConfig).toBeDefined();
    expect(fake.requests[1]!.outputConfig).toBeUndefined();
    expect(fake.requests[2]!.outputConfig).toBeUndefined();
    expect(fake.requests[1]!.messages[0]!.content[1]!.text).toContain('Return JSON matching this schema:');
  });

  it('uses explicit JSON validation when structured output is disabled by configuration', async () => {
    const fake = fakeClient([response(reply)]);
    const adapter = new BedrockRecommendationModel({ client: fake.client, modelId: 'test-model', timeoutMs: 100, structuredOutput: false });

    await expect(adapter.followUp(followUpInput())).resolves.toMatchObject({ status: 'ok', data: reply });
    expect(fake.requests[0]!.outputConfig).toBeUndefined();
    expect(fake.requests[0]!.messages[0]!.content[1]!.text).toContain('Return JSON matching this schema:');
  });

  it('shares a finite timeout across schema fallback and repair and aborts at that deadline', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      let abortedAt: number | undefined;
      const client: BedrockConverseClient = {
        converse: vi.fn(async (_request, signal) => {
          calls += 1;
          if (calls === 1) {
            await new Promise<void>(resolve => setTimeout(resolve, 3));
            throw Object.assign(new Error('structured output unsupported'), { name: 'ValidationException' });
          }
          if (calls === 2) {
            await new Promise<void>(resolve => setTimeout(resolve, 4));
            return response({ reply: '', recommendations: [] });
          }
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => { abortedAt = performance.now(); reject(new Error('aborted')); }, { once: true });
          });
        })
      };

      const pending = model(client, 10).followUp(followUpInput());
      await vi.advanceTimersByTimeAsync(7);
      expect(calls).toBe(3);
      await vi.advanceTimersByTimeAsync(3);
      await expect(pending).resolves.toMatchObject({ status: 'timeout', code: 'TIMEOUT', data: null });
      expect(abortedAt).toBe(10);
      expect(calls).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps upstream failures without exposing the model error body', async () => {
    const fake = fakeClient([Object.assign(new Error('secret account details'), { name: 'AccessDeniedException' })]);
    const result = await model(fake.client).followUp(followUpInput());

    expect(result).toMatchObject({ status: 'error', code: 'UPSTREAM_AUTH', data: null });
    expect(fake.requests).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('secret account details');
  });
});

describe('Bedrock geocoded destination references', () => {
  const destination = { ...place, placeId: 'geocoded-destination', name: 'Tokyo Station' };
  const destinationCard = { ...recommendation, place: destination };
  const destinationDecision = { ...notifyDecision, recommendations: [destinationCard] };
  const destinationReply = { reply: '目的地への経路です。', recommendations: [destinationCard] };

  function destinationInput(): RecommendationModelInput {
    return modelInput({
      candidates: [{
        type: 'UPCOMING_EVENT_TRANSIT', confidence: 0.9, anchorKey: 'event-1',
        requiredSignals: ['location', 'calendar', 'time', 'transit'],
        providerNeeds: ['geocode-event-location', 'route-to-next-event'], facts: { eventId: 'event-1' }
      }],
      enrichment: {
        ...emptyEnrichment,
        geocoding: [{ eventId: 'event-1', result: { status: 'ok', data: [{ ...destination, confidence: 0.95 }] } }],
        routes: [{ need: 'route-to-next-event', anchorKey: 'event-1', result: { status: 'ok', data: route } }]
      }
    });
  }

  it.each(['ok', 'degraded'] as const)('accepts a destination card from %s Geocode in the transit decision without nearby Places', async status => {
    const input = destinationInput();
    input.enrichment.geocoding[0]!.result = { status, data: [{ ...destination, confidence: 0.95 }] };
    const fake = fakeClient([response(destinationDecision), response(destinationDecision)]);

    await expect(model(fake.client).decide(input)).resolves.toMatchObject({ status: 'ok', data: destinationDecision });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]!.messages[0]!.content[0]!.text).toContain('geocoded-destination');
  });

  it.each(['ok', 'degraded'] as const)('accepts fresh %s Geocode references in follow-up without original or saved cards', async status => {
    const input = destinationInput();
    input.enrichment.geocoding[0]!.result = { status, data: [{ ...destination, confidence: 0.95 }] };
    const fake = fakeClient([response(destinationReply), response(destinationReply)]);

    await expect(model(fake.client).followUp(followUpInput({ recommendations: [], enrichment: input.enrichment })))
      .resolves.toMatchObject({ status: 'ok', data: destinationReply });
    expect(fake.requests).toHaveLength(1);
  });

  it.each([
    { name: 'unknown ID', place: { ...destination, placeId: 'invented-place' } },
    { name: 'changed name', place: { ...destination, name: 'Invented Station' } },
    { name: 'changed latitude', place: { ...destination, latitude: 34.6 } },
    { name: 'changed longitude', place: { ...destination, longitude: 135.5 } },
    { name: 'changed distance', place: { ...destination, distanceMeters: 1 } }
  ])('rejects $name against the Geocode source in decisions and follow-up', async ({ place: invalidPlace }) => {
    const card = { ...destinationCard, place: invalidPlace };
    const invalidDecision = { ...destinationDecision, recommendations: [card] };
    const invalidReply = { ...destinationReply, recommendations: [card] };
    const input = destinationInput();

    await expect(model(fakeClient([response(invalidDecision), response(invalidDecision)]).client).decide(input))
      .resolves.toMatchObject({ status: 'error', code: 'INVALID_MODEL_OUTPUT', data: null });
    await expect(model(fakeClient([response(invalidReply), response(invalidReply)]).client)
      .followUp(followUpInput({ recommendations: [], enrichment: input.enrichment })))
      .resolves.toMatchObject({ status: 'error', code: 'INVALID_MODEL_OUTPUT', data: null });
  });

  it.each(['unavailable', 'timeout', 'error', 'not_requested'] as const)('does not authorize a destination from %s Geocode', async status => {
    const input = destinationInput();
    input.enrichment.geocoding[0]!.result = { status, data: null };

    await expect(model(fakeClient([response(destinationDecision), response(destinationDecision)]).client).decide(input))
      .resolves.toMatchObject({ status: 'error', code: 'INVALID_MODEL_OUTPUT', data: null });
    await expect(model(fakeClient([response(destinationReply), response(destinationReply)]).client)
      .followUp(followUpInput({ recommendations: [], enrichment: input.enrichment })))
      .resolves.toMatchObject({ status: 'error', code: 'INVALID_MODEL_OUTPUT', data: null });
  });
});
