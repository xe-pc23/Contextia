import { describe, expect, it, vi } from 'vitest';
import type { NotifyDecision, ProviderPlace } from '@contextia/contracts';
import { getScenarioInput } from '@contextia/test-fixtures';
import { DynamoDbStateRepository } from '@contextia/providers';
import type { DynamoDbClient, DynamoDbItem, DynamoDbRequest, DynamoDbTransactionItem, DynamoDbUpdateInput, PlacesProvider } from '@contextia/providers';
import { createEvaluateContext } from '../src/application/evaluateContext.js';
import { createEvaluationDomain, phase1Detectors } from '../src/composition/evaluationDomain.js';

const nowStart = new Date('2026-10-01T05:10:00.000Z');
const preferences = {
  interests: ['cafe'], stepGoal: 10_000, notificationFrequency: 'normal' as const,
  notificationsEnabled: true, locale: 'ja-JP', timezone: 'Asia/Tokyo'
};
const place: ProviderPlace = {
  provider: 'amazon-location', placeId: 'place-1', name: 'Coffee Stand', latitude: 35.6812, longitude: 139.7671,
  distanceMeters: 250, categoryNames: ['cafe']
};
const placeReference = {
  provider: place.provider, placeId: place.placeId, name: place.name,
  latitude: place.latitude, longitude: place.longitude, distanceMeters: place.distanceMeters
};
const decision: NotifyDecision = {
  decision: 'notify', decisionReason: 'A nearby cafe is a useful place to rest.', usedSignals: ['steps', 'location', 'places'],
  urgency: 'low', message: '近くのカフェで休憩しませんか。',
  recommendations: [{ title: place.name, reason: '徒歩圏内です。', place: placeReference, action: { type: 'MAP' } }]
};

function key(PK: string, SK: string): string { return `${PK}\u0000${SK}`; }

function cancellation(): Error {
  return Object.assign(new Error('transaction condition failed'), { name: 'TransactionCanceledException' });
}

class MemoryDynamoDb implements DynamoDbClient {
  private readonly items = new Map<string, Record<string, unknown>>();

  constructor(profilePreferences = preferences) {
    this.items.set(key('USER#user-1', 'PROFILE'), {
      PK: 'USER#user-1', SK: 'PROFILE', entityType: 'UserProfile', preferences: profilePreferences,
      createdAt: nowStart.toISOString(), updatedAt: nowStart.toISOString(), schemaVersion: 1
    });
  }

  get state(): Record<string, unknown> | undefined { return this.items.get(key('USER#user-1', 'STATE')); }
  get recommendations(): Record<string, unknown>[] {
    return [...this.items.values()].filter(item => item.entityType === 'Recommendation');
  }
  get pointers(): Record<string, unknown>[] {
    return [...this.items.values()].filter(item => item.entityType === 'RecommendationRef');
  }

  async send(request: DynamoDbRequest): Promise<unknown> {
    if (request.operation === 'get') {
      const item = this.items.get(key(request.input.Key.PK, request.input.Key.SK));
      return item === undefined ? {} : { Item: structuredClone(item) };
    }
    if (request.operation === 'query') {
      const values = request.input.ExpressionAttributeValues ?? {};
      const pk = values[':pk'];
      const prefix = values[':prefix'];
      const now = values[':now'];
      const found = [...this.items.values()].filter(item => item.PK === pk && typeof item.SK === 'string'
        && item.SK.startsWith(String(prefix)) && typeof item.expiresAt === 'number' && item.expiresAt > Number(now))
        .sort((left, right) => String(right.SK).localeCompare(String(left.SK)))
        .slice(0, request.input.Limit ?? 50);
      return { Items: structuredClone(found) };
    }
    if (request.operation === 'transactWrite') {
      this.applyTransaction(request.input.TransactItems);
      return {};
    }
    throw new Error(`Unexpected DynamoDB operation: ${request.operation}`);
  }

  private applyTransaction(transactions: DynamoDbTransactionItem[]): void {
    const stateUpdate = transactions.find(item => 'Update' in item && item.Update.Key.SK === 'STATE');
    const recommendationPut = transactions.find(item => 'Put' in item && item.Put.Item.entityType === 'Recommendation');
    if (stateUpdate === undefined || !('Update' in stateUpdate)) {
      for (const operation of transactions) if ('Put' in operation) this.put(operation.Put.Item);
      return;
    }
    if (recommendationPut !== undefined && 'Put' in recommendationPut) {
      this.applyProactiveCommit(transactions, stateUpdate.Update, recommendationPut.Put.Item);
      return;
    }
    this.applySnapshotWrite(transactions, stateUpdate.Update);
  }

