import { readInstalledCurrentOwner } from '../verification/installed-owner-state.js';
import { createInstalledGoalApplicationClient } from '../verification/installed-goal-application.js';
import { createInstalledCompletionPublisher } from '../verification/installed-completion-publication.js';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
import { goalApplicationFromState } from './completion-intent.js';
import type { GoalState } from './types.js';
export type GoalCompletionObservation = { readonly kind: 'ordinary' } | { readonly kind: 'unavailable' }
  | { readonly kind: 'protected'; readonly state: 'binding_required' | 'binding_pending' | 'binding_mismatch' | 'needs_revalidation' | 'publication_pending' | 'verified' };
/** A local Goal cache, including status=complete, is not current authority. */
export function unobservedGoalCompletion(state: GoalState): GoalCompletionObservation {
  return readInstalledCurrentOwner({ ownerKind: 'goal', ownerId: state.goalId }).kind === 'ordinary'
    ? { kind: 'ordinary' } : { kind: 'unavailable' };
}
/** Fresh display only. Never persist this DTO or use it to admit execution. */
export async function observeGoalCompletion(raw: GoalState, signal?: AbortSignal): Promise<GoalCompletionObservation> {
  const state = structuredClone(raw), requested = { ownerKind: 'goal' as const, ownerId: state.goalId };
  const active = signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
  let application: ReturnType<typeof createInstalledGoalApplicationClient> | undefined;
  let publisher: ReturnType<typeof createInstalledCompletionPublisher> | undefined;
  try {
    active.throwIfAborted(); const route = readInstalledCurrentOwner(requested);
    if (route.kind === 'ordinary') return { kind: 'ordinary' };
    if (route.kind !== 'migrated' && route.kind !== 'protected-unregistered') return { kind: 'unavailable' };
    const original = json(route), expected = goalApplicationFromState(state);
    const current = () => { active.throwIfAborted(); if (json(readInstalledCurrentOwner(requested)) !== original) throw Error('goal_observation_owner_changed'); };
    application = createInstalledGoalApplicationClient(expected, 'scheduler');
    const before = await application.inspect(active); current();
    if (before.state === 'pending') return { kind: 'protected', state: 'binding_pending' };
    if (before.state === 'unbound') return { kind: 'protected', state: 'binding_required' };
    if (json(before.current?.binding ?? null) !== json(expected)) return { kind: 'protected', state: 'binding_mismatch' };
    publisher = createInstalledCompletionPublisher(requested, 'scheduler');
    const observed = await publisher.observe(active);
    if (json(await application.inspect(active)) !== json(before) || json(await publisher.observe(active)) !== json(observed)) throw Error('goal_observation_changed');
    current();
    if (json(observed.owner) !== json(route.owner) || observed.currentVerification === 'unavailable') return { kind: 'unavailable' };
    if (observed.currentVerification !== 'valid') return { kind: 'protected', state: 'needs_revalidation' };
    return { kind: 'protected', state: observed.publication.status === 'committed' && observed.publication.current ? 'verified' : 'publication_pending' };
  } catch { signal?.throwIfAborted(); return { kind: 'unavailable' }; }
  finally { publisher?.dispose(); application?.dispose(); }
}
