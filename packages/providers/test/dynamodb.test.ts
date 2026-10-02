import { describe, expect, it, vi } from 'vitest';
import type { UserPreferences } from '@contextia/contracts';
import { EvaluationResultSchema } from '@contextia/contracts';
import type { DynamoDbClient, DynamoDbRequest, DynamoDbUpdateInput } from '../src/adapters/dynamodb.js';
import { DynamoDbStateRepository } from '../src/adapters/dynamodb.js';
import type { ContextSnapshot, ProactiveDeliveryWrite, RecommendationWrite } from '../src/ports/StateRepository.js';

const preferences: UserPreferences = {
  interests: ['coffee'],
  stepGoal: 8000,
  notificationFrequency: 'normal',
  notificationsEnabled: true,
  locale: 'ja-JP',
  timezone: 'Asia/Tokyo'
};

const processedAt = '2026-10-01T10:00:05.250+09:00';
const capturedAt = '2026-10-01T09:59:50.000+09:00';

function snapshot(overrides: Partial<ContextSnapshot> = {}): ContextSnapshot {
  return {
    evaluationId: 'eval-1',
    capturedAt,
    mode: 'real',
    location: { latitude: 35.68, longitude: 139.76, accuracyMeters: 20 },
    calendar: [],
    createdAt: '2020-01-01T00:00:00.000Z',
    expiresAt: 1,
    ...overrides
  };
}

const delivery: ProactiveDeliveryWrite = {
  deliveryMode: 'proactive',
  evaluationId: 'eval-1',
  recommendationId: 'rec-1',
  notificationDay: '2026-10-01',
  notificationsEnabled: true,
  notificationFrequency: 'normal',
  maxDailyNotifications: 3,
  contextFingerprint: 'sha256:current',
  triggerType: 'FREE_TIME_NEARBY',
  anchorKey: 'anchor-1',
  at: '2026-10-01T10:00:10.000+09:00',
  contextDedupSeconds: 300,
  anchorDedupSeconds: 3600,
  maxRecentAnchors: 20
};

function recommendation(overrides: Partial<RecommendationWrite> = {}): RecommendationWrite {
  return {
    id: 'rec-1',
    evaluationId: 'eval-1',
    contextReference: { evaluationId: 'eval-1', capturedAt },
    createdAt: '2026-10-01T10:00:08.000+09:00',
    triggerType: 'FREE_TIME_NEARBY',
    urgency: 'low',
    message: '近くで休憩できます。',
    recommendations: [{
      id: 'item-1',
      title: 'Coffee Stand',
      reason: '次の予定まで時間があります',
      place: {
        persistenceIntent: 'storage',
        place: {
          provider: 'amazon-location',
          placeId: 'place-1',
          name: 'Coffee Stand',
          latitude: 35.6812,
          longitude: 139.7671,
          distanceMeters: 250,
          categoryNames: ['cafe'],
          isOpen: true,
          websiteUrl: 'https://example.com'
        }
      },
      action: { type: 'MAP' }
    }],
    usedSignals: ['location', 'places'],
    summaryForDedup: 'Nearby coffee stop',
    providerStatus: {
      geocoding: { status: 'not_requested' },
      places: { status: 'ok' },
      weather: { status: 'not_requested' },
      routes: { status: 'not_requested' },
      bedrock: { status: 'ok' }
    },
    expiresAt: 1_791_349_204,
    ...overrides
  };
}