  private applySnapshotWrite(transactions: DynamoDbTransactionItem[], update: DynamoDbUpdateInput): void {
    for (const operation of transactions) if ('Put' in operation) this.put(operation.Put.Item);
    const itemKey = key(update.Key.PK, update.Key.SK);
    const state = this.items.get(itemKey) ?? { ...update.Key, entityType: 'UserState' };
    const names = update.ExpressionAttributeNames ?? {};
    const values = update.ExpressionAttributeValues ?? {};
    const assign = (alias: string, valueAlias: string, onlyIfMissing = false) => {
      const field = names[alias];
      if (field !== undefined && (!onlyIfMissing || state[field] === undefined)) state[field] = values[valueAlias];
    };
    assign('#entityType', ':entityType');
    assign('#latestContextEvaluationId', ':evaluationId');
    assign('#latestContextCapturedAt', ':capturedAt');
    assign('#latestContextFingerprint', ':fingerprint');
    assign('#latestContextProcessedAt', ':processedAt');
    assign('#notificationDay', ':notificationDay', true);
    assign('#notificationsSentToday', ':zero', true);
    assign('#recentAnchors', ':emptyMap', true);
    assign('#createdAt', ':processedAt', true);
    assign('#updatedAt', ':processedAt');
    assign('#schemaVersion', ':schemaVersion');
    this.items.set(itemKey, state);
  }

  private applyProactiveCommit(transactions: DynamoDbTransactionItem[], update: DynamoDbUpdateInput, recommendation: DynamoDbItem): void {
    const stateKey = key(update.Key.PK, update.Key.SK);
    const state = this.items.get(stateKey);
    const values = update.ExpressionAttributeValues ?? {};
    const names = update.ExpressionAttributeNames ?? {};
    const profileCheck = transactions.find(item => 'ConditionCheck' in item && item.ConditionCheck.Key.SK === 'PROFILE');
    const profile = this.items.get(key(update.Key.PK, 'PROFILE'));
    const profilePreferences = profile?.preferences as typeof preferences | undefined;
    const sameDay = state?.notificationDay === values[':day'];
    const anchorKey = names['#anchor'];
    const anchorValue = (state?.recentAnchors as Record<string, string> | undefined)?.[anchorKey ?? ''];
    const puts = transactions.flatMap(item => 'Put' in item ? [item.Put] : []);
    const targetPut = puts.find(item => item.Item.entityType === 'Recommendation');
    const pointerPut = puts.find(item => item.Item.entityType === 'RecommendationRef');
    const expectedCount = Number(values[':max']);
    const conditionHolds = profileCheck !== undefined && profilePreferences?.notificationsEnabled === true
      && 'ConditionCheck' in profileCheck && profilePreferences.timezone === profileCheck.ConditionCheck.ExpressionAttributeValues?.[':timezone']
      && state !== undefined && state.latestContextEvaluationId === values[':evaluationId']
      && state.latestContextFingerprint === values[':fingerprint']
      && (!sameDay || Number(state.notificationsSentToday ?? 0) < expectedCount)
      && (anchorValue === undefined || Date.parse(anchorValue) <= Date.parse(String(values[':anchorCutoff'])))
      && targetPut !== undefined && pointerPut !== undefined
      && !this.items.has(key(recommendation.PK, recommendation.SK))
      && !this.items.has(key(pointerPut.Item.PK, pointerPut.Item.SK));
    if (!conditionHolds || state === undefined || targetPut === undefined || pointerPut === undefined) throw cancellation();

    const nextState = { ...state };
    nextState.notificationDay = values[':day'];
    nextState.notificationsSentToday = sameDay ? Number(state.notificationsSentToday ?? 0) + 1 : 1;
    nextState.recentAnchors = { ...(state.recentAnchors as Record<string, string> | undefined), [anchorKey ?? '']: values[':at'] };
    nextState.latestRecommendationAt = values[':at'];
    nextState.updatedAt = values[':at'];
    this.items.set(stateKey, nextState);
    for (const operation of transactions) if ('Put' in operation) this.put(operation.Put.Item);
  }

  private put(item: DynamoDbItem): void {
    this.items.set(key(item.PK, item.SK), structuredClone(item));
  }
}

