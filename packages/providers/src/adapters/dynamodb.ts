import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type {
  GetCommandInput,
  PutCommandInput,
  QueryCommandInput,
  TransactWriteCommandInput,
  UpdateCommandInput
} from '@aws-sdk/lib-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';
import {
  ApiRecommendationItemSchema,
  CalendarDateSchema,
  CalendarEventContextSchema,
  EvaluationResultSchema,
  GeoPointSchema,
  ProfileSchema,
  ProviderPlaceSchema,
  ProviderStatusMapSchema,
  SignalNameSchema,
  TimestampSchema,
  TriggerTypeSchema,
  UrgencySchema,
  UserPreferencesSchema
} from '@contextia/contracts';
import type {
  EvaluationResult,
  Profile,
  ProviderResult,
  UserPreferences
} from '@contextia/contracts';
import { z } from 'zod';
import type {
  ContextReference,
  ContextSnapshot,
  ConversationMessage,
  ConversationRecord,
  DeliveryWriteResult,
  IdempotencyRecord,
  IdempotencyClaim,
  OwnedRead,
  ProactiveDeliveryWrite,
  RecommendationRecord,
  RecommendationWrite,
  StateRepository,
  StorageRecommendationItem,
  UserState
} from '../ports/StateRepository.js';
import type { DeviceRegistration } from '../ports/NotificationProvider.js';
import type { StoragePlace } from '../ports/PlacesProvider.js';
import {
  AdapterTimeoutError,
  available,
  elapsedSince,
  errorName,
  mapAwsError,
  unavailable,
  withTimeout
} from './shared.js';

export type DynamoDbValue = string | number | boolean | null | DynamoDbValue[] | { [key: string]: DynamoDbValue };
export type DynamoDbItem = Record<string, DynamoDbValue> & { PK: string; SK: string };
export interface DynamoDbKey { PK: string; SK: string }
export interface DynamoDbExpressionOptions {
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, DynamoDbValue>;
}
export interface DynamoDbUpdateInput extends DynamoDbExpressionOptions {
  TableName: string;
  Key: DynamoDbKey;
  UpdateExpression: string;
  ConditionExpression?: string;
}
export interface DynamoDbQueryInput extends DynamoDbExpressionOptions {
  TableName: string;
  KeyConditionExpression: string;
  FilterExpression?: string;
  Limit?: number;
  ScanIndexForward?: boolean;
  ConsistentRead?: boolean;
  ExclusiveStartKey?: DynamoDbKey;
}
export type DynamoDbTransactionItem =
  | { Put: { TableName: string; Item: DynamoDbItem; ConditionExpression?: string; ExpressionAttributeNames?: Record<string, string>; ExpressionAttributeValues?: Record<string, DynamoDbValue> } }
  | { Update: DynamoDbUpdateInput }
  | { ConditionCheck: { TableName: string; Key: DynamoDbKey; ConditionExpression: string; ExpressionAttributeNames?: Record<string, string>; ExpressionAttributeValues?: Record<string, DynamoDbValue> } };
export type DynamoDbRequest =
  | { operation: 'get'; input: { TableName: string; Key: DynamoDbKey; ConsistentRead?: boolean } }
  | { operation: 'delete'; input: { TableName: string; Key: DynamoDbKey; ConditionExpression: string } & DynamoDbExpressionOptions }
  | { operation: 'put'; input: { TableName: string; Item: DynamoDbItem; ConditionExpression?: string; ExpressionAttributeNames?: Record<string, string>; ExpressionAttributeValues?: Record<string, DynamoDbValue> } }
  | { operation: 'update'; input: DynamoDbUpdateInput }
  | { operation: 'query'; input: DynamoDbQueryInput }
  | { operation: 'transactWrite'; input: { TransactItems: DynamoDbTransactionItem[]; ClientRequestToken?: string } };

export interface DynamoDbClient {
  send(request: DynamoDbRequest, signal: AbortSignal): Promise<unknown>;
}

export interface DynamoDbStateRepositoryAdapterOptions {
  client: DynamoDbClient;
  tableName: string;
  timeoutMs: number;
}

export interface DynamoDbStateRepositoryConfig {
  region: string;
  tableName: string;
  timeoutMs: number;
}

const UserIdSchema = z.string().min(1).max(256);
const PositiveEpochSchema = z.number().int().nonnegative();
const ContextReferenceSchema = z.strictObject({ evaluationId: z.string().min(1), capturedAt: TimestampSchema });
const LocationSnapshotSchema = GeoPointSchema.extend({ accuracyMeters: z.number().nonnegative().optional() });
const ActivitySnapshotSchema = z.strictObject({
  stepsToday: z.number().int().nonnegative().nullable().optional(),
  confidence: z.enum(['high', 'medium', 'low']).optional()
});
const ContextSnapshotInputSchema = z.strictObject({
  evaluationId: z.string().min(1),
  capturedAt: TimestampSchema,
  mode: z.enum(['real', 'simulation']),
  location: LocationSnapshotSchema,
  activity: ActivitySnapshotSchema.optional(),
  calendar: z.array(CalendarEventContextSchema),
  createdAt: TimestampSchema,
  expiresAt: PositiveEpochSchema
});
const ContextSnapshotOutputSchema = ContextSnapshotInputSchema;
const ContextSnapshotItemSchema = ContextSnapshotOutputSchema.extend({
  PK: z.string(), SK: z.string(), entityType: z.literal('ContextSnapshot'), schemaVersion: z.literal(1)
}).passthrough();
const RecentAnchorsSchema = z.record(z.string(), TimestampSchema).refine(anchors => {
  const entries = Object.entries(anchors);
  return entries.length <= 500 && entries.every(([key]) => {
    const separator = key.indexOf('#');
    return separator > 0 && key.length > separator + 1 && TriggerTypeSchema.safeParse(key.slice(0, separator)).success;
  });
});
const StateItemSchema = z.object({
  PK: z.string(), SK: z.literal('STATE'), entityType: z.literal('UserState'),
  notificationDay: z.iso.date().optional(),
  notificationsSentToday: z.number().int().nonnegative().optional(),
  latestContextEvaluationId: z.string().min(1).optional(),
  latestContextCapturedAt: TimestampSchema.optional(),
  latestContextFingerprint: z.string().min(1).optional(),
  latestContextProcessedAt: TimestampSchema.optional(),
  latestRecommendationAt: TimestampSchema.optional(),
  recentAnchors: RecentAnchorsSchema.optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  schemaVersion: z.literal(1)
}).passthrough().superRefine((state, context) => {
  const hasEvaluation = state.latestContextEvaluationId !== undefined;
  const hasCapturedAt = state.latestContextCapturedAt !== undefined;
  if (hasEvaluation !== hasCapturedAt) context.addIssue({ code: 'custom', path: ['latestContextEvaluationId'], message: 'Context reference must be complete' });
});
const ProfileItemSchema = z.object({
  PK: z.string(), SK: z.literal('PROFILE'), entityType: z.literal('UserProfile'),
  preferences: UserPreferencesSchema, createdAt: TimestampSchema, updatedAt: TimestampSchema, schemaVersion: z.literal(1)
}).passthrough();
const StoredPlaceSchema = z.strictObject({ persistenceIntent: z.literal('storage'), place: ProviderPlaceSchema });
const StorageCardSchema = ApiRecommendationItemSchema.omit({ place: true }).extend({
  place: z.union([StoredPlaceSchema, z.null()]).optional()
});
const RecommendationWriteSchema = z.strictObject({
  id: z.string().min(1), evaluationId: z.string().min(1), contextReference: ContextReferenceSchema,
  createdAt: TimestampSchema, triggerType: TriggerTypeSchema, urgency: UrgencySchema,
  message: z.string().min(1), recommendations: z.array(StorageCardSchema), usedSignals: z.array(SignalNameSchema),
  summaryForDedup: z.string().min(1), providerStatus: ProviderStatusMapSchema, expiresAt: PositiveEpochSchema
}).superRefine((recommendation, context) => {
  if (recommendation.contextReference.evaluationId !== recommendation.evaluationId) {
    context.addIssue({ code: 'custom', path: ['contextReference', 'evaluationId'], message: 'Recommendation must refer to its evaluation' });
  }
  if (recommendation.expiresAt <= Math.floor(Date.parse(recommendation.createdAt) / 1_000)) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Recommendation expiry must follow creation' });
  }
});
const StoredRecommendationItemSchema = z.object({
  PK: z.string(), SK: z.string(), entityType: z.literal('Recommendation'), recommendationId: z.string().min(1),
  evaluationId: z.string().min(1), contextReference: ContextReferenceSchema, createdAt: TimestampSchema,
  triggerType: TriggerTypeSchema, urgency: UrgencySchema, message: z.string().min(1),
  items: z.array(ApiRecommendationItemSchema), usedSignals: z.array(SignalNameSchema),
  summaryForDedup: z.string().min(1), providerStatus: ProviderStatusMapSchema,
  expiresAt: PositiveEpochSchema, schemaVersion: z.literal(1)
}).passthrough();
const RecommendationPointerSchema = z.object({
  PK: z.string(), SK: z.string(), entityType: z.literal('RecommendationRef'), recommendationId: z.string().min(1), evaluationId: z.string().min(1),
  targetSK: z.string().min(1), expiresAt: PositiveEpochSchema, createdAt: TimestampSchema,
  updatedAt: TimestampSchema, deliveryRecordedAt: TimestampSchema.optional(), schemaVersion: z.literal(1)
}).passthrough();
const DeliveryInputSchema = z.strictObject({
  deliveryMode: z.literal('proactive'), evaluationId: z.string().min(1), recommendationId: z.string().min(1),
  notificationDay: z.iso.date(), notificationsEnabled: z.boolean(),
  notificationFrequency: UserPreferencesSchema.shape.notificationFrequency,
  maxDailyNotifications: z.number().int().min(1).max(100),
  contextFingerprint: z.string().min(1).max(256), triggerType: TriggerTypeSchema, anchorKey: z.string().min(1).max(512),
  at: TimestampSchema, contextDedupSeconds: z.number().int().nonnegative().max(86_400),
  anchorDedupSeconds: z.number().int().nonnegative().max(31 * 86_400), maxRecentAnchors: z.number().int().min(1).max(500)
});
const RecommendationRecordSchema = z.strictObject({
  id: z.string().min(1), evaluationId: z.string().min(1), contextReference: ContextReferenceSchema,
  createdAt: TimestampSchema, triggerType: TriggerTypeSchema, urgency: UrgencySchema, message: z.string().min(1),
  recommendations: z.array(ApiRecommendationItemSchema), usedSignals: z.array(SignalNameSchema),
  summaryForDedup: z.string().min(1), providerStatus: ProviderStatusMapSchema, expiresAt: PositiveEpochSchema
});
const CursorSchema = z.strictObject({ PK: z.string(), SK: z.string() });
const QueryResponseSchema = z.object({ Items: z.array(z.unknown()).optional(), LastEvaluatedKey: z.unknown().optional() }).passthrough();
const IdempotencyRecordSchema = z.strictObject({
  key: z.uuid(), claimId: z.uuid(), requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  responsePointer: z.string().min(1).nullable(), createdAt: TimestampSchema, expiresAt: PositiveEpochSchema
});
const IdempotencyItemSchema = IdempotencyRecordSchema.extend({
  PK: z.string(), SK: z.string(), entityType: z.literal('Idempotency'), updatedAt: TimestampSchema, schemaVersion: z.literal(1)
});
const EvaluationItemSchema = z.strictObject({
  PK: z.string(), SK: z.string(), entityType: z.literal('EvaluationResult'), result: EvaluationResultSchema,
  expiresAt: PositiveEpochSchema, createdAt: TimestampSchema, updatedAt: TimestampSchema, schemaVersion: z.literal(1)
});
const IdempotencyOwnerSchema = z.strictObject({
  userId: UserIdSchema, key: z.uuid(), claimId: z.uuid(), requestHash: z.string().regex(/^[a-f0-9]{64}$/)
});
const ConversationItemSchema = z.object({
  PK: z.string(), SK: z.literal('CONVERSATION'), entityType: z.literal('Conversation'),
  userId: UserIdSchema, recommendationId: z.string().min(1), conversationId: z.string().min(1),
  turnCount: z.number().int().min(1).max(8), expiresAt: PositiveEpochSchema,
  createdAt: TimestampSchema, updatedAt: TimestampSchema, schemaVersion: z.literal(1)
}).passthrough();
const ChatMessageBaseSchema = z.object({
  PK: z.string(), SK: z.string(), entityType: z.literal('ChatMessage'),
  userId: UserIdSchema, recommendationId: z.string().min(1), conversationId: z.string().min(1),
  messageId: z.string().min(1), content: z.string().min(1), expiresAt: PositiveEpochSchema,
  createdAt: TimestampSchema, updatedAt: TimestampSchema, schemaVersion: z.literal(1)
});
const ChatMessageItemSchema = z.discriminatedUnion('role', [
  ChatMessageBaseSchema.extend({ role: z.literal('user') }),
  ChatMessageBaseSchema.extend({ role: z.literal('assistant'), recommendations: z.array(StorageCardSchema).max(3) })
]);
const ConversationOwnerSchema = z.strictObject({
  userId: UserIdSchema, recommendationId: z.string().min(1), nowEpochSeconds: PositiveEpochSchema
});
const AppendConversationSchema = ConversationOwnerSchema.extend({
  conversationId: z.string().min(1), messageId: z.string().min(1),
  userMessage: z.string().min(1).max(1000), reply: z.string().min(1).max(4000),
  recommendations: z.array(StorageCardSchema).max(3), at: TimestampSchema,
  expiresAt: PositiveEpochSchema, maxUserTurns: z.number().int().min(1).max(8)
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function itemFromResponse(response: unknown): unknown {
  return isRecord(response) ? response.Item : undefined;
}

function mapRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function toDynamoValue(value: unknown): DynamoDbValue | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    const result: DynamoDbValue[] = [];
    for (const child of value) {
      const converted = toDynamoValue(child);
      if (converted === null && child !== null) return null;
      result.push(converted);
    }
    return result;
  }
  if (isRecord(value)) {
    const result: Record<string, DynamoDbValue> = {};
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) continue;
      const converted = toDynamoValue(child);
      if (converted === null && child !== null) return null;
      result[key] = converted;
    }
    return result;
  }
  return null;
}

