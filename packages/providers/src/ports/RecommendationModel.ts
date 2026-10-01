import type {
  CandidateOpportunity, ChatReply, ContextInput, GeocodedPlace, ProviderNeed, ProviderPlace,
  ProviderResult, RecommendationDecision, RecommendationItem, RouteSummary, TriggerType,
  UserPreferences, WeatherSnapshot
} from '@contextia/contracts';

export interface ProviderEnrichment {
  geocoding: { eventId: string; result: ProviderResult<GeocodedPlace[]> }[];
  places: { need: Extract<ProviderNeed, 'places-near-current' | 'places-near-destination'>; anchorKey: string; result: ProviderResult<ProviderPlace[]> }[];
  weather: { need: Extract<ProviderNeed, 'weather-current' | 'weather-today'>; result: ProviderResult<WeatherSnapshot> }[];
  routes: { need: Extract<ProviderNeed, 'route-to-next-event' | 'route-to-place-candidates'>; anchorKey: string; result: ProviderResult<RouteSummary> }[];
}
export interface RecommendationSummary { recommendationId: string; triggerType: TriggerType; createdAt: string; summary: string }
export interface RecommendationModelInput {
  context: ContextInput;
  now: string;
  preferences: UserPreferences;
  candidates: CandidateOpportunity[];
  enrichment: ProviderEnrichment;
  recentRecommendations: RecommendationSummary[];
}
export interface RecommendationFollowUpInput {
  recommendationId: string;
  message: string;
  recommendations: RecommendationItem[];
  context: ContextInput | null;
  preferences: UserPreferences;
  enrichment: ProviderEnrichment;
  messages: { role: 'user' | 'assistant'; content: string; createdAt: string }[];
}
export interface RecommendationModel {
  // Call only after deterministic guards/candidates. Validate schema AND supplied place/route references.
  decide(input: RecommendationModelInput): Promise<ProviderResult<RecommendationDecision>>;
  followUp(input: RecommendationFollowUpInput): Promise<ProviderResult<ChatReply>>;
}