function setup(profilePreferences = preferences) {
  let now = nowStart;
  const database = new MemoryDynamoDb(profilePreferences);
  const state = new DynamoDbStateRepository({ client: database, tableName: 'contextia-test', timeoutMs: 100 });
  const input = getScenarioInput('step-goal');
  const places: PlacesProvider = {
    searchNearby: vi.fn(async () => ({ status: 'ok' as const, data: [place] })),
    getPlace: vi.fn(async request => ({ status: 'ok' as const, data: { persistenceIntent: request.persistenceIntent, place } }))
  };
  const evaluate = createEvaluateContext({
    domain: createEvaluationDomain({ detectors: phase1Detectors }), state,
    places,
    model: { decide: vi.fn(async () => ({ status: 'ok' as const, data: decision })) },
    clock: () => now,
    newId: (() => { let sequence = 0; return prefix => `${prefix}-${++sequence}`; })()
  });
  return { database, evaluate, input, setNow: (value: Date) => { now = value; } };
}

describe('context evaluation with DynamoDB adapter', () => {
  it('stores a new proactive recommendation and its delivery pointer in the same commit', async () => {
    const { database, evaluate, input } = setup();
    const proactive = { ...input, mode: 'real' as const, deliveryMode: 'proactive' as const, location: { ...input.location, source: 'gps' as const } };

    const result = await evaluate({ userId: 'user-1', context: proactive });

    expect(result).toMatchObject({ decision: 'notify', delivery: { status: 'ready' } });
    expect(database.recommendations).toHaveLength(1);
    expect(database.pointers).toHaveLength(1);
    expect(database.pointers[0]).toMatchObject({ recommendationId: result.recommendationId, deliveryRecordedAt: nowStart.toISOString() });
    expect(database.state).toMatchObject({ notificationDay: '2026-10-01', notificationsSentToday: 1, recentAnchors: { 'STEP_GOAL_REST#2026-10-01': nowStart.toISOString() } });
  });

  it('allows a preview to be repeated after first creating state without consuming quota or anchors', async () => {
    const { database, evaluate, input, setNow } = setup();

    const first = await evaluate({ userId: 'user-1', context: input });
    setNow(new Date(nowStart.getTime() + 60_000));
    const second = await evaluate({ userId: 'user-1', context: input });

    expect(first).toMatchObject({ decision: 'notify', delivery: { mode: 'preview', wouldSuppress: false } });
    expect(second).toMatchObject({ decision: 'notify', delivery: { mode: 'preview', wouldSuppress: true, guardCodes: ['DUPLICATE_CONTEXT'] } });
    expect(database.state).toMatchObject({ notificationDay: '2026-10-01', notificationsSentToday: 0, recentAnchors: {} });
  });

  it('allows only one concurrent proactive transaction, counter increment and history pointer', async () => {
    const { evaluate, input, database } = setup();
    const context = { ...input, mode: 'real' as const, deliveryMode: 'proactive' as const, location: { ...input.location, source: 'gps' as const } };
    const results = await Promise.allSettled([evaluate({ userId: 'user-1', context }), evaluate({ userId: 'user-1', context })]);
    expect(results.filter(result => result.status === 'fulfilled' && result.value.decision === 'notify')).toHaveLength(1);
    expect(database.state?.notificationsSentToday).toBe(1);
    expect(database.recommendations).toHaveLength(1);
    expect(database.pointers).toHaveLength(1);
  });

  it.each([
    ['2026-03-08T05:00:00.000Z', '2026-03-09T03:59:59.000Z', '2026-03-09T04:00:00.000Z'],
    ['2026-11-01T04:00:00.000Z', '2026-11-02T04:59:59.000Z', '2026-11-02T05:00:00.000Z']
  ])('retains the daily step anchor across a 23/25-hour day from %s', async (start, end, nextDay) => {
    const { evaluate, input, database, setNow } = setup({ ...preferences, timezone: 'America/New_York' });
    const contextAt = (instant: string) => ({ ...input, mode: 'real' as const, deliveryMode: 'proactive' as const, capturedAt: instant,
      location: { ...input.location, source: 'gps' as const, capturedAt: instant } });
    setNow(new Date(start));
    expect((await evaluate({ userId: 'user-1', context: contextAt(start) })).decision).toBe('notify');
    setNow(new Date(end));
    expect(await evaluate({ userId: 'user-1', context: contextAt(end) })).toMatchObject({ decision: 'silent', delivery: { guardCodes: ['RECENT_SAME_TRIGGER'] } });
    setNow(new Date(nextDay));
    expect((await evaluate({ userId: 'user-1', context: contextAt(nextDay) })).decision).toBe('notify');
    expect(database.state?.notificationsSentToday).toBe(1);
    expect(database.recommendations).toHaveLength(2);
  });
});
