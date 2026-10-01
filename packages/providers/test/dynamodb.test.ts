import { describe, expect, it, vi } from 'vitest';
import type { UserPreferences } from '@contextia/contracts';
import type { DynamoDbClient, DynamoDbRequest } from '../src/adapters/dynamodb.js';
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
  });

  it('does not persist a proactive recommendation when the atomic delivery recheck cancels', async () => {
    const cancellation = Object.assign(new Error('private database detail'), { name: 'TransactionCanceledException' });
    const fake = fakeClient([{ Item: storedProfile() }, { Item: storedState({ notificationsSentToday: 0 }) }, cancellation]);
    const repo = repository(fake.client) as unknown as {
      commitProactiveRecommendation(input: { userId: string; recommendation: RecommendationWrite; delivery: ProactiveDeliveryWrite }): Promise<unknown>
    };

    const result = await repo.commitProactiveRecommendation({ userId: 'user-1', recommendation: recommendation(), delivery });

    expect(result).toMatchObject({ status: 'ok', data: { recorded: false } });
    expect(fake.requests.map(request => request.operation)).toEqual(['get', 'get', 'transactWrite']);
    expect(JSON.stringify(result)).not.toContain('private database detail');
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
    const profileCheck = request.input.TransactItems.find(item => 'ConditionCheck' in item);
    const profileCondition = profileCheck !== undefined && 'ConditionCheck' in profileCheck ? profileCheck.ConditionCheck : undefined;
    expect(profileCondition?.ConditionExpression).toContain('timezone');
    expect(profileCondition?.ExpressionAttributeValues).toMatchObject({ ':timezone': 'Asia/Tokyo' });
    expect(pointerUpdate?.ConditionExpression).toContain('deliveryRecordedAt');
    expect(pointerUpdate?.UpdateExpression).toContain('deliveryRecordedAt');
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
