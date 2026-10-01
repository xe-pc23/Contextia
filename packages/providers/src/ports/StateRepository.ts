import type {
  ActivityContext, ApiRecommendationItem, CalendarEventContext, ContextInput, EvaluationResult,
  GeoPoint, GuardCode, Profile, ProviderResult, ProviderStatusMap, SignalName, TriggerType, Urgency, UserPreferences
} from '@contextia/contracts';
import type { DeviceRegistration } from './NotificationProvider.js';
import type { StoragePlace } from './PlacesProvider.js';

export interface OwnedRead { userId: string; nowEpochSeconds: number }
export interface ContextReference { evaluationId: string; capturedAt: string }
export interface RecentAnchor { triggerType: TriggerType; anchorKey: string; notifiedAt: string }
export interface UserState {
  notificationDay: string;
  notificationsSentToday: number;
  latestContext?: ContextReference;
  latestContextFingerprint?: string;
  latestRecommendationAt?: string;
  recentAnchors: RecentAnchor[];
}
export interface ContextSnapshot extends ContextReference {
  mode: ContextInput['mode'];
  location: GeoPoint & { accuracyMeters?: number };
  activity?: Pick<ActivityContext, 'stepsToday' | 'confidence'>;
  // IDs are already hashed by the application; only the approved fields survive.
  calendar: CalendarEventContext[];
  createdAt: string;
  expiresAt: number;
}
export interface RecommendationRecord {
  id: string;
  evaluationId: string;
  contextReference: ContextReference;
  createdAt: string;
  triggerType: TriggerType;
  urgency: Urgency;
  message: string;
  recommendations: ApiRecommendationItem[];
  usedSignals: SignalName[];
  summaryForDedup: string;
  providerStatus: ProviderStatusMap;
  expiresAt: number;
}
export type StorageRecommendationItem = Omit<ApiRecommendationItem, 'place'> & { place?: StoragePlace | null };
export type RecommendationWrite = Omit<RecommendationRecord, 'recommendations'> & { recommendations: StorageRecommendationItem[] };
export interface ProactiveDeliveryWrite {
  deliveryMode: 'proactive';
  evaluationId: string;
  recommendationId: string;
  notificationDay: string;
  notificationsEnabled: boolean;
  maxDailyNotifications: number;
  contextFingerprint: string;
  triggerType: TriggerType;
  anchorKey: string;
  at: string;
  contextDedupSeconds: number;
  anchorDedupSeconds: number;
  maxRecentAnchors: number;
}
export type DeliveryGuardCode = Extract<GuardCode, 'NOTIFICATIONS_DISABLED' | 'DAILY_CAP_REACHED' | 'DUPLICATE_CONTEXT' | 'RECENT_SAME_TRIGGER'>;
export type DeliveryWriteResult = { recorded: true } | { recorded: false; guardCodes: DeliveryGuardCode[] };
export interface IdempotencyRecord {
  key: string;
  requestHash: string;
  responsePointer: string | null;
  createdAt: string;
  expiresAt: number;
}
export type IdempotencyClaim = { status: 'claimed' } | { status: 'existing'; record: IdempotencyRecord } | { status: 'conflict' };
export interface ConversationRecord {
  conversationId: string;
  recommendationId: string;
  turnCount: number;
  expiresAt: number;
  messages: { id: string; role: 'user' | 'assistant'; content: string; createdAt: string }[];
}

// Domain-shaped DTOs only: no PK/SK, DynamoDB AttributeValue, SDK responses or error bodies.
export interface StateRepository {
  getProfile(input: { userId: string }): Promise<ProviderResult<Profile | null>>;
  putPreferences(input: { userId: string; preferences: UserPreferences; at: string }): Promise<ProviderResult<null>>;
  getState(input: OwnedRead): Promise<ProviderResult<UserState | null>>;
  writeContextSnapshot(input: { userId: string; snapshot: ContextSnapshot; fingerprint: string }): Promise<ProviderResult<null>>;
  getContextSnapshot(input: OwnedRead & { reference: ContextReference }): Promise<ProviderResult<ContextSnapshot | null>>;
  // Write history and its ID pointer atomically; unwrap/project only the normalized Storage places.
  writeRecommendation(input: { userId: string; recommendation: RecommendationWrite }): Promise<ProviderResult<null>>;
  getRecommendation(input: OwnedRead & { recommendationId: string }): Promise<ProviderResult<RecommendationRecord | null>>;
  listRecommendations(input: OwnedRead & { limit: number; cursor?: string }): Promise<ProviderResult<{ items: RecommendationRecord[]; nextCursor: string | null }>>;
  // Atomically recheck cap, fingerprint, anchor and recommendation ID; exclude this evaluation's own latest snapshot.
  recordProactiveDelivery(input: { userId: string; delivery: ProactiveDeliveryWrite }): Promise<ProviderResult<DeliveryWriteResult>>;
  claimIdempotency(input: { userId: string; record: IdempotencyRecord; nowEpochSeconds: number }): Promise<ProviderResult<IdempotencyClaim>>;
  // The adapter stores a short-lived response reference; referenced selected places must have Storage intent.
  completeIdempotency(input: { userId: string; key: string; requestHash: string; result: EvaluationResult; storagePlaces: StoragePlace[]; expiresAt: number }): Promise<ProviderResult<null>>;
  getIdempotencyResponse(input: OwnedRead & { key: string; requestHash: string }): Promise<ProviderResult<EvaluationResult | null>>;
  getConversation(input: OwnedRead & { recommendationId: string }): Promise<ProviderResult<ConversationRecord | null>>;
  // Enforce ownership, one conversation, max user turns and expiry atomically.
  appendConversationTurn(input: OwnedRead & { recommendationId: string; conversationId: string; messageId: string; userMessage: string; reply: string; recommendations: StorageRecommendationItem[]; at: string; expiresAt: number; maxUserTurns: number }): Promise<ProviderResult<ConversationRecord>>;
  upsertDevice(input: { userId: string; device: DeviceRegistration }): Promise<ProviderResult<null>>;
  listDevices(input: { userId: string }): Promise<ProviderResult<DeviceRegistration[]>>;
  deleteDevice(input: { userId: string; deviceId: string }): Promise<ProviderResult<null>>;
  // Delete owned data (including expired items/chat/idempotency) in bounded batches, never Cognito here.
  deleteUserData(input: { userId: string; cursor?: string }): Promise<ProviderResult<{ deletedCount: number; nextCursor: string | null }>>;
}