function toDynamoItem(value: Record<string, unknown>): DynamoDbItem | null {
  const converted = toDynamoValue(value);
  if (!isRecord(converted) || typeof converted.PK !== 'string' || typeof converted.SK !== 'string') return null;
  return converted as DynamoDbItem;
}

function toDynamoExpressionValue(value: unknown): DynamoDbValue {
  const converted = toDynamoValue(value);
  if (converted === null && value !== null) throw new Error('Unsupported DynamoDB value');
  return converted;
}

function userKey(userId: string): string {
  return `USER#${userId}`;
}

function canonicalTimestamp(value: string): string {
  return new Date(Date.parse(value)).toISOString();
}

function contextSortKey(reference: ContextReference): string {
  return `CONTEXT#${canonicalTimestamp(reference.capturedAt)}#${reference.evaluationId}`;
}

function recommendationSortKey(recommendation: Pick<RecommendationWrite, 'createdAt' | 'id'>): string {
  return `RECOMMENDATION#${canonicalTimestamp(recommendation.createdAt)}#${recommendation.id}`;
}

function chatSortKey(conversationId: string, at: string, messageId: string, role: 'user' | 'assistant'): string {
  return `CHAT#${conversationId}#${canonicalTimestamp(at)}#${messageId}#${role === 'user' ? '0' : '1'}`;
}

function invalidRequest<T>(): ProviderResult<T> {
  return { status: 'error', data: null, code: 'INVALID_REQUEST' };
}

function invalidStoredData<T>(): ProviderResult<T> {
  return { status: 'error', data: null, code: 'INVALID_STORED_DATA' };
}

function notImplemented<T>(): ProviderResult<T> {
  return { status: 'error', data: null, code: 'NOT_IMPLEMENTED' };
}

function mapFailure<T>(error: unknown, latencyMs: number, transactionCode = 'UPSTREAM_ERROR'): ProviderResult<T> {
  if (errorName(error) === 'TransactionCanceledException' || errorName(error) === 'ConditionalCheckFailedException') {
    return unavailable('error', latencyMs, transactionCode);
  }
  const mapped = error instanceof AdapterTimeoutError
    ? { status: 'timeout' as const, code: 'TIMEOUT' }
    : mapAwsError(error);
  return unavailable(mapped.status, latencyMs, mapped.code);
}

function sdkBackedClient(client: DynamoDBDocumentClient): DynamoDbClient {
  return {
    send: (request, signal) => {
      switch (request.operation) {
        case 'get': {
          const input: GetCommandInput = { ...request.input };
          return client.send(new GetCommand(input), { abortSignal: signal });
        }
        case 'delete': return client.send(new DeleteCommand(request.input), { abortSignal: signal });
        case 'put': {
          const input: PutCommandInput = { ...request.input };
          return client.send(new PutCommand(input), { abortSignal: signal });
        }
        case 'update': {
          const input: UpdateCommandInput = { ...request.input };
          return client.send(new UpdateCommand(input), { abortSignal: signal });
        }
        case 'query': {
          const input: QueryCommandInput = { ...request.input };
          return client.send(new QueryCommand(input), { abortSignal: signal });
        }
        case 'transactWrite': {
          const input: TransactWriteCommandInput = { ...request.input };
          return client.send(new TransactWriteCommand(input), { abortSignal: signal });
        }
      }
    }
  };
}

function normalizeState(input: z.infer<typeof StateItemSchema>): UserState {
  const latestContext = input.latestContextEvaluationId !== undefined && input.latestContextCapturedAt !== undefined
    ? { evaluationId: input.latestContextEvaluationId, capturedAt: input.latestContextCapturedAt }
    : undefined;
  return {
    notificationDay: input.notificationDay ?? '',
    notificationsSentToday: input.notificationsSentToday ?? 0,
    ...(latestContext === undefined ? {} : { latestContext }),
    ...(input.latestContextFingerprint === undefined ? {} : { latestContextFingerprint: input.latestContextFingerprint }),
    ...(input.latestContextProcessedAt === undefined ? {} : { latestContextProcessedAt: input.latestContextProcessedAt }),
    ...(input.latestRecommendationAt === undefined ? {} : { latestRecommendationAt: input.latestRecommendationAt }),
    recentAnchors: Object.entries(input.recentAnchors ?? {}).flatMap(([key, notifiedAt]) => {
      const separator = key.indexOf('#');
      if (separator <= 0) return [];
      const parsedType = TriggerTypeSchema.safeParse(key.slice(0, separator));
      return parsedType.success ? [{ triggerType: parsedType.data, anchorKey: key.slice(separator + 1), notifiedAt }] : [];
    })
  };
}

