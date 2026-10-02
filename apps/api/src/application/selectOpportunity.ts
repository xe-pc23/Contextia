import type { CandidateOpportunity } from '@contextia/contracts';

export function selectOpportunity(candidates: readonly CandidateOpportunity[]): CandidateOpportunity | undefined {
  return candidates.reduce<CandidateOpportunity | undefined>((best, candidate) => {
    // Preserve the domain registry order for equal confidence.
    if (!best || candidate.confidence > best.confidence) return candidate;
    return best;
  }, undefined);
}
