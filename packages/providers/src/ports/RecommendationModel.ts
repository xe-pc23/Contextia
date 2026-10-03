import type {
  CandidateEvidence, CandidateOpportunity, ChatReply, ContextInput, ProviderResult,
  RecommendationDecision, RecommendationItem, TriggerType, UserPreferences
} from '@contextia/contracts';
import type { ConversationMessage } from './StateRepository.js';

export type ProviderEnrichment = CandidateEvidence;
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
  messages: ConversationMessage[];
}
export interface RecommendationModel {
  // Call only after deterministic guards/candidates. Validate schema AND supplied place/route references.
  decide(input: RecommendationModelInput): Promise<ProviderResult<RecommendationDecision>>;
  followUp(input: RecommendationFollowUpInput): Promise<ProviderResult<ChatReply>>;
}