function fakeClient(responses: unknown[] = []): { client: DynamoDbClient; requests: DynamoDbRequest[] } {
  const requests: DynamoDbRequest[] = [];
  const send = vi.fn(async (request: DynamoDbRequest): Promise<unknown> => {
    requests.push(request);
    const inputs = request.operation === 'transactWrite'
      ? request.input.TransactItems.map(item => 'Update' in item ? item.Update : 'Put' in item ? item.Put : item.ConditionCheck)
      : [request.input];
    for (const input of inputs) {
      const fields = input as unknown as Record<string, unknown>;
      const expression = ['UpdateExpression', 'ConditionExpression', 'KeyConditionExpression', 'FilterExpression']
        .map(key => fields[key]).filter(value => typeof value === 'string').join(' ');
      const used = new Set(expression.match(/[#:]\w+/g) ?? []);
      for (const key of ['ExpressionAttributeNames', 'ExpressionAttributeValues']) {
        const attributes = fields[key];
        if (typeof attributes !== 'object' || attributes === null) continue;
        for (const name of Object.keys(attributes)) {
          if (!used.has(name)) throw Object.assign(new Error('Unused expression attribute'), { name: 'ValidationException' });
        }
      }
    }
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next ?? {};
  });
  return { client: { send }, requests };
}

function repository(client: DynamoDbClient, timeoutMs = 100): DynamoDbStateRepository {
  return new DynamoDbStateRepository({ client, tableName: 'contextia-dev-main', timeoutMs });
}

function storedProfile(userId = 'user-1', value: unknown = preferences): Record<string, unknown> {
  return {
    PK: `USER#${userId}`,
    SK: 'PROFILE',
    entityType: 'UserProfile',
    preferences: value,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    schemaVersion: 1
  };
}

describe('conditional initial profile', () => {
  it('uses an atomic absent-profile condition without affecting ordinary updates', async () => {
    const { client, requests } = fakeClient();
    await repository(client).putPreferences({ userId: 'user-1', preferences, at: processedAt, createOnly: true });
    expect(requests[0]?.input).toMatchObject({ ConditionExpression: 'attribute_not_exists(PK)' });
    await repository(client).putPreferences({ userId: 'user-1', preferences, at: processedAt });
    expect(requests[1]?.input).not.toHaveProperty('ConditionExpression');
  });
  it('normalizes a lost creation race without exposing the raw error', async () => {
    const { client } = fakeClient([Object.assign(new Error('private'), { name: 'ConditionalCheckFailedException' })]);
    expect(await repository(client).putPreferences({ userId: 'user-1', preferences, at: processedAt, createOnly: true })).toMatchObject({ status: 'error', data: null, code: 'PROFILE_EXISTS' });
  });
});

function storedState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    PK: 'USER#user-1',
    SK: 'STATE',
    entityType: 'UserState',
    notificationDay: '2026-10-01',
    notificationsSentToday: 1,
    latestContextEvaluationId: 'eval-1',
    latestContextCapturedAt: capturedAt,
    latestContextFingerprint: 'sha256:current',
    latestContextProcessedAt: processedAt,
    recentAnchors: {},
    createdAt: processedAt,
    updatedAt: processedAt,
    schemaVersion: 1,
    ...overrides
  };
}

function stateUpdateFrom(requests: DynamoDbRequest[]): DynamoDbUpdateInput | undefined {
  const request = requests.at(-1);
  if (request?.operation !== 'transactWrite') return undefined;
  const item = request.input.TransactItems.find(candidate => 'Update' in candidate && candidate.Update.Key.SK === 'STATE');
  return item !== undefined && 'Update' in item ? item.Update : undefined;
}

function expectExpressionAttributeDefinitionsToMatch(update: DynamoDbUpdateInput): void {
  const expression = `${update.UpdateExpression} ${update.ConditionExpression ?? ''}`;
  const usedNames = [...new Set(expression.match(/#[\w]+/g) ?? [])].sort();
  const usedValues = [...new Set(expression.match(/:[\w]+/g) ?? [])].sort();
  expect(usedNames).toEqual(Object.keys(update.ExpressionAttributeNames ?? {}).sort());
  expect(usedValues).toEqual(Object.keys(update.ExpressionAttributeValues ?? {}).sort());
}

function storedPointer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    PK: 'USER#user-1',
    SK: 'RECOMMENDATION_REF#rec-1',
    entityType: 'RecommendationRef',
    recommendationId: 'rec-1',
    evaluationId: 'eval-1',
    targetSK: 'RECOMMENDATION#2026-10-01T01:00:08.000Z#rec-1',
    expiresAt: 1_791_349_204,
    createdAt: processedAt,
    updatedAt: processedAt,
    schemaVersion: 1,
    ...overrides
  };
}

function storedRecommendation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const value = recommendation();
  return {
    PK: 'USER#user-1',
    SK: 'RECOMMENDATION#2026-10-01T01:00:08.000Z#rec-1',
    entityType: 'Recommendation',
    recommendationId: value.id,
    evaluationId: value.evaluationId,
    contextReference: value.contextReference,
    createdAt: value.createdAt,
    triggerType: value.triggerType,
    urgency: value.urgency,
    message: value.message,
    items: [{
      id: 'item-1',
      title: 'Coffee Stand',
      reason: '次の予定まで時間があります',
      place: { provider: 'amazon-location', placeId: 'place-1', name: 'Coffee Stand', latitude: 35.6812, longitude: 139.7671, distanceMeters: 250 },
      action: { type: 'MAP' }
    }],
    usedSignals: value.usedSignals,
    summaryForDedup: value.summaryForDedup,
    providerStatus: value.providerStatus,
    expiresAt: value.expiresAt,
    schemaVersion: 1,
    ...overrides
  };
}

describe('DynamoDbStateRepository', () => {
  it('scopes profile reads to the authenticated user and validates normalized preferences', async () => {
    const fake = fakeClient([{ Item: storedProfile('user-2') }]);
    const result = await repository(fake.client).getProfile({ userId: 'user-2' });

    expect(fake.requests[0]).toMatchObject({
      operation: 'get',
      input: { Key: { PK: 'USER#user-2', SK: 'PROFILE' }, ConsistentRead: true }
    });
    expect(result).toMatchObject({ status: 'ok', data: { userId: 'user-2', preferences } });

    const foreignItem = fakeClient([{ Item: storedProfile('user-2') }]);
    await expect(repository(foreignItem.client).getProfile({ userId: 'user-1' })).resolves.toMatchObject({
      status: 'error', data: null, code: 'INVALID_STORED_DATA'
    });

    const malformed = fakeClient([{ Item: storedProfile('user-2', { notificationsEnabled: 'yes' }) }]);
    await expect(repository(malformed.client).getProfile({ userId: 'user-2' })).resolves.toMatchObject({
      status: 'error', data: null, code: 'INVALID_STORED_DATA'
    });
  });

  it('treats a logically expired context snapshot as absent', async () => {
    const item = {
      PK: 'USER#user-1',
      SK: `CONTEXT#${new Date(Date.parse(capturedAt)).toISOString()}#eval-1`,
      entityType: 'ContextSnapshot',
      evaluationId: 'eval-1',
      mode: 'real',
      capturedAt,
      location: { latitude: 35.68, longitude: 139.76 },
      calendar: [],
      createdAt: processedAt,
      expiresAt: 1_000,
      schemaVersion: 1
    };
    const fake = fakeClient([{ Item: item }]);

    const result = await repository(fake.client).getContextSnapshot({
      userId: 'user-1',
      nowEpochSeconds: 1_000,
      reference: { evaluationId: 'eval-1', capturedAt }
    });

    expect(result).toMatchObject({ status: 'ok', data: null });
    expect(fake.requests[0]).toMatchObject({
      operation: 'get',
      input: { Key: { PK: 'USER#user-1', SK: `CONTEXT#${new Date(Date.parse(capturedAt)).toISOString()}#eval-1` } }
    });
  });

  it('writes snapshot and latest state from processedAt while preserving capturedAt', async () => {
    const fake = fakeClient();
    const result = await repository(fake.client).writeContextSnapshot({
      userId: 'user-1',
      snapshot: snapshot(),
      fingerprint: 'sha256:current',
      processedAt,
      notificationDay: '2026-10-01'
    });

    expect(result).toMatchObject({ status: 'ok', data: null });
    expect(fake.requests).toHaveLength(1);
    const request = fake.requests[0];
    expect(request?.operation).toBe('transactWrite');
    if (request?.operation !== 'transactWrite') throw new Error('Expected a transaction');
    const put = request.input.TransactItems.find(item => 'Put' in item)?.Put;
    const update = request.input.TransactItems.find(item => 'Update' in item)?.Update;
    expect(put?.Item).toMatchObject({
      SK: `CONTEXT#${new Date(Date.parse(capturedAt)).toISOString()}#eval-1`,
      capturedAt,
      createdAt: processedAt,
      expiresAt: Math.floor(Date.parse(processedAt) / 1_000) + 86_400
    });
    expect(update?.ExpressionAttributeValues).toMatchObject({
      ':evaluationId': 'eval-1',
      ':capturedAt': capturedAt,
      ':fingerprint': 'sha256:current',
      ':processedAt': processedAt,
      ':notificationDay': '2026-10-01',
      ':zero': 0
    });
    expect(update?.UpdateExpression).toContain('latestContextProcessedAt');
    expect(update?.UpdateExpression).toContain('#notificationDay = if_not_exists(#notificationDay, :notificationDay)');
    expect(update?.UpdateExpression).toContain('#notificationsSentToday = if_not_exists(#notificationsSentToday, :zero)');
    expect(update?.UpdateExpression).not.toContain('#notificationsSentToday = if_not_exists(#notificationsSentToday, :zero) +');
    expect(update?.UpdateExpression).not.toContain('#recentAnchors.#anchor');
  });

  it('initializes preview delivery state without incrementing counts or appending anchors', async () => {
    const fake = fakeClient();
    await repository(fake.client).writeContextSnapshot({
      userId: 'user-1',
      snapshot: snapshot({ mode: 'simulation' }),
      fingerprint: 'sha256:preview',
      processedAt,
      notificationDay: '2026-10-01'
    });
    const request = fake.requests[0];
    if (request?.operation !== 'transactWrite') throw new Error('Expected a transaction');
    const update = request.input.TransactItems.find(item => 'Update' in item);
    if (update === undefined || !('Update' in update)) throw new Error('Expected state update');

    expect(update.Update.UpdateExpression).toContain('#notificationDay = if_not_exists(#notificationDay, :notificationDay)');
    expect(update.Update.UpdateExpression).toContain('#notificationsSentToday = if_not_exists(#notificationsSentToday, :zero)');
    expect(update.Update.UpdateExpression).not.toContain('#notificationsSentToday = if_not_exists(#notificationsSentToday, :zero) +');
    expect(update.Update.UpdateExpression).toContain('#recentAnchors = if_not_exists(#recentAnchors, :emptyMap)');
    expect(update.Update.UpdateExpression).not.toContain('#recentAnchors.#anchor');
    expect(update.Update.ExpressionAttributeValues).toMatchObject({ ':notificationDay': '2026-10-01', ':zero': 0, ':emptyMap': {} });
  });

  it('writes a normalized recommendation and ID pointer in one transaction', async () => {
    const fake = fakeClient();
    const result = await repository(fake.client).writeRecommendation({ userId: 'user-1', recommendation: recommendation() });

    expect(result).toMatchObject({ status: 'ok', data: null });
    expect(fake.requests).toHaveLength(1);
    const request = fake.requests[0];
    expect(request?.operation).toBe('transactWrite');
    if (request?.operation !== 'transactWrite') throw new Error('Expected a transaction');
    expect(request.input.TransactItems).toHaveLength(2);
    const items = request.input.TransactItems.flatMap(item => 'Put' in item ? [item.Put.Item] : []);
    const target = items.find(item => item.entityType === 'Recommendation');
    const pointer = items.find(item => item.entityType === 'RecommendationRef');
    expect(target).toMatchObject({
      PK: 'USER#user-1',
      SK: 'RECOMMENDATION#2026-10-01T01:00:08.000Z#rec-1',
      recommendationId: 'rec-1',
      items: [{ place: { provider: 'amazon-location', placeId: 'place-1', name: 'Coffee Stand', latitude: 35.6812, longitude: 139.7671, distanceMeters: 250 } }]
    });
    expect(pointer).toMatchObject({
      PK: 'USER#user-1',
      SK: 'RECOMMENDATION_REF#rec-1',
      recommendationId: 'rec-1',
      targetSK: target?.SK,
      expiresAt: recommendation().expiresAt
    });
  });

  it('commits a proactive recommendation, pointer and quota update atomically without a prior pointer read', async () => {
    const fake = fakeClient([{ Item: storedProfile() }, { Item: storedState({ notificationsSentToday: 0 }) }, {}]);
    const repo = repository(fake.client) as unknown as {
      commitProactiveRecommendation(input: { userId: string; recommendation: RecommendationWrite; delivery: ProactiveDeliveryWrite }): Promise<unknown>
    };

    const result = await repo.commitProactiveRecommendation({ userId: 'user-1', recommendation: recommendation(), delivery });

    expect(result).toMatchObject({ status: 'ok', data: { recorded: true } });
    expect(fake.requests.map(request => request.operation)).toEqual(['get', 'get', 'transactWrite']);
    const request = fake.requests[2];
    if (request?.operation !== 'transactWrite') throw new Error('Expected a transaction');
    expect(request.input.TransactItems).toHaveLength(4);
    const puts = request.input.TransactItems.flatMap(item => 'Put' in item ? [item.Put] : []);
    const target = puts.find(item => item.Item.entityType === 'Recommendation');
    const pointer = puts.find(item => item.Item.entityType === 'RecommendationRef');
    const stateUpdate = request.input.TransactItems.find(item => 'Update' in item && item.Update.Key.SK === 'STATE');
    expect(target?.ConditionExpression).toContain('attribute_not_exists');
    expect(pointer?.Item).toMatchObject({
      SK: 'RECOMMENDATION_REF#rec-1', deliveryRecordedAt: new Date(Date.parse(delivery.at)).toISOString()
    });
    expect(pointer?.ConditionExpression).toContain('attribute_not_exists');
    expect(stateUpdate).toBeDefined();
    const profileCheck = request.input.TransactItems.find(item => 'ConditionCheck' in item);
    if (!profileCheck || !('ConditionCheck' in profileCheck)) throw new Error('Expected profile condition');
    expect(profileCheck.ConditionCheck.ConditionExpression).toContain('#notificationFrequency = :frequency');
    expect(profileCheck.ConditionCheck.ExpressionAttributeValues).toMatchObject({ ':frequency': 'normal' });
  });

  it('suppresses a stale evaluation after notification frequency changes', async () => {
    const fake = fakeClient([{ Item: storedProfile('user-1', { ...preferences, notificationFrequency: 'low' }) }]);
    const result = await repository(fake.client).commitProactiveRecommendation({
      userId: 'user-1', recommendation: recommendation(), delivery
    });
    expect(result).toMatchObject({ status: 'ok', data: { recorded: false, reason: 'superseded' } });
    expect(fake.requests.map(request => request.operation)).toEqual(['get']);
  });

  it('classifies a confirmed atomic conditional race without persisting the recommendation', async () => {
    const cancellation = Object.assign(new Error('private database detail'), { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }, { Code: 'None' }, { Code: 'None' }] });
    const fake = fakeClient([{ Item: storedProfile() }, { Item: storedState({ notificationsSentToday: 0 }) }, cancellation]);
    const repo = repository(fake.client) as unknown as {
      commitProactiveRecommendation(input: { userId: string; recommendation: RecommendationWrite; delivery: ProactiveDeliveryWrite }): Promise<unknown>
    };

    const result = await repo.commitProactiveRecommendation({ userId: 'user-1', recommendation: recommendation(), delivery });

    expect(result).toMatchObject({ status: 'ok', data: { recorded: false, reason: 'superseded' } });
    expect(fake.requests.map(request => request.operation)).toEqual(['get', 'get', 'transactWrite']);
    expect(JSON.stringify(result)).not.toContain('private database detail');
  });

  it.each(['2026-10-01', '2026-09-30'])('uses only referenced expression attributes on day %s', async notificationDay => {
    const fake = fakeClient([{ Item: storedProfile() }, { Item: storedState({ notificationDay, notificationsSentToday: 0 }) }, {}]);
    expect(await repository(fake.client).commitProactiveRecommendation({ userId: 'user-1', recommendation: recommendation(), delivery }))
      .toMatchObject({ status: 'ok', data: { recorded: true } });
  });

  it('keeps unclassified or throttled transaction failures as provider errors', async () => {
    for (const CancellationReasons of [undefined, [{ Code: 'ConditionalCheckFailed' }, { Code: 'ThrottlingError' }]]) {
      const failure = Object.assign(new Error('private detail'), { name: 'TransactionCanceledException', CancellationReasons });
      const fake = fakeClient([{ Item: storedProfile() }, { Item: storedState() }, failure]);
      expect(await repository(fake.client).commitProactiveRecommendation({ userId: 'user-1', recommendation: recommendation(), delivery }))
        .toMatchObject({ status: 'error', data: null });
    }
  });

  it('distinguishes a superseded snapshot from a missing state', async () => {
    const newer = fakeClient([{ Item: storedProfile() }, { Item: storedState({ latestContextEvaluationId: 'eval-newer', latestContextFingerprint: 'sha256:newer' }) }]);
    expect(await repository(newer.client).commitProactiveRecommendation({ userId: 'user-1', recommendation: recommendation(), delivery }))
      .toMatchObject({ status: 'ok', data: { recorded: false, reason: 'superseded' } });
    const missing = fakeClient([{ Item: storedProfile() }, {}]);
    expect(await repository(missing.client).commitProactiveRecommendation({ userId: 'user-1', recommendation: recommendation(), delivery }))
      .toMatchObject({ status: 'error', code: 'STATE_NOT_FOUND' });
  });

  it('resolves a recommendation through its owner-scoped pointer and validates the target evaluation', async () => {
    const fake = fakeClient([
      { Item: storedPointer() },
      { Item: storedRecommendation() }
    ]);

    const result = await repository(fake.client).getRecommendation({
      userId: 'user-1', nowEpochSeconds: 1_791_349_100, recommendationId: 'rec-1'
    });

    expect(result).toMatchObject({
      status: 'ok',
      data: { id: 'rec-1', evaluationId: 'eval-1', recommendations: [{ place: { placeId: 'place-1' } }] }
    });
    expect(fake.requests.map(request => request.operation)).toEqual(['get', 'get']);

    const mismatched = fakeClient([
      { Item: storedPointer({ evaluationId: 'eval-other' }) },
      { Item: storedRecommendation() }
    ]);
    await expect(repository(mismatched.client).getRecommendation({
      userId: 'user-1', nowEpochSeconds: 1_791_349_100, recommendationId: 'rec-1'
    })).resolves.toMatchObject({ status: 'error', data: null, code: 'INVALID_STORED_DATA' });
  });

  it('rejects non-Storage selected places before touching DynamoDB', async () => {
    const invalid = recommendation({ recommendations: [{
      id: 'item-1',
      title: 'Coffee Stand',
      reason: 'nearby',
      place: { persistenceIntent: 'single-use', place: { provider: 'amazon-location', placeId: 'place-1', name: 'Coffee Stand', latitude: 35, longitude: 139 } },
      action: { type: 'MAP' }
    }] as unknown as RecommendationWrite['recommendations'] });
    const fake = fakeClient();

    const result = await repository(fake.client).writeRecommendation({ userId: 'user-1', recommendation: invalid });

    expect(result).toMatchObject({ status: 'error', data: null, code: 'INVALID_REQUEST' });
    expect(fake.requests).toHaveLength(0);
  });

  it('records delivery with atomic cap, fingerprint, anchor, profile and pointer conditions', async () => {
    const fake = fakeClient([
      { Item: storedProfile() },
      { Item: storedState() },
      { Item: storedPointer() },
      {}
    ]);

    const result = await repository(fake.client).recordProactiveDelivery({ userId: 'user-1', delivery });

    expect(result).toMatchObject({ status: 'ok', data: { recorded: true } });
    const request = fake.requests.at(-1);
    expect(request?.operation).toBe('transactWrite');
    if (request?.operation !== 'transactWrite') throw new Error('Expected a transaction');
    expect(request.input.TransactItems).toHaveLength(3);
    const stateUpdateItem = request.input.TransactItems.find(item => 'Update' in item && item.Update.Key.SK === 'STATE');
    const pointerUpdateItem = request.input.TransactItems.find(item => 'Update' in item && item.Update.Key.SK === 'RECOMMENDATION_REF#rec-1');
    const stateUpdate = stateUpdateItem !== undefined && 'Update' in stateUpdateItem ? stateUpdateItem.Update : undefined;
    const pointerUpdate = pointerUpdateItem !== undefined && 'Update' in pointerUpdateItem ? pointerUpdateItem.Update : undefined;
    expect(stateUpdate?.ConditionExpression).toMatch(/notificationsSentToday|notificationDay/);
    expect(stateUpdate?.ConditionExpression).toContain('latestContextFingerprint');
    expect(stateUpdate?.ConditionExpression).toContain('recentAnchors');
    expect(stateUpdate).toBeDefined();
    if (stateUpdate === undefined) throw new Error('Expected the state update');
    expect(stateUpdate.ExpressionAttributeValues).toMatchObject({ ':zero': 0, ':max': 3 });
    expectExpressionAttributeDefinitionsToMatch(stateUpdate);
    const profileCheck = request.input.TransactItems.find(item => 'ConditionCheck' in item);
    const profileCondition = profileCheck !== undefined && 'ConditionCheck' in profileCheck ? profileCheck.ConditionCheck : undefined;
    expect(profileCondition?.ConditionExpression).toContain('timezone');
    expect(profileCondition?.ExpressionAttributeValues).toMatchObject({ ':timezone': 'Asia/Tokyo' });
    expect(pointerUpdate?.ConditionExpression).toContain('deliveryRecordedAt');
    expect(pointerUpdate?.UpdateExpression).toContain('deliveryRecordedAt');
  });

  it('uses only defined expression attributes when the notification day rolls over', async () => {
    const fake = fakeClient([
      { Item: storedProfile() },
      { Item: storedState({ notificationDay: '2026-09-30' }) },
      { Item: storedPointer() },
      {}
    ]);

    const result = await repository(fake.client).recordProactiveDelivery({ userId: 'user-1', delivery });

    expect(result).toMatchObject({ status: 'ok', data: { recorded: true } });
    const stateUpdate = stateUpdateFrom(fake.requests);
    expect(stateUpdate).toBeDefined();
    if (stateUpdate === undefined) throw new Error('Expected the state update');
    expect(stateUpdate.ExpressionAttributeValues).not.toHaveProperty(':zero');
    expect(stateUpdate.ExpressionAttributeValues).not.toHaveProperty(':max');
    expectExpressionAttributeDefinitionsToMatch(stateUpdate);
  });

  it('returns cap and anchor guards without recording when already suppressed', async () => {
    const at = delivery.at;
    const fake = fakeClient([
      { Item: storedProfile() },
      { Item: storedState({ notificationsSentToday: 3, recentAnchors: { 'FREE_TIME_NEARBY#anchor-1': at } }) },
      { Item: storedPointer() }
    ]);

    const result = await repository(fake.client).recordProactiveDelivery({ userId: 'user-1', delivery });

    expect(result).toMatchObject({
      status: 'ok',
      data: { recorded: false, guardCodes: ['DAILY_CAP_REACHED', 'RECENT_SAME_TRIGGER'] }
    });
    expect(fake.requests.map(request => request.operation)).toEqual(['get', 'get', 'get']);
  });

  it('rechecks recent matching fingerprints from another evaluation before delivery', async () => {
    const fake = fakeClient([
      { Item: storedProfile() },
      { Item: storedState({ latestContextEvaluationId: 'eval-prior', latestContextProcessedAt: '2026-10-01T09:59:00.000+09:00' }) },
      { Item: storedPointer() }
    ]);

    const result = await repository(fake.client).recordProactiveDelivery({ userId: 'user-1', delivery });

    expect(result).toMatchObject({
      status: 'ok', data: { recorded: false, guardCodes: ['DUPLICATE_CONTEXT'] }
    });
    expect(fake.requests.map(request => request.operation)).toEqual(['get', 'get', 'get']);
  });

  it('does not duplicate a recommendation delivery after a concurrent transaction condition failure', async () => {
    const cancellation = Object.assign(new Error('private database detail'), { name: 'TransactionCanceledException' });
    const fake = fakeClient([
      { Item: storedProfile() },
      { Item: storedState() },
      { Item: storedPointer() },
      cancellation
    ]);

    const result = await repository(fake.client).recordProactiveDelivery({ userId: 'user-1', delivery });

    expect(result).toMatchObject({ status: 'ok', data: { recorded: false } });
    expect(JSON.stringify(result)).not.toContain('private database detail');
  });

  it('caps query pages at 50, filters logical expiry and returns an owner-bound cursor', async () => {
    const fake = fakeClient([{ Items: [], LastEvaluatedKey: { PK: 'USER#user-1', SK: 'RECOMMENDATION#x' } }]);
    const result = await repository(fake.client).listRecommendations({ userId: 'user-1', nowEpochSeconds: 10, limit: 50 });

    expect(result).toMatchObject({ status: 'ok', data: { items: [], nextCursor: expect.any(String) } });
    expect(fake.requests[0]).toMatchObject({
      operation: 'query',
      input: { Limit: 50, ScanIndexForward: false, FilterExpression: expect.stringContaining('expiresAt') }
    });

    const malformed = fakeClient();
    await expect(repository(malformed.client).listRecommendations({ userId: 'user-1', nowEpochSeconds: 10, limit: 51 }))
      .resolves.toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
    expect(malformed.requests).toHaveLength(0);

    const foreignCursor = Buffer.from(JSON.stringify({ PK: 'USER#someone-else', SK: 'RECOMMENDATION#x' })).toString('base64url');
    const foreign = fakeClient();
    await expect(repository(foreign.client).listRecommendations({ userId: 'user-1', nowEpochSeconds: 10, limit: 20, cursor: foreignCursor }))
      .resolves.toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
    expect(foreign.requests).toHaveLength(0);
  });

  it('returns NOT_IMPLEMENTED for later ports without database access', async () => {
    const fake = fakeClient();
    const result = await repository(fake.client).listDevices({ userId: 'user-1' });

    expect(result).toMatchObject({ status: 'error', data: null, code: 'NOT_IMPLEMENTED' });
    expect(fake.requests).toHaveLength(0);
  });
});

