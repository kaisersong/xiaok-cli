/** A dated UI observation, not a lease, proof, or permission for later actions. */
export interface LoopCompletionObservation {
  state: 'verified_at_read' | 'needs_revalidation';
  checkedAt: number;
}
