import { createInstalledVerificationClient } from '../verification/controller-client.js';
import { createOwnerEnrollmentClient } from '../verification/completion-client.js';
import { createInstalledGoalApplicationClient } from '../verification/installed-goal-application.js';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
import { FileGoalNativeJournal, goalNativeStateHash, type GoalNativeMutation } from './native-mutation-journal.js';
import { goalVerificationRegistration } from './verification-definition.js';
import type { GoalOwnershipPort, GoalStore } from './types.js';
interface NativeMutationRun {
  sessionId: string; mutationId: string; instanceId: string;
  requestSource: 'user' | 'scheduler'; action: 'advance' | 'recover'; signal?: AbortSignal;
}
/** Main/CLI owns scheduling and the admission generation. Journal records are
 * recovery facts only; this workflow never writes or arms the active Goal. */
export function createGoalNativeMutationWorkflow(options: {
  store: GoalStore; journal: FileGoalNativeJournal; ownership: GoalOwnershipPort;
  assertAdmission: () => void; now?: () => number;
}) {
  const { store, journal, ownership, assertAdmission: admission } = options, now = options.now ?? Date.now;
  function admit() {
    const result: unknown = admission();
    if (result !== undefined) { void Promise.resolve(result).catch(() => {}); throw Error('goal_native_admission_sync'); }
  }
  async function runOriginal(input: NativeMutationRun): Promise<GoalNativeMutation> {
    const { sessionId, instanceId, signal } = input;
    signal?.throwIfAborted();
    let row = journal.load(sessionId).find(item => item.id === input.mutationId);
    if (!row) throw Error('goal_native_mutation_missing');
    if (['applied','retired','stale','ready'].includes(row.status)) return row;
    async function basisCurrent() {
      if(row!.kind==='fork'&&goalNativeStateHash((await store.load(row!.forkSource!.snapshot.source.sessionId))?.state??null)!==row!.forkSource!.stateHash)return false;
      const current = (await store.load(sessionId))?.state ?? null;
      return row!.previous ? current !== null && goalNativeStateHash(current) === row!.previous.stateHash : current === null;
    }
    async function beforeNative() {
      signal?.throwIfAborted();
      await ownership.assertOwned(sessionId, instanceId);
      if (!await basisCurrent()) throw Error('goal_native_mutation_basis_changed');
      signal?.throwIfAborted(); admit();
    }
    function save(status: GoalNativeMutation['status']) {
      const next = { ...row!, status, revision: row!.revision + 1, updatedAt: Math.max(now(), row!.updatedAt) };
      journal.put({ sessionId, requestSource: input.requestSource, expectedRevision: row!.revision, next });
      row = next; return next;
    }
    async function enrollment(fresh: boolean) {
      const client = createInstalledVerificationClient();
      try {
        const enrollment = createOwnerEnrollmentClient(client.completionTransport);
        const request = { requestId: row!.enrollmentRequestId,
          enrollment: { ownerKind: 'goal' as const, ownerId: row!.target.goalId, goalSessionId: sessionId, invocations: [] },
          registration: { ...goalVerificationRegistration(row!.definition), ...(row!.forkSource?{source:{kind:'new-owner' as const,fork:row!.forkSource.snapshot.source}}:{}) } };
        if (fresh) {
          await beforeNative(); save('enrolling');
          const prepared = await enrollment.prepareRequest(request, signal);
          if (prepared.created) { await beforeNative(); await enrollment.authorize(prepared.challenge, signal); }
          else fresh = false;
        }
        const recovered = await enrollment.recoverRequest(request, signal);
        if (recovered.state === 'committed') save(await basisCurrent() ? 'enrolled' : 'stale');
        else save('retired');
        return fresh;
      } finally { client.dispose(); }
    }
    async function application(fresh: boolean) {
      const client = createInstalledGoalApplicationClient(row!.target, input.requestSource);
      try {
        if (fresh) {
          await beforeNative(); save('binding');
          const prepared = await client.prepareRequest(row!.applicationRequestId, signal);
          if (prepared.created && !prepared.challenge.alreadyCommitted) {
            await beforeNative(); await client.authorize(prepared.challenge, signal);
          }
        }
        const recovered = await client.recoverRequest(row!.applicationRequestId, signal);
        if (recovered.state === 'committed') {
          const observation = recovered.observation;
          const exact = observation?.state === 'active' && observation.pendingTransitionId === null
            && observation.pendingTarget === null && json(observation.current?.binding) === json(row!.target);
          save(exact && await basisCurrent() ? 'ready' : 'stale');
        } else if (recovered.state !== 'pending') save('retired');
      } finally { client.dispose(); }
    }
    // Reopened in-flight stages can only recover that original request. They
    // never regain the original prepared object or advance into another review.
    if (row.status === 'enrolling') { await enrollment(false); return row; }
    if (row.status === 'binding') { await application(false); return row; }
    if (input.action === 'recover') return row;
    if (row.status === 'reserved' && !await enrollment(true)) return row;
    if (row.status === 'enrolled') await application(true);
    return row;
  }
  return Object.freeze({
    run(raw: NativeMutationRun): Promise<GoalNativeMutation> {
      const { signal, ...data } = raw;
      const input = { ...JSON.parse(json(data)), signal } as NativeMutationRun;
      if (Object.keys(data).sort().join(',') !== 'action,instanceId,mutationId,requestSource,sessionId'
        || !['advance','recover'].includes(input.action)) return Promise.reject(Error('goal_native_mutation_input'));
      if (!['user','scheduler'].includes(input.requestSource) || input.action === 'advance' && input.requestSource !== 'user')
        return Promise.reject(Error('goal_native_mutation_source'));
      for (const value of [input.sessionId,input.mutationId,input.instanceId]) {
        if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 160 || /[\x00-\x1f\x7f]/.test(value))
          return Promise.reject(Error('goal_native_mutation_input'));
      }
      return runOriginal(input);
    },
  });
}