describe('DynamoDB evaluation idempotency', () => {
  const key = '76c7d65e-854f-431a-95b6-513de73102d7';
  const claimId = '430338e7-6d18-4752-9a8b-9f21a6de818b';
  const requestHash = 'a'.repeat(64);
  const nowEpochSeconds = Math.floor(Date.parse(processedAt) / 1000);
  const record = { key, claimId, requestHash, responsePointer: null, createdAt: processedAt, expiresAt: nowEpochSeconds + 3600 };
  const owner = { userId: 'user-1', key, claimId, requestHash };
  const stored = (overrides: Record<string, unknown> = {}) => ({ ...record, PK: 'IDEMPOTENCY#user-1', SK: `KEY#${key}`,
    entityType: 'Idempotency', updatedAt: processedAt, schemaVersion: 1, ...overrides });
  const conditionalFailure = () => Object.assign(new Error('private condition'), { name: 'ConditionalCheckFailedException' });
  const result = EvaluationResultSchema.parse({ evaluationId: 'eval-1', recommendationId: null, decision: 'silent',
    triggerType: null, urgency: null, message: null, recommendations: [], decisionReason: 'No candidate.', usedSignals: [],
    delivery: { mode: 'preview', status: 'preview', wouldSuppress: false, guardCodes: [] },
    contextExpiresAt: new Date((nowEpochSeconds + 86400) * 1000).toISOString(), providerStatus: recommendation().providerStatus });

  it('claims with an atomic logical-expiry condition before DynamoDB TTL deletion', async () => {
    const fake = fakeClient();
    expect(await repository(fake.client).claimIdempotency({ userId: 'user-1', record, nowEpochSeconds }))
      .toMatchObject({ status: 'ok', data: { status: 'claimed' } });
    expect(fake.requests[0]).toMatchObject({ operation: 'put', input: {
      Item: { PK: 'IDEMPOTENCY#user-1', SK: `KEY#${key}`, claimId, responsePointer: null },
      ConditionExpression: 'attribute_not_exists(PK) OR #expiresAt <= :now', ExpressionAttributeValues: { ':now': nowEpochSeconds }
    } });
  });

  it.each([requestHash, 'b'.repeat(64)])('returns only an active owned claim and detects hash conflicts', async storedHash => {
    const fake = fakeClient([conditionalFailure(), { Item: stored({ requestHash: storedHash }) }]);
    expect(await repository(fake.client).claimIdempotency({ userId: 'user-1', record, nowEpochSeconds }))
      .toMatchObject({ status: 'ok', data: { status: storedHash === requestHash ? 'existing' : 'conflict' } });
    expect(fake.requests[1]).toMatchObject({ operation: 'get', input: { ConsistentRead: true, Key: { PK: 'IDEMPOTENCY#user-1' } } });
  });

  it.each([{}, { Item: stored({ expiresAt: nowEpochSeconds }) }])('reclaims a released or expired claim after a conditional race', async response => {
    const fake = fakeClient([conditionalFailure(), response, {}]);
    expect(await repository(fake.client).claimIdempotency({ userId: 'user-1', record, nowEpochSeconds }))
      .toMatchObject({ status: 'ok', data: { status: 'claimed' } });
    expect(fake.requests.map(request => request.operation)).toEqual(['put', 'get', 'put']);
  });

  it('bounds retry when another request keeps replacing expired claims', async () => {
    const fake = fakeClient([conditionalFailure(), {}, conditionalFailure(), {}]);
    expect(await repository(fake.client).claimIdempotency({ userId: 'user-1', record, nowEpochSeconds }))
      .toMatchObject({ status: 'error', code: 'IDEMPOTENCY_CLAIM_RACE' });
    expect(fake.requests).toHaveLength(4);
  });

  it('releases only the owned pending claim and preserves completed/replacement claims', async () => {
    for (const response of [{}, conditionalFailure()]) {
      const fake = fakeClient([response]);
      expect(await repository(fake.client).releaseIdempotency(owner)).toMatchObject({ status: 'ok' });
      expect(fake.requests[0]).toMatchObject({ operation: 'delete', input: {
        Key: { PK: 'IDEMPOTENCY#user-1', SK: `KEY#${key}` },
        ConditionExpression: '#claimId = :claimId AND #requestHash = :hash AND #responsePointer = :pending',
        ExpressionAttributeValues: { ':claimId': claimId, ':hash': requestHash, ':pending': null }
      } });
    }
  });

  it('atomically completes the claim and owner-scoped result, then replays without a request ID', async () => {
    const write = fakeClient();
    expect(await repository(write.client).completeIdempotency({ ...owner, result, storagePlaces: [], expiresAt: record.expiresAt }))
      .toMatchObject({ status: 'ok' });
    const transaction = write.requests[0];
    if (transaction?.operation !== 'transactWrite') throw new Error('Missing cache transaction');
    const cache = transaction.input.TransactItems.find(item => 'Put' in item);
    const update = transaction.input.TransactItems.find(item => 'Update' in item);
    expect(update).toMatchObject({ Update: { ExpressionAttributeValues: { ':claimId': claimId, ':pending': null, ':expiry': record.expiresAt } } });
    expect(cache).toMatchObject({ Put: { Item: { PK: 'USER#user-1', SK: 'EVALUATION_RESULT#eval-1', result, expiresAt: record.expiresAt } } });
    if (!cache || !('Put' in cache)) throw new Error('Missing cache');
    const read = fakeClient([{ Item: stored({ responsePointer: result.evaluationId }) }, { Item: cache.Put.Item }]);
    expect(await repository(read.client).getIdempotencyResponse({ userId: owner.userId, key, requestHash, nowEpochSeconds }))
      .toMatchObject({ status: 'ok', data: result });
    expect(JSON.stringify(cache)).not.toContain('requestId');
  });

  it('requires Storage facts matching the returned place, and handles cards without places', async () => {
    const storage = recommendation().recommendations[0]?.place;
    if (!storage) throw new Error('Missing Storage fixture');
    const { provider, placeId, name, latitude, longitude, distanceMeters } = storage.place;
    const notify = EvaluationResultSchema.parse({ ...result, decision: 'notify', recommendationId: 'rec-1', triggerType: 'FREE_TIME_NEARBY',
      urgency: 'low', message: 'Nearby.', recommendations: [{ id: 'item-1', title: 'Rest', reason: 'Nearby.',
        place: { provider, placeId, name, latitude, longitude, distanceMeters }, action: { type: 'MAP' } }] });
    const fake = fakeClient();
    expect(await repository(fake.client).completeIdempotency({ ...owner, result: notify, storagePlaces: [storage], expiresAt: record.expiresAt })).toMatchObject({ status: 'ok' });
    const invalid = fakeClient();
    expect(await repository(invalid.client).completeIdempotency({ ...owner, result: notify, storagePlaces: [], expiresAt: record.expiresAt })).toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
    const discovery = EvaluationResultSchema.parse({ ...notify, recommendations: notify.recommendations.map(card => ({ ...card, place: { ...card.place, name: 'SingleUse name' } })) });
    expect(await repository(invalid.client).completeIdempotency({ ...owner, result: discovery, storagePlaces: [storage], expiresAt: record.expiresAt })).toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
    expect(invalid.requests).toHaveLength(0);
    const noPlace = EvaluationResultSchema.parse({ ...notify, recommendations: [{ id: 'item-1', title: 'Rest', reason: 'Nearby.', action: { type: 'NONE' } }] });
    expect(await repository(fake.client).completeIdempotency({ ...owner, result: noPlace, storagePlaces: [], expiresAt: record.expiresAt })).toMatchObject({ status: 'ok' });
  });

  it('rejects an injected foreign owner and skips expired or mismatched responses', async () => {
    const foreign = fakeClient([conditionalFailure(), { Item: stored({ PK: 'IDEMPOTENCY#user-2' }) }]);
    expect(await repository(foreign.client).claimIdempotency({ userId: 'user-1', record, nowEpochSeconds })).toMatchObject({ status: 'error', code: 'INVALID_STORED_DATA' });
    for (const item of [stored({ expiresAt: nowEpochSeconds }), stored({ requestHash: 'b'.repeat(64) }), stored()]) {
      const fake = fakeClient([{ Item: item }]);
      expect(await repository(fake.client).getIdempotencyResponse({ userId: 'user-1', key, requestHash, nowEpochSeconds })).toMatchObject({ status: 'ok', data: null });
      expect(fake.requests).toHaveLength(1);
    }
  });
});
