import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as realTimeout, clearTimeout as realClearTimeout } from 'node:timers';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentService, type DesktopHostDeliveryAuthority } from '../../electron/desktop-multi-agent-service.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { InProcessTaskRuntimeHost, type InProcessTaskRuntimeHostOptions, type TaskRunnerInput } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';
import type { HostDeliveryReport } from '../../../src/runtime/task-host/delivery-types.js';

export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof realTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = realTimeout(() => reject(new Error('post-seal fixture boundary was not reached')), 3000);
  })]); } finally { realClearTimeout(timer); }
}
export const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));

// Test-owned protocol declarations describe the frozen contract only. They do
// not validate, classify, persist or recover it on behalf of production.
export interface DeliveryRecordFixture {
  version: 1; revision: number; status: 'checking' | 'passed' | 'failed' | 'unknown';
  stage: 'flush' | 'snapshot' | 'verify' | 'settle' | 'cleanup';
  verification: 'pending' | 'passed' | 'failed'; hostSettlement: 'pending' | 'committed' | 'unknown';
  readerCleanup: 'none' | 'pending' | 'settled'; storeCleanup: 'none' | 'pending' | 'settled';
  startedAt: number; deadlineAt: number; decisionAt?: number; finishedAt?: number;
  hostTerminalStatus?: 'completed' | 'failed';
  guardFailure?: { code: string; stage: string; needsExplicitFollowup: true };
}
export interface DeliveryReportFixture {
  source: { sourceTaskId: string; groupId: string; rootTurnId: string; rootEpoch: number; preparationId: string; bootId: string };
  delivery: DeliveryRecordFixture;
}
export interface DeliveryServiceContract {
  bindHostDeliveryOwner(host: InProcessTaskRuntimeHost): object;
  recordHostDelivery(input: { requestSource: string; authority: object; report: DeliveryReportFixture }): Promise<HostDeliveryReport>;
}
export function deliveryContract(service: DesktopMultiAgentService): DeliveryServiceContract {
  // Methods deliberately remain undefined before implementation. Tests assert
  // the real instance contract, never substitute a fake implementation.
  return service as unknown as DeliveryServiceContract;
}
export const hostDelivery = (snapshot: TaskSnapshot | null) =>
  (snapshot as (TaskSnapshot & { hostDelivery?: DeliveryRecordFixture }) | null)?.hostDelivery;

