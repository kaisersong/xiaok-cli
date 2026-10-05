import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { GoalService } from '../runtime/goal/service.js';
import { FileGoalNativeJournal, goalNativeCandidate, goalNativeStateHash, type GoalNativeMutation } from '../runtime/goal/native-mutation-journal.js';
import { createGoalNativeMutationWorkflow } from '../runtime/goal/native-mutation-workflow.js';
import { parseGoalVerificationDefinition } from '../runtime/goal/verification-definition.js';
import { createInstalledGoalApplicationClient } from '../runtime/verification/installed-goal-application.js';
import { goalApplicationFromState } from '../runtime/goal/completion-intent.js';
import type { GoalInput, GoalOwnershipPort, GoalState, GoalStore } from '../runtime/goal/types.js';

/** Read the explicitly selected original contract once, before any native work. */
export function readGoalVerificationFile(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 65536) throw Error('goal_verification_file_limit');
    const bytes = Buffer.alloc(65537); let size = 0, read: number;
    do { read = readSync(fd, bytes, size, bytes.length - size, null); size += read; } while (read && size < bytes.length);
    if (size > 65536) throw Error('goal_verification_file_limit');
    return parseGoalVerificationDefinition(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size))));
  } finally { closeSync(fd); }
}
interface Options {
  store: GoalStore; journal: FileGoalNativeJournal; ownership: GoalOwnershipPort;
  sessionId: string; instanceId: string;
}
interface Result { mutation: GoalNativeMutation; goal: GoalState | null }

/** Owns in-flight native work, never terminal input, activation, or SDK calls.
 * The CLI retains the session lease/heartbeat until each operation settles. */
