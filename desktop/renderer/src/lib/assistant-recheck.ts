/** Shared expectations for the single read-back after an unknown assistant
 * mutation result. Each caller states what Main must show for the mutation
 * to count as applied; 'not_applied' reads as "not visible yet, safe to
 * retry"; 'undetermined' keeps the unknown banner with a manual refresh. */

export type RecheckVerdict = 'applied' | 'not_applied' | 'undetermined';

type CandidateStatus = { id: string; status: string };
type OverviewLike = { profile: { status: string }; candidates: CandidateStatus[] };

/** activate/resume expect 'active'; pause expects 'paused'. */
export function expectAssistantStatus(action: 'activateAssistant' | 'pauseAssistant' | 'resumeAssistant') {
  return (overview: OverviewLike): RecheckVerdict => overview.profile.status === (action === 'pauseAssistant' ? 'paused' : 'active') ? 'applied' : 'not_applied';
}

/** Main keeps decided candidates in the overview list with an updated status
 * (loop-store keeps the record; the controller returns all of them).
 * accepted/rejected/superseded or removal counts as decided; 'accepting' is
 * a persisted promotion intent that may still be running, so it stays
 * undetermined; pending/staged/accept_failed are safe to retry. */
export function readCandidateDecision(candidateId: string) {
  return (overview: OverviewLike): RecheckVerdict => {
    const candidate = overview.candidates.find(row => row.id === candidateId);
    if (!candidate) return 'applied';
    if (candidate.status === 'accepting') return 'undetermined';
    if (candidate.status === 'accepted' || candidate.status === 'rejected' || candidate.status === 'superseded') return 'applied';
    return 'not_applied';
  };
}