function toProfile(userId: string, raw: unknown): Profile | null {
  const record = mapRecord(raw);
  if (record === null) return null;
  const item = ProfileItemSchema.safeParse(record);
  if (!item.success || item.data.PK !== userKey(userId) || item.data.SK !== 'PROFILE') return null;
  const profile = ProfileSchema.safeParse({ userId, preferences: item.data.preferences });
  return profile.success ? profile.data : null;
}

function toSnapshot(raw: unknown, expectedPK: string, expectedSK: string): ContextSnapshot | null {
  const record = mapRecord(raw);
  if (record === null) return null;
  const parsed = ContextSnapshotItemSchema.safeParse(record);
  if (!parsed.success || parsed.data.PK !== expectedPK || parsed.data.SK !== expectedSK) return null;
  const value = parsed.data;
  return {
    evaluationId: value.evaluationId,
    capturedAt: value.capturedAt,
    mode: value.mode,
    location: {
      latitude: value.location.latitude,
      longitude: value.location.longitude,
      ...(value.location.accuracyMeters === undefined ? {} : { accuracyMeters: value.location.accuracyMeters })
    },
    ...(value.activity === undefined ? {} : { activity: {
      ...(value.activity.stepsToday === undefined ? {} : { stepsToday: value.activity.stepsToday }),
      ...(value.activity.confidence === undefined ? {} : { confidence: value.activity.confidence })
    } }),
    calendar: value.calendar,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt
  };
}

function projectStorageRecommendations(items: readonly unknown[]): ApiRecommendationItemSchemaType[] | null {
  const projected: ApiRecommendationItemSchemaType[] = [];
  for (const item of items) {
    const parsedItem = StorageCardSchema.safeParse(item);
    if (!parsedItem.success) return null;
    const { place, ...fields } = parsedItem.data;
    const candidate: Record<string, unknown> = { ...fields };
    if (place === null) candidate.place = null;
    else if (place !== undefined) {
      const providerPlace = ProviderPlaceSchema.safeParse(place.place);
      if (!providerPlace.success) return null;
      const { provider, placeId, name, latitude, longitude, distanceMeters } = providerPlace.data;
      candidate.place = {
        provider, placeId, name, latitude, longitude,
        ...(distanceMeters === undefined ? {} : { distanceMeters })
      };
    }
    const normalized = ApiRecommendationItemSchema.safeParse(candidate);
    if (!normalized.success) return null;
    projected.push(normalized.data);
  }
  return projected;
}

function recommendationItems(
  userId: string,
  recommendation: z.infer<typeof RecommendationWriteSchema>,
  deliveryAt?: string
): { targetItem: DynamoDbItem; pointerItem: DynamoDbItem } | null {
  const projectedRecommendations = projectStorageRecommendations(recommendation.recommendations as StorageRecommendationItem[]);
  if (projectedRecommendations === null) return null;
  const targetSK = recommendationSortKey(recommendation);
  const createdAt = recommendation.createdAt;
  const targetItem = toDynamoItem({
    PK: userKey(userId), SK: targetSK, entityType: 'Recommendation',
    recommendationId: recommendation.id, evaluationId: recommendation.evaluationId,
    contextReference: recommendation.contextReference, createdAt, triggerType: recommendation.triggerType,
    urgency: recommendation.urgency, message: recommendation.message, items: projectedRecommendations,
    usedSignals: recommendation.usedSignals, summaryForDedup: recommendation.summaryForDedup,
    providerStatus: recommendation.providerStatus,
    ...(recommendation.recommendations.some(item => item.place != null) ? { providerRefs: { placesPersistenceIntent: 'storage' } } : {}),
    expiresAt: recommendation.expiresAt, updatedAt: createdAt, schemaVersion: 1
  });
  const canonicalDeliveryAt = deliveryAt === undefined ? undefined : canonicalTimestamp(deliveryAt);
  const pointerItem = toDynamoItem({
    PK: userKey(userId), SK: `RECOMMENDATION_REF#${recommendation.id}`, entityType: 'RecommendationRef',
    recommendationId: recommendation.id, evaluationId: recommendation.evaluationId, targetSK, expiresAt: recommendation.expiresAt,
    createdAt, updatedAt: canonicalDeliveryAt ?? createdAt,
    ...(canonicalDeliveryAt === undefined ? {} : { deliveryRecordedAt: canonicalDeliveryAt }), schemaVersion: 1
  });
  return targetItem === null || pointerItem === null ? null : { targetItem, pointerItem };
}

type ApiRecommendationItemSchemaType = z.infer<typeof ApiRecommendationItemSchema>;

function toRecommendation(raw: unknown, expectedUserId?: string): RecommendationRecord | null {
  const record = mapRecord(raw);
  if (record === null) return null;
  const stored = StoredRecommendationItemSchema.safeParse(record);
  if (!stored.success || (expectedUserId !== undefined && stored.data.PK !== userKey(expectedUserId))) return null;
  if (stored.data.SK !== recommendationSortKey({ id: stored.data.recommendationId, createdAt: stored.data.createdAt })) return null;
  const candidate: unknown = {
    id: stored.data.recommendationId,
    evaluationId: stored.data.evaluationId,
    contextReference: stored.data.contextReference,
    createdAt: stored.data.createdAt,
    triggerType: stored.data.triggerType,
    urgency: stored.data.urgency,
    message: stored.data.message,
    recommendations: stored.data.items,
    usedSignals: stored.data.usedSignals,
    summaryForDedup: stored.data.summaryForDedup,
    providerStatus: stored.data.providerStatus,
    expiresAt: stored.data.expiresAt
  };
  const normalized = RecommendationRecordSchema.safeParse(candidate);
  return normalized.success ? normalized.data : null;
}

function itemFromQuery(raw: unknown, nowEpochSeconds: number, expectedUserId: string): RecommendationRecord | 'expired' | null {
  const record = mapRecord(raw);
  if (record === null) return null;
  const expiresAt = record.expiresAt;
  if (typeof expiresAt === 'number' && expiresAt <= nowEpochSeconds) return 'expired';
  return toRecommendation(record, expectedUserId);
}

function encodeCursor(key: DynamoDbKey): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

function decodeCursor(cursor: string, userId: string): DynamoDbKey | null {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const parsed = CursorSchema.safeParse(decoded);
    if (!parsed.success || parsed.data.PK !== userKey(userId) || !parsed.data.SK.startsWith('RECOMMENDATION#')) return null;
    return { PK: parsed.data.PK, SK: parsed.data.SK };
  } catch {
    return null;
  }
}

function localDateFor(timestamp: string, timezone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(timestamp));
    const values = new Map(parts.map(part => [part.type, part.value]));
    const year = values.get('year');
    const month = values.get('month');
    const day = values.get('day');
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

function anchorMapKey(triggerType: string, anchorKey: string): string {
  return `${triggerType}#${anchorKey}`;
}

function deliveryGuards(
  state: z.infer<typeof StateItemSchema>,
  delivery: z.infer<typeof DeliveryInputSchema>
): Array<'DAILY_CAP_REACHED' | 'DUPLICATE_CONTEXT' | 'RECENT_SAME_TRIGGER'> {
  const guards: Array<'DAILY_CAP_REACHED' | 'DUPLICATE_CONTEXT' | 'RECENT_SAME_TRIGGER'> = [];
  if (state.notificationDay === delivery.notificationDay
    && (state.notificationsSentToday ?? 0) >= delivery.maxDailyNotifications) {
    guards.push('DAILY_CAP_REACHED');
  }
  const evaluationMatches = state.latestContextEvaluationId === delivery.evaluationId;
  if (!evaluationMatches && state.latestContextFingerprint === delivery.contextFingerprint
    && state.latestContextProcessedAt !== undefined
    && Date.parse(state.latestContextProcessedAt) > Date.parse(delivery.at) - delivery.contextDedupSeconds * 1_000) {
    guards.push('DUPLICATE_CONTEXT');
  }
  const previousAnchorAt = state.recentAnchors?.[anchorMapKey(delivery.triggerType, delivery.anchorKey)];
  if (previousAnchorAt !== undefined
    && Date.parse(previousAnchorAt) > Date.parse(delivery.at) - delivery.anchorDedupSeconds * 1_000) {
    guards.push('RECENT_SAME_TRIGGER');
  }
  return guards;
}

function anchorKeysToPrune(
  state: z.infer<typeof StateItemSchema>,
  newAnchor: string,
  at: string,
  max: number
): string[] {
  const anchors = Object.entries(state.recentAnchors ?? {})
    .filter(([key]) => key !== newAnchor)
    .map(([key, notifiedAt]) => ({ key, notifiedAt }));
  anchors.push({ key: newAnchor, notifiedAt: at });
  anchors.sort((left, right) => Date.parse(left.notifiedAt) - Date.parse(right.notifiedAt));
  return anchors.slice(0, Math.max(0, anchors.length - max)).map(anchor => anchor.key).filter(key => key !== newAnchor);
}