export class CliGoalNativeHost {
  private generation = 0;
  private closed = false;
  private readonly work = new Set<Promise<unknown>>();
  private readonly signals = new Set<AbortController>();
  private closeDrain?: Promise<void>;
  private readonly writerFailures = new Set<unknown>();
  private readonly cancellationReasons = new Set<unknown>();
  constructor(private readonly options: Options) {}
  latest() { return this.options.journal.load(this.options.sessionId).at(-1) ?? null; }
  get busy() { return this.work.size !== 0; }
  assertNoPending() {
    const row = this.latest();
    if (row && !['applied','retired','stale'].includes(row.status)) throw Error('goal_native_mutation_pending');
  }
  invalidate() {
    this.generation++;
    const reason = Error('goal_native_mutation_superseded');
    this.cancellationReasons.add(reason);
    for (const controller of this.signals) controller.abort(reason);
  }
  async close() {
    if (!this.closeDrain) {
      this.closed = true;
      const original = [...this.work];
      this.closeDrain = Promise.resolve().then(async () => {
        const results = await Promise.allSettled(original);
        const errors = [...new Set([...this.writerFailures, ...results.flatMap(result => result.status === 'rejected' && !this.cancellationReasons.has(result.reason) ? [result.reason] : [])])];
        if (errors.length) throw new AggregateError(errors, 'goal native host physical cleanup failed');
      });
      this.invalidate();
    }
    await this.closeDrain.catch(() => {});
  }
  waitForClosedResources(): Promise<void> {
    return this.closeDrain ?? Promise.reject(Error('goal_native_cleanup_not_started'));
  }
  private run(action: (service: GoalService, admission: () => void, signal: AbortSignal) => Promise<Result>, cancel = false): Promise<Result> {
    if (this.closed) return Promise.reject(Error('goal_native_host_closed'));
    if (!cancel && this.busy) return Promise.reject(Error('goal_native_host_busy'));
    const generation = this.generation, controller = new AbortController(); this.signals.add(controller);
    const admission = () => {
      controller.signal.throwIfAborted();
      if (this.closed || generation !== this.generation) throw Error('goal_native_mutation_superseded');
    };
    const ownership: GoalOwnershipPort = { assertOwned: async (sessionId, instanceId) => {
      admission(); await this.options.ownership.assertOwned(sessionId, instanceId); admission();
    } };
    const service = new GoalService({ store: this.options.store, nativeJournal: this.options.journal, ownership });
    const work = Promise.resolve().then(() => { admission(); return action(service, admission, controller.signal); });
    this.work.add(work);
    void work.then(() => { this.work.delete(work); this.signals.delete(controller); }, error => {
      this.work.delete(work); this.signals.delete(controller);
      if (!this.cancellationReasons.has(error)) this.writerFailures.add(error);
    });
    return work;
  }
  private context(revision: number | null) {
    return { sessionId: this.options.sessionId, instanceId: this.options.instanceId, requestSource: 'user' as const, expectedRevision: revision };
  }
  private async advance(service: GoalService, row: GoalNativeMutation, action: 'advance' | 'recover', admission: () => void, signal: AbortSignal): Promise<Result> {
    const { store, journal, ownership, sessionId, instanceId } = this.options;
    row = await createGoalNativeMutationWorkflow({ store, journal, ownership, assertAdmission: admission }).run({
      sessionId, instanceId, mutationId: row.id, requestSource: 'user', action, signal,
    });
    admission();
    if (row.status === 'ready') {
      const current = (await store.load(sessionId))?.state ?? null; admission();
      if (current && goalNativeStateHash(current) === goalNativeStateHash(goalNativeCandidate(row))) {
        await service.recoverNativeMutationCommit(this.context(current.revision), row.id, signal);
      } else {
        const prepared = await service.prepareNativeMutationCommit(this.context(row.kind === 'replace' ? row.previous!.revision : null), row.id, signal);
        admission(); await prepared.commit();
      }
      admission(); row = journal.load(sessionId).find(item => item.id === row.id)!;
    }
    const goal = (await store.load(sessionId))?.state ?? null; admission();
    return { mutation: row, goal };
  }
  create(kind: 'create' | 'replace', rawInput: GoalInput, rawDefinition: unknown): Promise<Result> {
    const input = structuredClone(rawInput), definition = parseGoalVerificationDefinition(rawDefinition);
    return this.run(async (service, admission, signal) => {
      this.assertNoPending();
      const original = (await this.options.store.load(this.options.sessionId))?.state ?? null; admission();
      let minimumEpoch: number | undefined;
      if (kind === 'replace') {
        if (!original) throw Error('Goal not found');
        const client = createInstalledGoalApplicationClient(goalApplicationFromState(original), 'user');
        try {
          const actual = await client.inspect(signal); admission();
          minimumEpoch = Math.max(original.epoch, actual.current?.binding.epoch ?? 0, actual.pendingTarget?.epoch ?? 0) + 1;
          if (!Number.isSafeInteger(minimumEpoch)) throw Error('goal_native_mutation_epoch');
        } finally { client.dispose(); }
      }
      const current = (await this.options.store.load(this.options.sessionId))?.state ?? null; admission();
      if (goalNativeStateHash(current) !== goalNativeStateHash(original)) throw Error('goal_native_mutation_basis_changed');
      const row = await service.reserveNativeMutation(this.context(kind === 'create' ? null : original!.revision), {
        kind, input, definition, ...(minimumEpoch === undefined ? {} : { minimumEpoch }),
      });
      admission(); return this.advance(service, row, 'advance', admission, signal);
    });
  }
  reserveFork(sourceSessionId:string):Promise<Result>{
    return this.run(async(service,admission,signal)=>{
      this.assertNoPending();const mutation=await service.reserveNativeFork(this.context(null),sourceSessionId,signal);admission();
      return {mutation,goal:null};
    });
  }
  continue() { return this.resume('advance'); }
  recover() { return this.resume('recover'); }
  private resume(action: 'advance' | 'recover') {
    return this.run(async (service, admission, signal) => {
      const row = this.latest(); if (!row) throw Error('goal_native_mutation_missing');
      return this.advance(service, row, action, admission, signal);
    });
  }
  cancel(): Promise<Result> {
    this.invalidate();
    return this.run(async (_service, admission, signal) => {
      const { store, journal, ownership, sessionId, instanceId } = this.options;
      let row = this.latest(); if (!row) throw Error('goal_native_mutation_missing');
      if (['enrolling','binding'].includes(row.status)) {
        row = await createGoalNativeMutationWorkflow({ store, journal, ownership,
          assertAdmission: () => { throw Error('goal_native_mutation_cancelled'); } }).run({
          sessionId, instanceId, mutationId: row.id, requestSource: 'user', action: 'recover', signal,
        });
      }
      admission();
      if (!['applied','retired','stale'].includes(row.status)) {
        const next = { ...row, revision: row.revision + 1, status: row.status === 'ready' ? 'stale' as const : 'retired' as const, updatedAt: Math.max(Date.now(), row.updatedAt) };
        journal.put({ sessionId, requestSource: 'user', expectedRevision: row.revision, next }); row = next;
      }
      return { mutation: row, goal: (await store.load(sessionId))?.state ?? null };
    }, true);
  }
}
