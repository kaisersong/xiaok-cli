/** Shared expectations for the single read-back after an unknown assistant
 * mutation result. Each caller states what Main must show for the mutation
 * to count as applied; anything else reads as "not visible yet, safe to
 * retry", and a failed read-back falls back to the unknown banner. */

type CandidateStatus = { id: string; status: string };
type OverviewLike = { profile: { status: string }; candidates: CandidateStatus[] };

/** activate/resume expect 'active'; pause expects 'paused'. */
export function expectAssistantStatus(action: 'activateAssistant' | 'pauseAssistant' | 'resumeAssistant') {
  return (overview: OverviewLike): boolean => overview.profile.status === (action === 'pauseAssistant' ? 'paused' : 'active');
}

/** Main keeps decided candidates in the overview list with an updated status
 * (loop-store keeps the record; the controller returns all of them). Accept
 * counts as applied on 'accepted', reject on 'rejected' or 'superseded';
 * a candidate removed upstream also counts as decided. */
export function expectCandidateDecided(candidateId: string, decision: 'accept' | 'reject') {
  return (overview: OverviewLike): boolean => {
    const candidate = overview.candidates.find(row => row.id === candidateId);
    if (!candidate) return true;
    return decision === 'accept' ? candidate.status === 'accepted' : candidate.status === 'rejected' || candidate.status === 'superseded';
  };
}