function proactiveDeliveryStateUpdate(
  tableName: string,
  pk: string,
  state: z.infer<typeof StateItemSchema>,
  delivery: z.infer<typeof DeliveryInputSchema>
): DynamoDbUpdateInput {
  const sameDay = state.notificationDay === delivery.notificationDay;
  const currentAnchor = anchorMapKey(delivery.triggerType, delivery.anchorKey);
  const pruneKeys = anchorKeysToPrune(state, currentAnchor, canonicalTimestamp(delivery.at), delivery.maxRecentAnchors);
  const names: Record<string, string> = {
    '#notificationDay': 'notificationDay', '#notificationsSentToday': 'notificationsSentToday',
    '#latestContextEvaluationId': 'latestContextEvaluationId', '#latestContextFingerprint': 'latestContextFingerprint',
    '#recentAnchors': 'recentAnchors', '#anchor': currentAnchor, '#latestRecommendationAt': 'latestRecommendationAt',
    '#updatedAt': 'updatedAt'
  };
  const values: Record<string, DynamoDbValue> = {
    ':day': delivery.notificationDay, ':evaluationId': delivery.evaluationId, ':fingerprint': delivery.contextFingerprint,
    ':at': canonicalTimestamp(delivery.at), ':one': 1,
    ':anchorCutoff': new Date(Date.parse(delivery.at) - delivery.anchorDedupSeconds * 1_000).toISOString()
  };
  if (sameDay) {
    values[':zero'] = 0;
    values[':max'] = delivery.maxDailyNotifications;
  }
  const removePaths = pruneKeys.map((key, index) => {
    const name = `#prune${index}`;
    names[name] = key;
    return `#recentAnchors.${name}`;
  });
  const dayCondition = sameDay
    ? '#notificationDay = :day AND (attribute_not_exists(#notificationsSentToday) OR #notificationsSentToday < :max)'
    : '(attribute_not_exists(#notificationDay) OR #notificationDay <> :day)';
  const updateExpression = `${sameDay
    ? 'SET #notificationsSentToday = if_not_exists(#notificationsSentToday, :zero) + :one'
    : 'SET #notificationDay = :day, #notificationsSentToday = :one'}, #recentAnchors.#anchor = :at, #latestRecommendationAt = :at, #updatedAt = :at${removePaths.length > 0 ? ` REMOVE ${removePaths.join(', ')}` : ''}`;
  return {
    TableName: tableName,
    Key: { PK: pk, SK: 'STATE' },
    UpdateExpression: updateExpression,
    ConditionExpression: `#latestContextEvaluationId = :evaluationId AND #latestContextFingerprint = :fingerprint AND ${dayCondition} AND (attribute_not_exists(#recentAnchors.#anchor) OR #recentAnchors.#anchor <= :anchorCutoff)`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values
  };
}

export class DynamoDbStateRepository implements StateRepository {
  private readonly client: DynamoDbClient;
  private readonly tableName: string;
  private readonly timeoutMs: number;

  constructor(options: DynamoDbStateRepositoryAdapterOptions) {
    if (options.tableName.trim().length === 0) throw new Error('DynamoDB table name is required');
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('Invalid provider timeout');
    this.client = options.client;
    this.tableName = options.tableName;
    this.timeoutMs = options.timeoutMs;
  }

  private send(request: DynamoDbRequest): Promise<unknown> {
    return withTimeout(signal => this.client.send(request, signal), this.timeoutMs);
  }

  async getProfile(input: { userId: string }): Promise<ProviderResult<Profile | null>> {
    const startedAt = performance.now();
    const parsed = z.strictObject({ userId: UserIdSchema }).safeParse(input);
    if (!parsed.success) return invalidRequest();
    try {
      const response = await this.send({ operation: 'get', input: {
        TableName: this.tableName, Key: { PK: userKey(parsed.data.userId), SK: 'PROFILE' }, ConsistentRead: true
      } });
      const raw = itemFromResponse(response);
      if (raw === undefined) return available('ok', null, elapsedSince(startedAt));
      const profile = toProfile(parsed.data.userId, raw);
      return profile === null
        ? invalidStoredData()
        : available('ok', profile, elapsedSince(startedAt));
    } catch (error: unknown) {
      return mapFailure(error, elapsedSince(startedAt));
    }
  }

  async putPreferences(input: { userId: string; preferences: UserPreferences; at: string }): Promise<ProviderResult<null>> {
    const startedAt = performance.now();
    const parsed = z.strictObject({ userId: UserIdSchema, preferences: UserPreferencesSchema, at: TimestampSchema }).safeParse(input);
    if (!parsed.success) return invalidRequest();
    try {
      await this.send({ operation: 'update', input: {
        TableName: this.tableName,
        Key: { PK: userKey(parsed.data.userId), SK: 'PROFILE' },
        UpdateExpression: 'SET #entityType = :entityType, #preferences = :preferences, #createdAt = if_not_exists(#createdAt, :at), #updatedAt = :at, #schemaVersion = :schemaVersion',
        ExpressionAttributeNames: {
          '#entityType': 'entityType', '#preferences': 'preferences', '#createdAt': 'createdAt',
          '#updatedAt': 'updatedAt', '#schemaVersion': 'schemaVersion'
        },
        ExpressionAttributeValues: {
          ':entityType': 'UserProfile', ':preferences': toDynamoExpressionValue(parsed.data.preferences),
          ':at': parsed.data.at, ':schemaVersion': 1
        }
      } });
      return available('ok', null, elapsedSince(startedAt));
    } catch (error: unknown) {
      return mapFailure(error, elapsedSince(startedAt));
    }
  }

  async getState(input: OwnedRead): Promise<ProviderResult<UserState | null>> {
    const startedAt = performance.now();
    const parsed = z.strictObject({ userId: UserIdSchema, nowEpochSeconds: PositiveEpochSchema }).safeParse(input);
    if (!parsed.success) return invalidRequest();
    try {
      const response = await this.send({ operation: 'get', input: {
        TableName: this.tableName, Key: { PK: userKey(parsed.data.userId), SK: 'STATE' }, ConsistentRead: true
      } });
      const raw = itemFromResponse(response);
      if (raw === undefined) return available('ok', null, elapsedSince(startedAt));
      const rawRecord = mapRecord(raw);
      if (rawRecord === null || rawRecord.PK !== userKey(parsed.data.userId)) return invalidStoredData();
      const stored = StateItemSchema.safeParse(raw);
      if (!stored.success) return invalidStoredData();
      return available('ok', normalizeState(stored.data), elapsedSince(startedAt));
    } catch (error: unknown) {
      return mapFailure(error, elapsedSince(startedAt));
    }
  }

  async writeContextSnapshot(input: { userId: string; snapshot: ContextSnapshot; fingerprint: string; processedAt: string; notificationDay: string }): Promise<ProviderResult<null>> {
    const startedAt = performance.now();
    const parsed = z.strictObject({
      userId: UserIdSchema, snapshot: ContextSnapshotInputSchema, fingerprint: z.string().min(1).max(256),
      processedAt: TimestampSchema, notificationDay: CalendarDateSchema
    }).safeParse(input);
    if (!parsed.success) return invalidRequest();
    const { userId, fingerprint, processedAt, notificationDay } = parsed.data;
    const context = parsed.data.snapshot;
    const expiresAt = Math.floor(Date.parse(processedAt) / 1_000) + 86_400;
    const snapshotItem = toDynamoItem({
      PK: userKey(userId), SK: contextSortKey(context), entityType: 'ContextSnapshot',
      evaluationId: context.evaluationId, mode: context.mode, capturedAt: context.capturedAt,
      location: context.location, ...(context.activity === undefined ? {} : { activity: context.activity }),
      calendar: context.calendar, createdAt: processedAt, expiresAt, schemaVersion: 1
    });
    if (snapshotItem === null) return invalidRequest();
    const updateNames: Record<string, string> = {
      '#entityType': 'entityType', '#latestContextEvaluationId': 'latestContextEvaluationId',
      '#latestContextCapturedAt': 'latestContextCapturedAt', '#latestContextFingerprint': 'latestContextFingerprint',
      '#latestContextProcessedAt': 'latestContextProcessedAt', '#notificationDay': 'notificationDay',
      '#notificationsSentToday': 'notificationsSentToday', '#recentAnchors': 'recentAnchors', '#createdAt': 'createdAt',
      '#updatedAt': 'updatedAt', '#schemaVersion': 'schemaVersion'
    };
    const updateValues: Record<string, DynamoDbValue> = {
      ':entityType': 'UserState', ':evaluationId': context.evaluationId, ':capturedAt': context.capturedAt,
      ':fingerprint': fingerprint, ':processedAt': processedAt, ':notificationDay': notificationDay,
      ':zero': 0, ':emptyMap': {}, ':schemaVersion': 1
    };
    const updateExpression = [
      'SET #entityType = :entityType',
      '#latestContextEvaluationId = :evaluationId',
      '#latestContextCapturedAt = :capturedAt',
      '#latestContextFingerprint = :fingerprint',
      '#latestContextProcessedAt = :processedAt',
      '#notificationDay = if_not_exists(#notificationDay, :notificationDay)',
      '#notificationsSentToday = if_not_exists(#notificationsSentToday, :zero)',
      '#recentAnchors = if_not_exists(#recentAnchors, :emptyMap)',
      '#createdAt = if_not_exists(#createdAt, :processedAt)',
      '#updatedAt = :processedAt',
      '#schemaVersion = :schemaVersion'
    ].join(', ');
    try {
      await this.send({ operation: 'transactWrite', input: { TransactItems: [
        { Put: { TableName: this.tableName, Item: snapshotItem } },
        { Update: {
          TableName: this.tableName,
          Key: { PK: userKey(userId), SK: 'STATE' },
          UpdateExpression: updateExpression,
          ExpressionAttributeNames: updateNames,
          ExpressionAttributeValues: updateValues
        } }
      ] } });
      return available('ok', null, elapsedSince(startedAt));
    } catch (error: unknown) {
      return mapFailure(error, elapsedSince(startedAt), 'SNAPSHOT_WRITE_CONFLICT');
    }
  }

