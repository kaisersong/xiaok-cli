import { readInstalledCurrentOwner } from '../verification/installed-owner-state.js';
import { createInstalledGoalApplicationClient } from '../verification/installed-goal-application.js';
import type { GoalApplicationBinding } from '../verification/goal-application-binding.js';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
import { goalApplicationFromState } from './completion-intent.js';
import { goalNativeCandidate, goalNativeStateHash, parseGoalNativeMutation } from './native-mutation-journal.js';
import type { GoalCommitInput, GoalState, GoalStore } from './types.js';
const durable = (value: unknown) => json(JSON.parse(JSON.stringify(value)));
const requested = (state: GoalState) => ({ ownerKind: 'goal' as const, ownerId: state.goalId });
function commitJson(input: GoalCommitInput) {
  const { nativeProjection, completionProjection, ...data } = input;
  return durable(data);
}
interface NativeProjection { store: GoalStore; route: string; previousRoute: string | null; current: string; commit: string; signal?: AbortSignal; assertAdmission?: () => void }
const projections = new WeakMap<object, NativeProjection>();
/** Restrictive host generation/permission check, never an authority issuer. */
function checkAdmission(check?: () => void): void {
  const result: unknown = check?.();
  if (result !== undefined) { void Promise.resolve(result).catch(() => {}); throw Error('goal_native_admission_sync'); }
}
/** Fresh fixed-endpoint observation for crashgap repair; never an execution grant. */
export async function assertGoalNativeApplicationCurrent(binding: Readonly<GoalApplicationBinding>, signal?: AbortSignal): Promise<void> {
  const client = createInstalledGoalApplicationClient(binding, 'scheduler');
  try {
    const result = await client.inspect(signal);
    signal?.throwIfAborted();
    if (result.state !== 'active' || result.pendingTransitionId !== null || result.pendingTarget !== null
      || json(result.current?.binding) !== json(binding)) throw Error('goal_native_projection_application');
  } finally { client.dispose(); }
}

/** An actual installed application observation authorizes one exact cache write.
 * It is not a native approval, current verification, or SDK execution grant. */
export async function authorizeGoalNativeProjection(store: GoalStore, raw: GoalCommitInput, mutation: unknown, signal?: AbortSignal, assertAdmission?: () => void): Promise<GoalCommitInput> {
  if (assertAdmission !== undefined && typeof assertAdmission !== 'function') throw Error('goal_native_admission_invalid');
  checkAdmission(assertAdmission);
  if (raw.nativeProjection || raw.completionProjection) throw Error('goal_native_projection_existing');
  const input = structuredClone(raw), row = parseGoalNativeMutation(mutation);
  if (row.status !== 'ready' || input.sessionId !== row.sessionId
    || input.expectedRevision !== (row.previous?.revision ?? null)
    || durable(input.next) !== durable(goalNativeCandidate(row)) || input.turns.length || input.evidence.length
    || input.completionIntent || input.completionIntentId
    || input.events.some(event => event.actor !== 'user' || event.goalId !== row.target.goalId
      || event.revision !== input.next.revision || event.type!==(row.kind==='fork'?'forked':row.kind==='replace'?'replaced':'created')))
    throw Error('goal_native_projection_transition');
  signal?.throwIfAborted();
  const current = (await store.load(input.sessionId))?.state ?? null;
  if (row.previous ? !current || goalNativeStateHash(current) !== row.previous.stateHash : current !== null)
    throw Error('goal_native_projection_basis');
  const route = readInstalledCurrentOwner(requested(input.next));
  if (route.kind !== 'protected-unregistered' && route.kind !== 'migrated') throw Error('goal_native_projection_owner');
  const routeKey = json(route), previousRoute = current ? json(readInstalledCurrentOwner(requested(current))) : null;
  const client = createInstalledGoalApplicationClient(row.target, 'scheduler');
  try {
    const observation = await client.inspect(signal);
    signal?.throwIfAborted();
    if (observation.state !== 'active' || observation.pendingTransitionId !== null || observation.pendingTarget !== null
      || json(observation.current?.binding) !== json(row.target)) throw Error('goal_native_projection_application');
    if (json(readInstalledCurrentOwner(requested(input.next))) !== routeKey
      || current && json(readInstalledCurrentOwner(requested(current))) !== previousRoute) throw Error('goal_native_projection_owner_changed');
    const token = Object.freeze({});
    projections.set(token, { store, route: routeKey, previousRoute, current: goalNativeStateHash(current), commit: commitJson(input), signal, assertAdmission });
    return { ...input, nativeProjection: token };
  } finally { client.dispose(); }
}

/** Consume immediately, before cloning or another projection's checks can fail.
 * The returned check is used only inside the consuming store's actual lock. */
export function consumeGoalNativeProjection(store: GoalStore, token: unknown) {
  const projection = token && typeof token === 'object' ? projections.get(token) : undefined;
  if (token && typeof token === 'object') projections.delete(token);
  let used = false;
  return (current: GoalState | null, input: GoalCommitInput): void => {
    if (used) throw Error('goal_native_projection_consumed');
    used = true;
    projection?.signal?.throwIfAborted();
    checkAdmission(projection?.assertAdmission);
    const changed = !current || json(goalApplicationFromState(current)) !== json(goalApplicationFromState(input.next));
    if (!changed) { if (token) throw Error('goal_native_projection_transition'); return; }
    const route = readInstalledCurrentOwner(requested(input.next));
    const previousRoute = current ? readInstalledCurrentOwner(requested(current)) : null;
    if (route.kind === 'ordinary' && (!previousRoute || previousRoute.kind === 'ordinary') && !token) return;
    if (!projection || projection.store !== store || projection.route !== json(route)
      || projection.previousRoute !== (previousRoute ? json(previousRoute) : null)
      || projection.current !== goalNativeStateHash(current) || projection.commit !== commitJson(input))
      throw Error('goal_native_projection_required');
  };
}
