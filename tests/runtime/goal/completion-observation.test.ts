import { beforeEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ route: {} as any, application: {} as any, publication: {} as any, opened: 0, disposed: 0, change: undefined as undefined | (() => void) }));
vi.mock('../../../src/runtime/verification/installed-owner-state.js', () => ({ readInstalledCurrentOwner: () => f.route }));
vi.mock('../../../src/runtime/verification/installed-goal-application.js', () => ({ createInstalledGoalApplicationClient: () => { f.opened++; return { async inspect() { return structuredClone(f.application); }, dispose() { f.disposed++; } }; } }));
vi.mock('../../../src/runtime/verification/installed-completion-publication.js', () => ({ createInstalledCompletionPublisher: () => { f.opened++; return { async observe() { const value = structuredClone(f.publication); f.change?.(); return value; }, dispose() { f.disposed++; } }; } }));
import { observeGoalCompletion, unobservedGoalCompletion } from '../../../src/runtime/goal/completion-observation.js';
import { createGoalState } from '../../../src/runtime/goal/reducer.js';
import { goalApplicationFromState } from '../../../src/runtime/goal/completion-intent.js';
import { goalApplicationBindingHash } from '../../../src/runtime/verification/goal-application-binding.js';
const state = createGoalState({ sessionId: 'session', goalId: 'goal', objective: 'original', expectedEvidenceKinds: ['answer'], now: 1 });
beforeEach(() => {
  f.route = { kind: 'protected-unregistered', authorityId: 'authority', owner: { profileId: 'profile', ownerKind: 'goal', ownerId: 'goal' } };
  const binding = goalApplicationFromState(state); f.application = { state: 'active', current: { binding, bindingHash: goalApplicationBindingHash(binding), revision: 1 }, pendingTransitionId: null, pendingTarget: null };
  f.publication = { owner: f.route.owner, businessRevision: 1, currentVerification: 'valid', publication: { status: 'committed', current: true, operationId: 'op', fullTupleHash: 'a'.repeat(64) } };
  f.opened = 0; f.disposed = 0; f.change = undefined;
});
it('ordinary reads open no privileged client and unobserved protected caches never imply verified completion', async () => {
  expect(unobservedGoalCompletion(state)).toEqual({ kind: 'unavailable' });
  f.route = { kind: 'ordinary' }; expect(await observeGoalCompletion(state)).toEqual({ kind: 'ordinary' }); expect(f.opened).toBe(0);
});
it('requires the exact current application and receiver commit regardless of cached Goal status', async () => {
  expect(await observeGoalCompletion({ ...state, status: 'complete' })).toEqual({ kind: 'protected', state: 'verified' });
  f.publication.currentVerification = 'needs_revalidation'; f.publication.publication.current = false;
  expect(await observeGoalCompletion({ ...state, status: 'complete' })).toEqual({ kind: 'protected', state: 'needs_revalidation' });
  f.publication.currentVerification = 'valid'; f.publication.publication = { status: 'absent' };
  expect(await observeGoalCompletion({ ...state, status: 'complete' })).toEqual({ kind: 'protected', state: 'publication_pending' });
  expect(f.disposed).toBe(f.opened);
});
it.each(['unbound','pending','mismatch'] as const)('shows %s application as a separate non-complete state', async mode => {
  if (mode === 'mismatch') f.application.current.binding = { ...f.application.current.binding, epoch: 2 };
  else { f.application.state = mode; if (mode === 'unbound') f.application.current = null; }
  expect(await observeGoalCompletion(state)).toEqual({ kind: 'protected', state: mode === 'unbound' ? 'binding_required' : mode === 'pending' ? 'binding_pending' : 'binding_mismatch' });
  expect(f.opened).toBe(1); expect(f.disposed).toBe(1);
});
it('never reports a stale binding, owner route or superseded publication as current', async () => {
  f.change = () => { f.application.current.binding.epoch = 2; };
  expect(await observeGoalCompletion(state)).toEqual({ kind: 'unavailable' });
});