export async function createPostSealHarness(options: {
  explicit?: boolean; prompt?: string; readOrdinal?: number; watchdogMs?: number;
  emit?: (input: TaskRunnerInput) => Promise<void>; spawnChild?: boolean;
  runnerTail?: () => Promise<void>; report?: (report: DeliveryReportFixture, persist: () => Promise<unknown>) => Promise<unknown>;
  completionGate?: InProcessTaskRuntimeHostOptions['completionGate'];
  /** Explicit presence preserves tests of the existing undefined/false switch. */
  aheGuards?: InProcessTaskRuntimeHostOptions['aheGuards'];
  snapshotStore?: (directory: string) => FileTaskSnapshotStore;
  root?: string;
} = {}) {
  const root = options.root ?? mkdtempSync(join(tmpdir(), 'xiaok-post-seal-bdd-'));
  const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite'));
  const coordinator = new DesktopExecutionCoordinator();
  const readEntered = deferred(); const readRelease = deferred();
  const childEntered = deferred(); const childRelease = deferred<string>();
  const rootSealed = deferred(); const reportEntered = deferred();
  let armed = false; let postRunReads = 0; let runnerCalls = 0; let cancellations = 0;
  let groupId = ''; let childId = ''; let rootSignal: AbortSignal | undefined;
  let readOptions: { signal?: AbortSignal } | undefined;
  let tokenReleases = 0;
  const reports: DeliveryReportFixture[] = [];
  class BarrierStore extends FileTaskSnapshotStore {
    override async recoverTask(taskId: string, internal?: { signal?: AbortSignal }): Promise<TaskSnapshot | null> {
      const snapshot = await super.recoverTask(taskId);
      if (armed && ++postRunReads === options.readOrdinal) {
        readOptions = internal; readEntered.resolve(); await readRelease.promise;
      }
      return snapshot;
    }
  }
  const snapshots = options.snapshotStore?.(join(root, 'tasks')) ?? new BarrierStore(join(root, 'tasks'));
  const service = new DesktopMultiAgentService({ store, coordinator, closeGraceMs: 10,
    createSession: async () => ({ run: async () => { childEntered.resolve(); return childRelease.promise; }, suspend: async () => {}, dispose: async () => {} }),
  });
  service.registerThread({ threadId: 'post-seal-thread', profileId: 'profile', workspaceId: 'workspace', cwd: root });
  let authority: DesktopHostDeliveryAuthority | undefined;
  const hostOptions = Object.assign({ snapshotStore: snapshots,
    materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }),
    taskWatchdogMs: options.watchdogMs ?? 2000,
    aheGuards: Object.hasOwn(options, 'aheGuards') ? options.aheGuards : { artifactEvidence: true },
    authorizePreparation: (taskId, marker) => service.assertHostPreparation(taskId, marker),
    assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot),
    decideCancellation: (snapshot, reason) => { cancellations++; return service.decideHostCancellation(snapshot, reason); },
    getExecutionPolicy: () => ({ deliveryRepair: options.explicit === false ? 'automatic' : 'explicit' }),
    acquireExecutionToken: () => ({ release: () => { tokenReleases++; } }),
    completionGate: options.completionGate,
    runner: async input => {
      runnerCalls++; rootSignal = input.signal;
      const body = async () => { await options.emit?.(input); };
      if (options.explicit === false) await body();
      else await service.runRoot(input, async context => {
        groupId = context.groupId;
        if (options.spawnChild !== false) {
          childId = (await service.spawn({ actor: context.actor, requestSource: 'agent', operationId: `spawn-${input.taskId}`,
            taskName: 'held_child', message: 'Controlled fixture child' })).targetAgentId!;
          await childEntered.promise;
        }
        await body();
      });
      rootSealed.resolve(); await options.runnerTail?.(); armed = true;
    },
  } satisfies InProcessTaskRuntimeHostOptions, {
    onDeliveryReport: async (report: HostDeliveryReport): Promise<HostDeliveryReport> => {
      reports.push(structuredClone(report)); reportEntered.resolve();
      const persist = () => service.recordHostDelivery({ requestSource: 'scheduler', authority: authority!, report });
      // Only this optional fault-injection seam may deliberately return a
      // malformed ACK; the real host must still validate it. Normal fixtures
      // return the actual service's typed durable receipt without a cast.
      if (options.report) return await options.report(report, persist) as HostDeliveryReport;
      return persist();
    },
  });
  const host = new InProcessTaskRuntimeHost(hostOptions);
  const ready = service.initialize(host);
  if (typeof service.bindHostDeliveryOwner === 'function') authority = service.bindHostDeliveryOwner(host);
  await ready;
  return { root, store, service, snapshots, host, reports, rootSealed, readEntered, readRelease, reportEntered,
    get groupId() { return groupId; }, get childId() { return childId; },
    get rootSignal() { return rootSignal; }, get readSignal() { return readOptions?.signal; },
    get postRunReads() { return postRunReads; }, get runnerCalls() { return runnerCalls; },
    get cancellations() { return cancellations; }, get tokenReleases() { return tokenReleases; },
    get authority() { return authority; },
    async start() {
      const input = { prompt: options.prompt ?? 'Explain the result', materials: [] };
      const task = options.explicit === false ? await host.prepareTask(input) : await service.prepareRoot(host, 'post-seal-thread', input);
      await host.startTask(task.taskId); return task.taskId;
    },
    async close() {
      readRelease.resolve(); childRelease.resolve('Fixture child completed');
      await bounded(host.drain()); await service.dispose(); store.close();
      if (!options.root) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}
export type PostSealHarness = Awaited<ReturnType<typeof createPostSealHarness>>;