  async getContextSnapshot(input: OwnedRead & { reference: ContextReference }): Promise<ProviderResult<ContextSnapshot | null>> {
    const startedAt = performance.now();
    const parsed = z.strictObject({ userId: UserIdSchema, nowEpochSeconds: PositiveEpochSchema, reference: ContextReferenceSchema }).safeParse(input);
    if (!parsed.success) return invalidRequest();
    try {
      const response = await this.send({ operation: 'get', input: {
        TableName: this.tableName,
        Key: { PK: userKey(parsed.data.userId), SK: contextSortKey(parsed.data.reference) },
        ConsistentRead: true
      } });
      const raw = itemFromResponse(response);
      if (raw === undefined) return available('ok', null, elapsedSince(startedAt));
      const rawRecord = mapRecord(raw);
      if (rawRecord === null) return invalidStoredData();
      if (typeof rawRecord.expiresAt === 'number' && rawRecord.expiresAt <= parsed.data.nowEpochSeconds) {
        return available('ok', null, elapsedSince(startedAt));
      }
      const expectedSK = contextSortKey(parsed.data.reference);
      const snapshot = toSnapshot(raw, userKey(parsed.data.userId), expectedSK);
      if (snapshot === null) return invalidStoredData();
      if (snapshot.evaluationId !== parsed.data.reference.evaluationId
        || Date.parse(snapshot.capturedAt) !== Date.parse(parsed.data.reference.capturedAt)
        || snapshot.expiresAt <= parsed.data.nowEpochSeconds) {
        return available('ok', null, elapsedSince(startedAt));
      }
      return available('ok', snapshot, elapsedSince(startedAt));
    } catch (error: unknown) {
      return mapFailure(error, elapsedSince(startedAt));
    }
  }

  async writeRecommendation(input: { userId: string; recommendation: RecommendationWrite }): Promise<ProviderResult<null>> {
    const startedAt = performance.now();
    const parsed = z.strictObject({ userId: UserIdSchema, recommendation: RecommendationWriteSchema }).safeParse(input);
    if (!parsed.success) return invalidRequest();
    const recommendation = parsed.data.recommendation;
    const items = recommendationItems(parsed.data.userId, recommendation);
    if (items === null) return invalidRequest();
    try {
      await this.send({ operation: 'transactWrite', input: { TransactItems: [
        { Put: { TableName: this.tableName, Item: items.targetItem, ConditionExpression: 'attribute_not_exists(PK)' } },
        { Put: { TableName: this.tableName, Item: items.pointerItem, ConditionExpression: 'attribute_not_exists(PK)' } }
      ] } });
      return available('ok', null, elapsedSince(startedAt));
    } catch (error: unknown) {
      return mapFailure(error, elapsedSince(startedAt), 'WRITE_CONFLICT');
    }
  }

  async commitProactiveRecommendation(input: {
    userId: string; recommendation: RecommendationWrite; delivery: ProactiveDeliveryWrite
  }): Promise<ProviderResult<DeliveryWriteResult>> {
    const startedAt = performance.now();
    const parsed = z.strictObject({
      userId: UserIdSchema, recommendation: RecommendationWriteSchema, delivery: DeliveryInputSchema
    }).safeParse(input);
    if (!parsed.success) return invalidRequest();
    const { recommendation, delivery } = parsed.data;
    if (recommendation.id !== delivery.recommendationId || recommendation.evaluationId !== delivery.evaluationId
      || recommendation.triggerType !== delivery.triggerType) return invalidRequest();
    if (!delivery.notificationsEnabled) {
      return available('ok', { recorded: false, guardCodes: ['NOTIFICATIONS_DISABLED'] }, elapsedSince(startedAt));
    }
    const items = recommendationItems(parsed.data.userId, recommendation, delivery.at);
    if (items === null) return invalidRequest();
    const pk = userKey(parsed.data.userId);
    try {
      const profileResponse = await this.send({ operation: 'get', input: {
        TableName: this.tableName, Key: { PK: pk, SK: 'PROFILE' }, ConsistentRead: true
      } });
      const rawProfile = itemFromResponse(profileResponse);
      if (rawProfile === undefined) return unavailable('error', elapsedSince(startedAt), 'PROFILE_NOT_FOUND');
      const profile = toProfile(parsed.data.userId, rawProfile);
      if (profile === null) return invalidStoredData();
      if (!profile.preferences.notificationsEnabled) {
        return available('ok', { recorded: false, guardCodes: ['NOTIFICATIONS_DISABLED'] }, elapsedSince(startedAt));
      }
      if (profile.preferences.notificationFrequency !== delivery.notificationFrequency) {
        return available('ok', { recorded: false, guardCodes: [], reason: 'superseded' }, elapsedSince(startedAt));
      }
      if (localDateFor(delivery.at, profile.preferences.timezone) !== delivery.notificationDay) return invalidRequest();

      const stateResponse = await this.send({ operation: 'get', input: {
        TableName: this.tableName, Key: { PK: pk, SK: 'STATE' }, ConsistentRead: true
      } });
      const rawState = itemFromResponse(stateResponse);
      if (rawState === undefined) return unavailable('error', elapsedSince(startedAt), 'STATE_NOT_FOUND');
      const parsedState = StateItemSchema.safeParse(rawState);
      if (!parsedState.success) return invalidStoredData();
      const state = parsedState.data;
      const guards = deliveryGuards(state, delivery);
      if (guards.length > 0) return available('ok', { recorded: false, guardCodes: guards }, elapsedSince(startedAt));
      if (state.latestContextEvaluationId !== delivery.evaluationId || state.latestContextFingerprint !== delivery.contextFingerprint) {
        return available('ok', { recorded: false, guardCodes: [], reason: 'superseded' }, elapsedSince(startedAt));
      }

      const stateUpdate = proactiveDeliveryStateUpdate(this.tableName, pk, state, delivery);
      await this.send({ operation: 'transactWrite', input: { TransactItems: [
        { ConditionCheck: {
          TableName: this.tableName, Key: { PK: pk, SK: 'PROFILE' },
          ConditionExpression: '#preferences.#notificationsEnabled = :enabled AND #preferences.#timezone = :timezone AND #preferences.#notificationFrequency = :frequency',
          ExpressionAttributeNames: {
            '#preferences': 'preferences', '#notificationsEnabled': 'notificationsEnabled', '#timezone': 'timezone',
            '#notificationFrequency': 'notificationFrequency'
          },
          ExpressionAttributeValues: { ':enabled': true, ':timezone': profile.preferences.timezone, ':frequency': delivery.notificationFrequency }
        } },
        { Update: stateUpdate },
        { Put: { TableName: this.tableName, Item: items.targetItem, ConditionExpression: 'attribute_not_exists(PK)' } },
        { Put: { TableName: this.tableName, Item: items.pointerItem, ConditionExpression: 'attribute_not_exists(PK)' } }
      ] } });
      return available('ok', { recorded: true }, elapsedSince(startedAt));
    } catch (error: unknown) {
      const reasons = isRecord(error) && Array.isArray(error.CancellationReasons) ? error.CancellationReasons : [];
      const conditionalRace = errorName(error) === 'ConditionalCheckFailedException'
        || (errorName(error) === 'TransactionCanceledException'
          && reasons.some(reason => isRecord(reason) && reason.Code === 'ConditionalCheckFailed')
          && reasons.every(reason => isRecord(reason) && (reason.Code === 'None' || reason.Code === 'ConditionalCheckFailed')));
      if (conditionalRace) {
        return available('ok', { recorded: false, guardCodes: [], reason: 'superseded' }, elapsedSince(startedAt));
      }
      return mapFailure(error, elapsedSince(startedAt));
    }
  }

  async getRecommendation(input: OwnedRead & { recommendationId: string }): Promise<ProviderResult<RecommendationRecord | null>> {
    const startedAt = performance.now();
    const parsed = z.strictObject({ userId: UserIdSchema, nowEpochSeconds: PositiveEpochSchema, recommendationId: z.string().min(1) }).safeParse(input);
    if (!parsed.success) return invalidRequest();
    try {
      const pointerResponse = await this.send({ operation: 'get', input: {
        TableName: this.tableName,
        Key: { PK: userKey(parsed.data.userId), SK: `RECOMMENDATION_REF#${parsed.data.recommendationId}` },
        ConsistentRead: true
      } });
      const rawPointer = itemFromResponse(pointerResponse);
      if (rawPointer === undefined) return available('ok', null, elapsedSince(startedAt));
      const pointerRecord = mapRecord(rawPointer);
      if (pointerRecord === null) return invalidStoredData();
      if (typeof pointerRecord.expiresAt === 'number' && pointerRecord.expiresAt <= parsed.data.nowEpochSeconds) {
        return available('ok', null, elapsedSince(startedAt));
      }
      const pointer = RecommendationPointerSchema.safeParse(rawPointer);
      if (!pointer.success || pointer.data.PK !== userKey(parsed.data.userId)
        || pointer.data.SK !== `RECOMMENDATION_REF#${parsed.data.recommendationId}`) return invalidStoredData();
      if (pointer.data.recommendationId !== parsed.data.recommendationId
        || !pointer.data.targetSK.startsWith('RECOMMENDATION#')
        || !pointer.data.targetSK.endsWith(`#${parsed.data.recommendationId}`)) {
        return available('ok', null, elapsedSince(startedAt));
      }
      const response = await this.send({ operation: 'get', input: {
        TableName: this.tableName, Key: { PK: userKey(parsed.data.userId), SK: pointer.data.targetSK }, ConsistentRead: true
      } });
      const raw = itemFromResponse(response);
      if (raw === undefined) return available('ok', null, elapsedSince(startedAt));
      const rawRecord = mapRecord(raw);
      if (rawRecord === null) return invalidStoredData();
      if (typeof rawRecord.expiresAt === 'number' && rawRecord.expiresAt <= parsed.data.nowEpochSeconds) {
        return available('ok', null, elapsedSince(startedAt));
      }
      const record = toRecommendation(raw, parsed.data.userId);
      if (record === null) return invalidStoredData();
      if (record.id !== parsed.data.recommendationId || record.evaluationId !== pointer.data.evaluationId
        || record.expiresAt !== pointer.data.expiresAt) return invalidStoredData();
      if (record.expiresAt <= parsed.data.nowEpochSeconds) {
        return available('ok', null, elapsedSince(startedAt));
      }
      return available('ok', record, elapsedSince(startedAt));
    } catch (error: unknown) {
      return mapFailure(error, elapsedSince(startedAt));
    }
  }

