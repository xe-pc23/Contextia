import { ChatReplySchema, ContextInputSchema, ProviderPlaceSchema } from '@contextia/contracts';
import type { ApiRecommendationItem, ChatResponse, ContextInput, ProviderPlace } from '@contextia/contracts';
import type { PlacesProvider, ProviderEnrichment, RecommendationModel, StateRepository, StoragePlace, StorageRecommendationItem } from '@contextia/providers';
import { ApiFailure } from './apiFailure.js';
import { matchingRoute, publicPlace, referenceError } from './references.js';
import { providerCall } from './providerCall.js';

export type ChatRepository = Pick<StateRepository, 'getProfile' | 'getRecommendation' | 'getContextSnapshot' | 'getConversation' | 'appendConversationTurn'>;
export interface ChatDependencies {
  state: ChatRepository;
  places: PlacesProvider;
  model: Pick<RecommendationModel, 'followUp'>;
  clock: () => Date;
  newId: (prefix: 'conv' | 'msg' | 'item') => string;
  modelTimeoutMs?: number;
  placesTimeoutMs?: number;
  conversationTtlSeconds?: number;
  maxUserTurns?: number;
}
export type ChatWithRecommendation = (input: { userId: string; recommendationId: string; message: string }) => Promise<ChatResponse['data']>;