  async listRecommendations(input: OwnedRead & { limit: number; cursor?: string }): Promise<ProviderResult<{ items: RecommendationRecord[]; nextCursor: string | null }>> {
    const startedAt = performance.now();
    const parsed = z.strictObject({
      userId: UserIdSchema, nowEpochSeconds: PositiveEpochSchema,
      limit: z.number().int().min(1).max(50), cursor: z.string().min(1).max(2_048).optional()
    }).safeParse(input);
    if (!parsed.success) return invalidRequest();
    const decodedStartKey = parsed.data.cursor === undefined ? undefined : decodeCursor(parsed.data.cursor, parsed.data.userId);
    if (parsed.data.cursor !== undefined && decodedStartKey === null) return invalidRequest();
    const startKey = decodedStartKey ?? undefined;
    const names = { '#pk': 'PK', '#sk': 'SK', '#expiresAt': 'expiresAt' };
    const values: Record<string, DynamoDbValue> = { ':pk': userKey(parsed.data.userId), ':prefix': 'RECOMMENDATION#', ':now': parsed.data.nowEpochSeconds };
    try {
      const response = await this.send({ operation: 'query', input: {
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        FilterExpression: '#expiresAt > :now',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        Limit: parsed.data.limit,
        ScanIndexForward: false,
        ...(startKey === undefined ? {} : { ExclusiveStartKey: startKey })
      } });
      const queryResult = QueryResponseSchema.safeParse(response);
      if (!queryResult.success) return invalidStoredData();
      const now = parsed.data.nowEpochSeconds;
      const items: RecommendationRecord[] = [];
      for (const raw of queryResult.data.Items ?? []) {
        const normalized = itemFromQuery(raw, now, parsed.data.userId);
        if (normalized === null) return invalidStoredData();
        if (normalized !== 'expired') items.push(normalized);
      }
      const lastKey = queryResult.data.LastEvaluatedKey;
      const parsedLastKey = lastKey === undefined ? null : CursorSchema.safeParse(lastKey);
      if (parsedLastKey !== null && !parsedLastKey.success) return invalidStoredData();
      const nextKey = parsedLastKey?.success ? parsedLastKey.data : null;
      if (nextKey !== null && (nextKey.PK !== userKey(parsed.data.userId) || !nextKey.SK.startsWith('RECOMMENDATION#'))) {
        return invalidStoredData();
      }
      return available('ok', { items, nextCursor: nextKey === null ? null : encodeCursor(nextKey) }, elapsedSince(startedAt));
    } catch (error: unknown) {
      return mapFailure(error, elapsedSince(startedAt));
    }
  }

  async recordProactiveDelivery(input: { userId: string; delivery: ProactiveDeliveryWrite }): Promise<ProviderResult<{ recorded: true } | { recorded: false; guardCodes: Array<'NOTIFICATIONS_DISABLED' | 'DAILY_CAP_REACHED' | 'DUPLICATE_CONTEXT' | 'RECENT_SAME_TRIGGER'> }>> {
    const startedAt = performance.now();
    const parsed = z.strictObject({ userId: UserIdSchema, delivery: DeliveryInputSchema }).safeParse(input);
    if (!parsed.success) return invalidRequest();
    const value = parsed.data.delivery;
    if (!value.notificationsEnabled) return available('ok', { recorded: false, guardCodes: ['NOTIFICATIONS_DISABLED'] }, elapsedSince(startedAt));
    const pk = userKey(parsed.data.userId);
    const recommendationSK = `RECOMMENDATION_REF#${value.recommendationId}`;
    try {
      const profileResponse = await this.send({ operation: 'get', input: { TableName: this.tableName, Key: { PK: pk, SK: 'PROFILE' }, ConsistentRead: true } });
      const rawProfile = itemFromResponse(profileResponse);
      if (rawProfile === undefined) return unavailable('error', elapsedSince(startedAt), 'PROFILE_NOT_FOUND');
      const profile = toProfile(parsed.data.userId, rawProfile);
      if (profile === null) return invalidStoredData();
      if (!profile.preferences.notificationsEnabled) {
        return available('ok', { recorded: false, guardCodes: ['NOTIFICATIONS_DISABLED'] }, elapsedSince(startedAt));
      }
      if (profile.preferences.notificationFrequency !== value.notificationFrequency) {
        return available('ok', { recorded: false, guardCodes: [] }, elapsedSince(startedAt));
      }
      if (localDateFor(value.at, profile.preferences.timezone) !== value.notificationDay) return invalidRequest();

      const stateResponse = await this.send({ operation: 'get', input: { TableName: this.tableName, Key: { PK: pk, SK: 'STATE' }, ConsistentRead: true } });
      const rawState = itemFromResponse(stateResponse);
      if (rawState === undefined) return available('ok', { recorded: false, guardCodes: [] }, elapsedSince(startedAt));
      const state = StateItemSchema.safeParse(rawState);
      if (!state.success) return invalidStoredData();

      const pointerResponse = await this.send({ operation: 'get', input: { TableName: this.tableName, Key: { PK: pk, SK: recommendationSK }, ConsistentRead: true } });
      const rawPointer = itemFromResponse(pointerResponse);
      if (rawPointer === undefined) return available('ok', { recorded: false, guardCodes: [] }, elapsedSince(startedAt));
      const pointer = RecommendationPointerSchema.safeParse(rawPointer);
      if (!pointer.success) return invalidStoredData();
      const nowEpochSeconds = Math.floor(Date.parse(value.at) / 1_000);
      if (pointer.data.recommendationId !== value.recommendationId || pointer.data.expiresAt <= nowEpochSeconds
        || pointer.data.deliveryRecordedAt !== undefined) {
        return available('ok', { recorded: false, guardCodes: [] }, elapsedSince(startedAt));
      }
      const guards = deliveryGuards(state.data, value);
      if (guards.length > 0) return available('ok', { recorded: false, guardCodes: guards }, elapsedSince(startedAt));
      if (state.data.latestContextEvaluationId !== value.evaluationId
        || state.data.latestContextFingerprint !== value.contextFingerprint) {
        return available('ok', { recorded: false, guardCodes: [] }, elapsedSince(startedAt));
      }

      const stateUpdate = proactiveDeliveryStateUpdate(this.tableName, pk, state.data, value);
      await this.send({ operation: 'transactWrite', input: { TransactItems: [
        { ConditionCheck: {
          TableName: this.tableName, Key: { PK: pk, SK: 'PROFILE' },
          ConditionExpression: '#preferences.#notificationsEnabled = :enabled AND #preferences.#timezone = :timezone AND #preferences.#notificationFrequency = :frequency',
          ExpressionAttributeNames: {
            '#preferences': 'preferences', '#notificationsEnabled': 'notificationsEnabled', '#timezone': 'timezone',
            '#notificationFrequency': 'notificationFrequency'
          },
          ExpressionAttributeValues: { ':enabled': true, ':timezone': profile.preferences.timezone, ':frequency': value.notificationFrequency }
        } },
        { Update: stateUpdate },
        { Update: {
          TableName: this.tableName, Key: { PK: pk, SK: recommendationSK },
          UpdateExpression: 'SET #deliveryRecordedAt = :at, #updatedAt = :at',
          ConditionExpression: 'attribute_exists(PK) AND #recommendationId = :recommendationId AND #evaluationId = :evaluationId AND attribute_not_exists(#deliveryRecordedAt) AND #expiresAt > :now',
          ExpressionAttributeNames: { '#recommendationId': 'recommendationId', '#evaluationId': 'evaluationId', '#deliveryRecordedAt': 'deliveryRecordedAt', '#updatedAt': 'updatedAt', '#expiresAt': 'expiresAt' },
          ExpressionAttributeValues: { ':recommendationId': value.recommendationId, ':evaluationId': value.evaluationId, ':at': canonicalTimestamp(value.at), ':now': nowEpochSeconds }
        } }
      ] } });
      return available('ok', { recorded: true }, elapsedSince(startedAt));
    } catch (error: unknown) {
      if (errorName(error) === 'TransactionCanceledException' || errorName(error) === 'ConditionalCheckFailedException') {
        return available('ok', { recorded: false, guardCodes: [] }, elapsedSince(startedAt));
      }
      return mapFailure(error, elapsedSince(startedAt));
    }
  }

  async claimIdempotency(input: { userId: string; record: IdempotencyRecord; nowEpochSeconds: number }): Promise<ProviderResult<IdempotencyClaim>> {
    const startedAt = performance.now();
    const parsed = z.strictObject({ userId: UserIdSchema, record: IdempotencyRecordSchema, nowEpochSeconds: PositiveEpochSchema }).safeParse(input);
    if (!parsed.success || parsed.data.record.responsePointer !== null || parsed.data.record.expiresAt <= parsed.data.nowEpochSeconds
      || parsed.data.record.expiresAt > parsed.data.nowEpochSeconds + 3600) return invalidRequest();
    const { userId, record, nowEpochSeconds } = parsed.data;
    const key = { PK: `IDEMPOTENCY#${userId}`, SK: `KEY#${record.key}` };
    const item = toDynamoItem({ ...key, ...record, entityType: 'Idempotency',
      createdAt: canonicalTimestamp(record.createdAt), updatedAt: canonicalTimestamp(record.createdAt), schemaVersion: 1 });
    if (!item) return invalidRequest();
    try {
      // Retry once if a concurrent release or TTL rollover removed the conflicting claim.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await this.send({ operation: 'put', input: {
            TableName: this.tableName, Item: item, ConditionExpression: 'attribute_not_exists(PK) OR #expiresAt <= :now',
            ExpressionAttributeNames: { '#expiresAt': 'expiresAt' }, ExpressionAttributeValues: { ':now': nowEpochSeconds }
          } });
          return available('ok', { status: 'claimed' }, elapsedSince(startedAt));
        } catch (error: unknown) {
          if (errorName(error) !== 'ConditionalCheckFailedException') throw error;
        }
        const response = await this.send({ operation: 'get', input: { TableName: this.tableName, Key: key, ConsistentRead: true } });
        const raw = itemFromResponse(response);
        if (raw === undefined) continue;
        const existing = IdempotencyItemSchema.safeParse(raw);
        if (!existing.success || existing.data.PK !== key.PK || existing.data.SK !== key.SK || existing.data.key !== record.key) return invalidStoredData();
        if (existing.data.expiresAt <= nowEpochSeconds) continue;
        if (existing.data.requestHash !== record.requestHash) return available('ok', { status: 'conflict' }, elapsedSince(startedAt));
        return available('ok', { status: 'existing', record: IdempotencyRecordSchema.parse({
          key: existing.data.key, claimId: existing.data.claimId, requestHash: existing.data.requestHash,
          responsePointer: existing.data.responsePointer, createdAt: existing.data.createdAt, expiresAt: existing.data.expiresAt
        }) }, elapsedSince(startedAt));
      }
      return unavailable('error', elapsedSince(startedAt), 'IDEMPOTENCY_CLAIM_RACE');
    } catch (error: unknown) {
      return mapFailure(error, elapsedSince(startedAt));
    }
  }

  async completeIdempotency(input: { userId: string; key: string; claimId: string; requestHash: string; result: EvaluationResult; storagePlaces: StoragePlace[]; expiresAt: number }): Promise<ProviderResult<null>> {
    const startedAt = performance.now();
    const parsed = IdempotencyOwnerSchema.extend({ result: EvaluationResultSchema, storagePlaces: z.array(StoredPlaceSchema).max(3), expiresAt: PositiveEpochSchema }).safeParse(input);
    if (!parsed.success) return invalidRequest();
    const { userId, key, claimId, requestHash, result, storagePlaces, expiresAt } = parsed.data;
    const cards: StorageRecommendationItem[] = [];
    for (const card of result.recommendations) {
      const storage = card.place ? storagePlaces.find(place => place.place.placeId === card.place?.placeId) : null;
      if (card.place && !storage) return invalidRequest();
      if (card.action.type === 'WEBSITE' && storage?.place.websiteUrl !== card.action.url) return invalidRequest();
      cards.push({ ...card, place: storage ?? null });
    }
    const projected = projectStorageRecommendations(cards);
    if (!projected) return invalidRequest();
    // Reject discovery facts instead of changing the result between its first response and replay.
    if (JSON.stringify(projected) !== JSON.stringify(result.recommendations.map(card => ApiRecommendationItemSchema.parse({ ...card, place: card.place ?? null })))) return invalidRequest();
    const timestamp = new Date().toISOString();
    const cache = toDynamoItem({ PK: userKey(userId), SK: `EVALUATION_RESULT#${result.evaluationId}`,
      entityType: 'EvaluationResult', result, expiresAt, createdAt: timestamp, updatedAt: timestamp, schemaVersion: 1 });
    if (!cache) return invalidRequest();
    try {
      await this.send({ operation: 'transactWrite', input: { TransactItems: [
        { Update: { TableName: this.tableName, Key: { PK: `IDEMPOTENCY#${userId}`, SK: `KEY#${key}` },
          UpdateExpression: 'SET #responsePointer = :pointer, #updatedAt = :at',
          ConditionExpression: '#claimId = :claimId AND #requestHash = :hash AND #responsePointer = :pending AND #expiresAt = :expiry',
          ExpressionAttributeNames: { '#responsePointer': 'responsePointer', '#claimId': 'claimId', '#requestHash': 'requestHash', '#expiresAt': 'expiresAt', '#updatedAt': 'updatedAt' },
          ExpressionAttributeValues: { ':pointer': result.evaluationId, ':claimId': claimId, ':hash': requestHash, ':pending': null, ':expiry': expiresAt, ':at': timestamp }
        } },
        { Put: { TableName: this.tableName, Item: cache, ConditionExpression: 'attribute_not_exists(PK)' } }
      ] } });
      return available('ok', null, elapsedSince(startedAt));
    } catch (error: unknown) {
      return mapFailure(error, elapsedSince(startedAt), 'IDEMPOTENCY_CONFLICT');
    }
  }

  async releaseIdempotency(input: { userId: string; key: string; claimId: string; requestHash: string }): Promise<ProviderResult<null>> {
    const startedAt = performance.now();
    const parsed = IdempotencyOwnerSchema.safeParse(input);
    if (!parsed.success) return invalidRequest();
    const { userId, key, claimId, requestHash } = parsed.data;
    try {
      await this.send({ operation: 'delete', input: {
        TableName: this.tableName, Key: { PK: `IDEMPOTENCY#${userId}`, SK: `KEY#${key}` },
        ConditionExpression: '#claimId = :claimId AND #requestHash = :hash AND #responsePointer = :pending',
        ExpressionAttributeNames: { '#claimId': 'claimId', '#requestHash': 'requestHash', '#responsePointer': 'responsePointer' },
        ExpressionAttributeValues: { ':claimId': claimId, ':hash': requestHash, ':pending': null }
      } });
      return available('ok', null, elapsedSince(startedAt));
    } catch (error: unknown) {
      if (errorName(error) === 'ConditionalCheckFailedException') return available('ok', null, elapsedSince(startedAt));
      return mapFailure(error, elapsedSince(startedAt));
    }
  }

  async getIdempotencyResponse(input: OwnedRead & { key: string; requestHash: string }): Promise<ProviderResult<EvaluationResult | null>> {
    const startedAt = performance.now();
    const parsed = z.strictObject({ userId: UserIdSchema, nowEpochSeconds: PositiveEpochSchema, key: z.uuid(), requestHash: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(input);
    if (!parsed.success) return invalidRequest();
    const { userId, key, requestHash, nowEpochSeconds } = parsed.data;
    const ownerKey = { PK: `IDEMPOTENCY#${userId}`, SK: `KEY#${key}` };
    try {
      const response = await this.send({ operation: 'get', input: { TableName: this.tableName, Key: ownerKey, ConsistentRead: true } });
      const raw = itemFromResponse(response);
      if (raw === undefined) return available('ok', null, elapsedSince(startedAt));
      const record = IdempotencyItemSchema.safeParse(raw);
      if (!record.success || record.data.PK !== ownerKey.PK || record.data.SK !== ownerKey.SK || record.data.key !== key) return invalidStoredData();
      if (record.data.requestHash !== requestHash || record.data.expiresAt <= nowEpochSeconds || !record.data.responsePointer) return available('ok', null, elapsedSince(startedAt));
      const cacheKey = { PK: userKey(userId), SK: `EVALUATION_RESULT#${record.data.responsePointer}` };
      const cached = await this.send({ operation: 'get', input: { TableName: this.tableName, Key: cacheKey, ConsistentRead: true } });
      const rawCache = itemFromResponse(cached);
      if (rawCache === undefined) return available('ok', null, elapsedSince(startedAt));
      const cache = EvaluationItemSchema.safeParse(rawCache);
      if (!cache.success || cache.data.PK !== cacheKey.PK || cache.data.SK !== cacheKey.SK
        || cache.data.result.evaluationId !== record.data.responsePointer || cache.data.expiresAt !== record.data.expiresAt) return invalidStoredData();
      if (cache.data.expiresAt <= nowEpochSeconds) return available('ok', null, elapsedSince(startedAt));
      return available('ok', cache.data.result, elapsedSince(startedAt));
    } catch (error: unknown) {
      return mapFailure(error, elapsedSince(startedAt));
    }
  }
  async getConversation(input: OwnedRead & { recommendationId: string }): Promise<ProviderResult<ConversationRecord | null>> {
    const startedAt = performance.now();
    const parsed = ConversationOwnerSchema.safeParse(input);
    if (!parsed.success) return invalidRequest();
    const { userId, recommendationId, nowEpochSeconds } = parsed.data;
    const pk = `RECOMMENDATION#${recommendationId}`;
    try {
      const response = await this.send({ operation: 'get', input: {
        TableName: this.tableName, Key: { PK: pk, SK: 'CONVERSATION' }, ConsistentRead: true
      } });
      const raw = itemFromResponse(response);
      if (raw === undefined) return available('ok', null, elapsedSince(startedAt));
      const record = mapRecord(raw);
      if (record === null) return invalidStoredData();
      if (record.userId !== userId || (typeof record.expiresAt === 'number' && record.expiresAt <= nowEpochSeconds)) {
        return available('ok', null, elapsedSince(startedAt));
      }
      const stored = ConversationItemSchema.safeParse(raw);
      if (!stored.success || stored.data.PK !== pk || stored.data.recommendationId !== recommendationId) return invalidStoredData();
      const query = await this.send({ operation: 'query', input: {
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
        ExpressionAttributeValues: { ':pk': pk, ':prefix': `CHAT#${stored.data.conversationId}#` },
        Limit: 17, ScanIndexForward: true, ConsistentRead: true
      } });
      const queried = QueryResponseSchema.safeParse(query);
      if (!queried.success || queried.data.LastEvaluatedKey !== undefined) return invalidStoredData();
      const messages: ConversationMessage[] = [];
      for (const rawMessage of queried.data.Items ?? []) {
        const message = ChatMessageItemSchema.safeParse(rawMessage);
        if (!message.success || message.data.PK !== pk || message.data.userId !== userId
          || message.data.recommendationId !== recommendationId
          || message.data.conversationId !== stored.data.conversationId
          || message.data.expiresAt !== stored.data.expiresAt
          || message.data.SK !== chatSortKey(message.data.conversationId, message.data.createdAt,
            message.data.messageId, message.data.role)) return invalidStoredData();
        const base = { id: message.data.SK, content: message.data.content, createdAt: message.data.createdAt };
        if (message.data.role === 'user') messages.push({ ...base, role: 'user' });
        else {
          const recommendations = projectStorageRecommendations(message.data.recommendations);
          if (recommendations === null) return invalidStoredData();
          messages.push({ ...base, role: 'assistant', recommendations });
        }
      }
      if (messages.length !== stored.data.turnCount * 2
        || messages.some((message, index) => message.role !== (index % 2 === 0 ? 'user' : 'assistant'))) return invalidStoredData();
      return available('ok', {
        conversationId: stored.data.conversationId, recommendationId, turnCount: stored.data.turnCount,
        expiresAt: stored.data.expiresAt, messages
      }, elapsedSince(startedAt));
    } catch (error: unknown) {
      return mapFailure(error, elapsedSince(startedAt));
    }
  }

  async appendConversationTurn(input: OwnedRead & { recommendationId: string; conversationId: string; messageId: string; userMessage: string; reply: string; recommendations: StorageRecommendationItem[]; at: string; expiresAt: number; maxUserTurns: number }): Promise<ProviderResult<ConversationRecord>> {
    const startedAt = performance.now();
    const parsed = AppendConversationSchema.safeParse(input);
    if (!parsed.success || parsed.data.expiresAt <= parsed.data.nowEpochSeconds
      || parsed.data.expiresAt > parsed.data.nowEpochSeconds + 7_200) return invalidRequest();
    const value = parsed.data;
    const pk = `RECOMMENDATION#${value.recommendationId}`;
    const metadataKey = { PK: pk, SK: 'CONVERSATION' };
    const canonicalAt = canonicalTimestamp(value.at);
    const userMessage = toDynamoItem({ ...metadataKey, SK: chatSortKey(value.conversationId, value.at, value.messageId, 'user'),
      entityType: 'ChatMessage', userId: value.userId, recommendationId: value.recommendationId,
      conversationId: value.conversationId, messageId: value.messageId, role: 'user', content: value.userMessage,
      expiresAt: value.expiresAt, createdAt: canonicalAt, updatedAt: canonicalAt, schemaVersion: 1 });
    const assistantMessage = toDynamoItem({ ...metadataKey, SK: chatSortKey(value.conversationId, value.at, value.messageId, 'assistant'),
      entityType: 'ChatMessage', userId: value.userId, recommendationId: value.recommendationId,
      conversationId: value.conversationId, messageId: value.messageId, role: 'assistant', content: value.reply,
      recommendations: value.recommendations, expiresAt: value.expiresAt,
      createdAt: canonicalAt, updatedAt: canonicalAt, schemaVersion: 1 });
    if (userMessage === null || assistantMessage === null) return invalidRequest();
    try {
      const response = await this.send({ operation: 'get', input: {
        TableName: this.tableName, Key: metadataKey, ConsistentRead: true
      } });
      const raw = itemFromResponse(response);
      const rawRecord = raw === undefined ? null : mapRecord(raw);
      if (raw !== undefined && rawRecord === null) return invalidStoredData();
      const expired = rawRecord !== null && typeof rawRecord.expiresAt === 'number'
        && rawRecord.expiresAt <= value.nowEpochSeconds;
      const existing = rawRecord === null || expired ? null : ConversationItemSchema.safeParse(rawRecord);
      if (existing !== null && !existing.success) return invalidStoredData();
      if (existing?.success) {
        if (existing.data.PK !== pk || existing.data.userId !== value.userId
          || existing.data.recommendationId !== value.recommendationId
          || existing.data.conversationId !== value.conversationId
          || existing.data.expiresAt !== value.expiresAt) {
          return unavailable('error', elapsedSince(startedAt), 'CONVERSATION_CONFLICT');
        }
        if (existing.data.turnCount >= value.maxUserTurns) {
          return unavailable('error', elapsedSince(startedAt), 'TURN_LIMIT_REACHED');
        }
      }
      const metadataWrite: DynamoDbTransactionItem = existing?.success
        ? { Update: { TableName: this.tableName, Key: metadataKey,
          UpdateExpression: 'SET #turnCount = #turnCount + :one, #updatedAt = :at',
          ConditionExpression: '#userId = :userId AND #recommendationId = :recommendationId AND #conversationId = :conversationId AND #expiresAt = :expiresAt AND #expiresAt > :now AND #turnCount < :max',
          ExpressionAttributeNames: { '#userId': 'userId', '#recommendationId': 'recommendationId', '#conversationId': 'conversationId',
            '#expiresAt': 'expiresAt', '#turnCount': 'turnCount', '#updatedAt': 'updatedAt' },
          ExpressionAttributeValues: { ':one': 1, ':at': canonicalAt, ':userId': value.userId,
            ':recommendationId': value.recommendationId, ':conversationId': value.conversationId,
            ':expiresAt': value.expiresAt, ':now': value.nowEpochSeconds, ':max': value.maxUserTurns }
        } }
        : { Put: { TableName: this.tableName, Item: toDynamoItem({ ...metadataKey,
          entityType: 'Conversation', userId: value.userId, recommendationId: value.recommendationId,
          conversationId: value.conversationId, turnCount: 1, expiresAt: value.expiresAt,
          createdAt: canonicalAt, updatedAt: canonicalAt, schemaVersion: 1 })!,
          ConditionExpression: 'attribute_not_exists(PK) OR #expiresAt <= :now',
          ExpressionAttributeNames: { '#expiresAt': 'expiresAt' }, ExpressionAttributeValues: { ':now': value.nowEpochSeconds }
        } };
      await this.send({ operation: 'transactWrite', input: { TransactItems: [
        { ConditionCheck: { TableName: this.tableName,
          Key: { PK: userKey(value.userId), SK: `RECOMMENDATION_REF#${value.recommendationId}` },
          ConditionExpression: '#recommendationId = :recommendationId AND #expiresAt > :now AND #expiresAt >= :expiresAt',
          ExpressionAttributeNames: { '#recommendationId': 'recommendationId', '#expiresAt': 'expiresAt' },
          ExpressionAttributeValues: { ':recommendationId': value.recommendationId, ':now': value.nowEpochSeconds, ':expiresAt': value.expiresAt }
        } },
        metadataWrite,
        { Put: { TableName: this.tableName, Item: userMessage, ConditionExpression: 'attribute_not_exists(PK)' } },
        { Put: { TableName: this.tableName, Item: assistantMessage, ConditionExpression: 'attribute_not_exists(PK)' } }
      ] } });
      const updated = await this.getConversation({ userId: value.userId,
        recommendationId: value.recommendationId, nowEpochSeconds: value.nowEpochSeconds });
      if ((updated.status !== 'ok' && updated.status !== 'degraded') || updated.data === null) return invalidStoredData();
      return available('ok', updated.data, elapsedSince(startedAt));
    } catch (error: unknown) {
      if (errorName(error) === 'TransactionCanceledException' || errorName(error) === 'ConditionalCheckFailedException') {
        try {
          const response = await this.send({ operation: 'get', input: {
            TableName: this.tableName, Key: metadataKey, ConsistentRead: true
          } });
          const stored = ConversationItemSchema.safeParse(itemFromResponse(response));
          if (stored.success && stored.data.userId === value.userId
            && stored.data.conversationId === value.conversationId
            && stored.data.turnCount >= value.maxUserTurns) {
            return unavailable('error', elapsedSince(startedAt), 'TURN_LIMIT_REACHED');
          }
        } catch { /* Preserve the original conditional conflict. */ }
        return unavailable('error', elapsedSince(startedAt), 'CONVERSATION_CONFLICT');
      }
      return mapFailure(error, elapsedSince(startedAt));
    }
  }
  async upsertDevice(input: { userId: string; device: DeviceRegistration }): Promise<ProviderResult<null>> { return this.unsupported(input); }
  async listDevices(input: { userId: string }): Promise<ProviderResult<DeviceRegistration[]>> { return this.unsupported(input); }
  async deleteDevice(input: { userId: string; deviceId: string }): Promise<ProviderResult<null>> { return this.unsupported(input); }
  async deleteUserData(input: { userId: string; cursor?: string }): Promise<ProviderResult<{ deletedCount: number; nextCursor: string | null }>> { return this.unsupported(input); }

  private unsupported<T>(input: unknown): ProviderResult<T> {
    void input;
    return notImplemented();
  }
}

export function createDynamoDbStateRepository(
  config: DynamoDbStateRepositoryConfig,
  clientOverride?: DynamoDbClient
): DynamoDbStateRepository {
  const client = clientOverride ?? sdkBackedClient(DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: config.region, maxAttempts: 1 })
  ));
  return new DynamoDbStateRepository({ client, tableName: config.tableName, timeoutMs: config.timeoutMs });
}