export function createChatWithRecommendation(deps: ChatDependencies): ChatWithRecommendation {
  return async ({ userId, recommendationId, message }) => {
    const now = deps.clock();
    const nowEpochSeconds = Math.floor(now.getTime() / 1000);
    const owned = { userId, recommendationId, nowEpochSeconds };
    // Ownership must be proved before profile, conversation, context, or model access.
    const recommendation = await deps.state.getRecommendation(owned);
    if (recommendation.status !== 'ok' && recommendation.status !== 'degraded') throw new ApiFailure('STATE_UNAVAILABLE');
    if (!recommendation.data || recommendation.data.id !== recommendationId || recommendation.data.expiresAt <= nowEpochSeconds) throw new ApiFailure('RECOMMENDATION_NOT_FOUND');
    const record = recommendation.data;
    const profile = await deps.state.getProfile({ userId });
    if (profile.status !== 'ok' && profile.status !== 'degraded') throw new ApiFailure('STATE_UNAVAILABLE');
    if (!profile.data) throw new ApiFailure('PROFILE_NOT_FOUND');
    if (profile.data.userId !== userId) throw new ApiFailure('STATE_UNAVAILABLE');
    const preferences = profile.data.preferences;
    const prior = await deps.state.getConversation(owned);
    if (prior.status !== 'ok' && prior.status !== 'degraded') throw new ApiFailure('STATE_UNAVAILABLE');
    const conversation = prior.data && prior.data.expiresAt > nowEpochSeconds ? prior.data : null;
    if (conversation && conversation.recommendationId !== recommendationId) throw new ApiFailure('STATE_UNAVAILABLE');
    const maxUserTurns = deps.maxUserTurns ?? 8;
    if (conversation && conversation.turnCount >= maxUserTurns) throw new ApiFailure('CHAT_LIMIT_REACHED');

    const snapshot = await deps.state.getContextSnapshot({ userId, reference: record.contextReference, nowEpochSeconds });
    if (snapshot.status !== 'ok' && snapshot.status !== 'degraded') throw new ApiFailure('STATE_UNAVAILABLE');
    let context: ContextInput | null = null;
    // A Phase 1 simulation snapshot does not retain scenarioTime. Do not invent it from capturedAt.
    if (snapshot.data && snapshot.data.expiresAt > nowEpochSeconds && snapshot.data.mode === 'real') {
      context = ContextInputSchema.parse({
        mode: 'real', deliveryMode: 'proactive', capturedAt: snapshot.data.capturedAt,
        location: { ...snapshot.data.location, capturedAt: snapshot.data.capturedAt, source: 'gps' },
        ...(snapshot.data.activity ? { activity: snapshot.data.activity } : {}), calendar: snapshot.data.calendar
      });
    }
    const messages = conversation?.messages ?? [];
    const cards = [...record.recommendations, ...messages.flatMap(turn => turn.role === 'assistant' ? turn.recommendations : [])];
    const places: ProviderPlace[] = [...new Map(cards.flatMap(card => card.place ? [ProviderPlaceSchema.parse({ ...card.place,
      ...(card.action.type === 'WEBSITE' ? { websiteUrl: card.action.url } : {}) })] : []).map(place => [place.placeId, place])).values()];
    const enrichment: ProviderEnrichment = {
      geocoding: [], weather: [],
      places: [{ need: 'places-near-current', anchorKey: 'current', result: { status: 'ok', data: places } }],
      routes: []
    };
    const reply = await providerCall(() => deps.model.followUp({
      recommendationId, message, recommendations: record.recommendations, context,
      preferences, enrichment, messages
    }), deps.modelTimeoutMs ?? 7000);
    if (reply.status !== 'ok' && reply.status !== 'degraded') throw new ApiFailure('MODEL_UNAVAILABLE');
    const parsed = ChatReplySchema.safeParse(reply.data);
    const routes = cards.flatMap(card => card.route ? [card.route] : []);
    if (!parsed.success || referenceError(parsed.data.recommendations, enrichment, routes)) throw new ApiFailure('INVALID_MODEL_OUTPUT');
    const sourcePlaces = new Map(places.map(place => [place.placeId, place]));
    const storedPlaces = new Map<string, StoragePlace>();
    const selectedIds = [...new Set(parsed.data.recommendations.flatMap(item => item.place ? [item.place.placeId] : []))];
    await Promise.all(selectedIds.map(async placeId => {
      const result = await providerCall(() => deps.places.getPlace({ placeId, locale: preferences.locale, persistenceIntent: 'storage' }), deps.placesTimeoutMs ?? 2500);
      if (result.status !== 'ok' && result.status !== 'degraded') throw new ApiFailure('STATE_UNAVAILABLE');
      const place = ProviderPlaceSchema.safeParse(result.data.place);
      if (result.data.persistenceIntent !== 'storage' || !place.success || place.data.placeId !== placeId || !sourcePlaces.has(place.data.placeId)) throw new ApiFailure('STATE_UNAVAILABLE');
      storedPlaces.set(place.data.placeId, { persistenceIntent: 'storage', place: place.data });
    }));
    if (parsed.data.recommendations.some(item => item.action.type === 'WEBSITE' && storedPlaces.get(item.place?.placeId ?? '')?.place.websiteUrl !== item.action.url)) throw new ApiFailure('STATE_UNAVAILABLE');
    const items = parsed.data.recommendations.map(item => {
      const id = deps.newId('item');
      const place = item.place ? storedPlaces.get(item.place.placeId) : undefined;
      const route = item.route ? matchingRoute(item.route, cards.flatMap(card => card.route ? [card.route] : [])) : null;
      const api: ApiRecommendationItem = { ...item, id, place: place ? publicPlace(place.place) : null, route: route ?? null };
      const storage: StorageRecommendationItem = { ...api, place: place ?? null };
      return { api, storage };
    });
    const conversationId = conversation?.conversationId ?? deps.newId('conv');
    const expiresAt = conversation?.expiresAt ?? Math.min(record.expiresAt, nowEpochSeconds + (deps.conversationTtlSeconds ?? 7200));
    const appended = await deps.state.appendConversationTurn({
      ...owned, conversationId, messageId: deps.newId('msg'), userMessage: message, reply: parsed.data.reply,
      recommendations: items.map(item => item.storage), at: now.toISOString(), expiresAt, maxUserTurns
    });
    if (appended.status !== 'ok' && appended.status !== 'degraded') {
      if (appended.code === 'CHAT_LIMIT_REACHED' || appended.code === 'TURN_LIMIT_REACHED') throw new ApiFailure('CHAT_LIMIT_REACHED');
      throw new ApiFailure('STATE_UNAVAILABLE');
    }
    if (appended.data.recommendationId !== recommendationId || appended.data.conversationId !== conversationId || appended.data.expiresAt <= nowEpochSeconds) throw new ApiFailure('STATE_UNAVAILABLE');
    return { conversationId, reply: parsed.data.reply, recommendations: items.map(item => item.api), expiresAt: new Date(appended.data.expiresAt * 1000).toISOString() };
  };
}
