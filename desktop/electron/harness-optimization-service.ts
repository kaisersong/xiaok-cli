import {parseSourceIdentity,parseSourceReadInput,dshSourceReadCommandDigest} from './harness-dsh-source-read-budget.mjs';
export {dshSourceReadCommandDigest};
import { randomUUID } from 'node:crypto';
import {captureDispatchBusinessData} from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import {parseOriginalDshBudgetStatus} from './harness-dsh-budget-private-data.js';
import type {OriginalDshBudgetPort,DshBudgetObservationView,DshBudgetAttemptReceiptView,DshBudgetWorkReceiptView,DshDraftBudgetData,DshBudgetWorkSnapshotView,DshBudgetCommitProofView,DshBudgetDraftAttemptReceiptView} from './harness-dsh-budget-private-types.js';
export type {OriginalDshBudgetPort,DshBudgetObservationView,DshBudgetAttemptReceiptView,DshBudgetWorkReceiptView,DshDraftBudgetData,DshBudgetWorkSnapshotView,DshBudgetCommitProofView,DshBudgetDraftAttemptReceiptView} from './harness-dsh-budget-private-types.js';
import { acquireHarnessOwnerLock } from './harness-optimization-owner-lock.js';
import { HarnessOptimizationLifecycle } from './harness-optimization-lifecycle.js';
import type { HarnessCloseIntent } from './harness-optimization-lifecycle.js';
import { HarnessOptimizationStore } from './harness-optimization-store.js';
import type { HarnessStoreState } from './harness-optimization-store.js';
import {prepareOriginalMainDshBudgetWorker,prepareOriginalMainDshBudgetLifecycle} from './main-dsh-bootstrap-authority.js';
import { DEFAULT_HARNESS_OPTIMIZATION_CONFIG, validateHarnessConfigPatch, validateStoredHarnessConfig } from './harness-optimization-config.js';
import { validateRegisteredHarnessManifest } from './harness-research-controller.js';
import type { HarnessAttemptTicket, HarnessResearchManifest, HarnessUserContext, HarnessOptimizationState, HarnessBudgetSnapshot } from './harness-optimization-types.js';
import {dshBudgetCommandDigest,dshRecord,dshInteger,dshHash,dshDigest,parseDshInput,parseDshAuthority,checkDshSource} from './harness-dsh-budget-data.mjs';
import {types as dshTypes} from 'node:util';
import {retainSourceErrorTails} from '../../src/runtime/verification/source-error-tails.js';
import {createIntrinsicSet} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {assertStandardIpcPromise} from '../../src/runtime/verification/native-ipc-promise.js';
export {dshBudgetCommandDigest};
const dshApply=Reflect.apply,dshDescriptor=Object.getOwnPropertyDescriptor,dshOwn=Object.hasOwn,dshDefine=Object.defineProperty,dshCreate=Object.create,dshFreeze=Object.freeze;
const DshPromise=Promise,dshThen=Promise.prototype.then,dshIsProxy=dshTypes.isProxy,dshIsAsync=dshTypes.isAsyncFunction;
const dshPrototype=Object.getPrototypeOf,dshAsyncPrototype=dshPrototype(async()=>{});
const dshSync=(fn:unknown):fn is Function=>typeof fn==='function'&&!dshIsProxy(fn)&&!dshIsAsync(fn)&&dshPrototype(fn)!==dshAsyncPrototype;


type PrivateReceiptKind = 'observation' | 'attempt' | 'work'|'work_snapshot'|'commit_proof'|'draft_attempt';
interface OriginalBudgetRuntime {
    readonly dispose:()=>Promise<void>;
    readonly source: object | undefined;
    readonly port: OriginalDshBudgetPort;
    readonly binding:OriginalDshBudgetRuntimeBinding;
    readonly readSource:object|undefined;readonly readPort:OriginalDshSourceReadPort;
}
interface OriginalBudgetReceipt<T> {
    readonly runtime: OriginalBudgetRuntime;
    readonly view: T;
}
const originalBudgetRuntimes = new WeakMap<object, OriginalBudgetRuntime>();
const originalBudgetPorts = new WeakMap<object, OriginalBudgetRuntime>();
interface CurrentObservationReceipt extends OriginalBudgetReceipt<DshBudgetObservationView> {readonly current:()=>void;readonly unchanged:()=>void}
const originalBudgetObservations = new WeakMap<object, CurrentObservationReceipt>();
/** Current original-owner snapshot only. Never a reservation/Native permit. */
export function assertOriginalDshBudgetObservationCurrent(port:unknown,receipt:unknown):void {
    const runtime=privateBudgetGet(originalBudgetPorts,port),row=privateBudgetGet(originalBudgetObservations,receipt);
    if(!runtime||!row||row.runtime!==runtime)throw Error('dsh_budget_observation_unavailable');
    row.current();
}
/** Pure original mutation/lifetime cut, for an already full-current checked
 * observation inside its caller's SQL phase. This alone grants no authority. */
export function assertOriginalDshBudgetObservationUnchanged(port:unknown,receipt:unknown):void {
    const runtime=privateBudgetGet(originalBudgetPorts,port),row=privateBudgetGet(originalBudgetObservations,receipt);
    if(!runtime||!row||row.runtime!==runtime)throw Error('dsh_budget_observation_unavailable');
    row.unchanged();
}
interface WorkBudgetReceipt extends OriginalBudgetReceipt<DshBudgetWorkReceiptView> {readonly proof:unknown;used:boolean;readonly eligible:boolean;readonly current:()=>void;readonly unchanged:()=>void;}
const originalBudgetWorks=new WeakMap<object,WorkBudgetReceipt>();
export function readOriginalDshDraftAdmission(port:unknown,receipt:unknown):DshBudgetWorkReceiptView {
    const runtime=privateBudgetGet(originalBudgetPorts,port),row=privateBudgetGet(originalBudgetWorks,receipt);
    if(!runtime||!row||row.runtime!==runtime)throw Error('dsh_budget_work_receipt_required');
    return row.view;
}
export function takeOriginalDshDraftAdmission(port:unknown,exactCommandProof:unknown,receipt:unknown):DshDraftBudgetData {
    const runtime=privateBudgetGet(originalBudgetPorts,port),row=privateBudgetGet(originalBudgetWorks,receipt);
    if(!runtime||!row||row.runtime!==runtime||row.proof!==exactCommandProof)throw Error('dsh_budget_work_receipt_required');
    if(row.used||!row.eligible)throw Error('dsh_budget_admission_unavailable');
    row.used=true;row.current();return row.view.data;
}
/** Fixed warm reservation check, not consumption, a balance grant or a
 * historical-to-current upgrade. Membership and exact proof precede Source. */
export function assertOriginalDshDraftAdmissionReserved(port:unknown,exactCommandProof:unknown,receipt:unknown):void {
    const runtime=privateBudgetGet(originalBudgetPorts,port),row=privateBudgetGet(originalBudgetWorks,receipt);
    if(!runtime||!row||row.runtime!==runtime||row.proof!==exactCommandProof||row.used||!row.eligible)throw Error('dsh_budget_admission_unavailable');
    row.current();
    // A synchronous Source callback cannot consume the cap during this check
    // and still let an unconsumed reservation assertion return successfully.
    if(row.used||!row.eligible)throw Error('dsh_budget_admission_unavailable');
}
/** Pure exact warm-cap cut after a full Reserved check outside SQL. No
 * Source call, consumption, balance promise or Native qualification. */
export function assertOriginalDshDraftAdmissionUnchanged(port:unknown,exactCommandProof:unknown,receipt:unknown):void {
    const runtime=privateBudgetGet(originalBudgetPorts,port),row=privateBudgetGet(originalBudgetWorks,receipt);
    if(!runtime||!row||row.runtime!==runtime||row.proof!==exactCommandProof||row.used||!row.eligible)throw Error('dsh_budget_admission_unavailable');
    row.unchanged();
    if(row.used||!row.eligible)throw Error('dsh_budget_admission_unavailable');
}
export function assertOriginalDshDraftAdmissionCurrent(port:unknown,exactCommandProof:unknown,receipt:unknown):void {
    const runtime=privateBudgetGet(originalBudgetPorts,port),row=privateBudgetGet(originalBudgetWorks,receipt);
    if(!runtime||!row||row.runtime!==runtime||row.proof!==exactCommandProof||!row.used||!row.eligible)throw Error('dsh_budget_admission_unavailable');
    row.current();
}
interface OriginalCommitProof extends OriginalBudgetReceipt<DshBudgetCommitProofView> {readonly current:()=>void}
const originalBudgetCommitProofs=new WeakMap<object,OriginalCommitProof>();
/** Immutable original ledger usage only. This metadata is not send permission. */
export function readOriginalDshBudgetCommitProof(port:unknown,receipt:unknown):DshBudgetCommitProofView {
 const runtime=privateBudgetGet(originalBudgetPorts,port),row=privateBudgetGet(originalBudgetCommitProofs,receipt);
 if(!runtime||!row||row.runtime!==runtime)throw Error('dsh_budget_commit_proof_required');
 return row.view;
}
export function assertOriginalDshBudgetCommitProofCurrent(port:unknown,receipt:unknown):void {
 const runtime=privateBudgetGet(originalBudgetPorts,port),row=privateBudgetGet(originalBudgetCommitProofs,receipt);
 if(!runtime||!row||row.runtime!==runtime)throw Error('dsh_budget_commit_proof_required');
 row.current();
}
const originalWorkSnapshots=new WeakMap<object,OriginalBudgetReceipt<DshBudgetWorkSnapshotView>>();
/** Historical original SQL metadata only; never a resumed reservation. */
export function readOriginalDshBudgetWorkSnapshot(port:unknown,receipt:unknown):DshBudgetWorkSnapshotView {
    const runtime=privateBudgetGet(originalBudgetPorts,port),row=privateBudgetGet(originalWorkSnapshots,receipt);
    if(!runtime||!row||row.runtime!==runtime)throw Error('dsh_budget_work_snapshot_required');
    return row.view;
}
const originalBudgetDraftAttempts=new WeakMap<object,OriginalBudgetReceipt<DshBudgetDraftAttemptReceiptView>>();
export function readOriginalDshDraftAttemptReceipt(port:unknown,receipt:unknown):DshBudgetDraftAttemptReceiptView {
 const runtime=privateBudgetGet(originalBudgetPorts,port),row=privateBudgetGet(originalBudgetDraftAttempts,receipt);
 if(!runtime||!row||row.runtime!==runtime)throw Error('dsh_budget_draft_attempt_receipt_required');return row.view;
}
const originalBudgetAttempts = new WeakMap<object, OriginalBudgetReceipt<DshBudgetAttemptReceiptView>>();
const budgetWeakGet = WeakMap.prototype.get, budgetWeakSet = WeakMap.prototype.set;
function privateBudgetGet<T>(table: WeakMap<object, T>, key: unknown): T | undefined {
    return dshApply(budgetWeakGet, table, [key]) as T | undefined;
}
function privateBudgetSet<T>(table: WeakMap<object, T>, key: object, value: T): void {
    dshApply(budgetWeakSet, table, [key, value]);
}
function privateBudgetData(target: object, key: PropertyKey, value: unknown): void {
    dshDefine(target, key, {
        __proto__: null, value, enumerable: true
    } as PropertyDescriptor);
}
/** Membership only. Runtime identity and metadata never authenticate Main or a caller owner. */
export function readOriginalDshBudgetPort(runtime: unknown, exactConstructorSource: unknown): OriginalDshBudgetPort {
    const row = privateBudgetGet(originalBudgetRuntimes, runtime);
    if (!row || !row.source || row.source !== exactConstructorSource) {
        throw Error('dsh_budget_runtime_required');
    }
    return row.port;
}
export interface OriginalDshBudgetRuntimeBinding {
    readonly port:OriginalDshBudgetPort;readonly ownerId:string;readonly profileId:string;readonly workspaceId:string;
    /** Original runtime lifetime/Source-failure only; not an account balance or Native authority. */
    readonly assertCurrent:()=>void;readonly assertLocal:()=>void;
}
export function readOriginalDshBudgetRuntimeBinding(runtime:unknown,exactConstructorSource:unknown):OriginalDshBudgetRuntimeBinding {
    const row=privateBudgetGet(originalBudgetRuntimes,runtime);
    if(!row||!row.source||row.source!==exactConstructorSource)throw Error('dsh_budget_runtime_required');
    row.binding.assertLocal();return row.binding;
}
/** Original negative lifetime method only. It grants no account/effect and
 * remains available after retirement; never read a mutable public method. */
export function readOriginalDshBudgetRuntimeDisposal(runtime:unknown,exactConstructorSource:unknown):Readonly<{dispose():Promise<void>}> {
    const row=privateBudgetGet(originalBudgetRuntimes,runtime);
    if(!row||!row.source||row.source!==exactConstructorSource)throw Error('dsh_budget_runtime_required');
    const result=dshCreate(null);privateBudgetData(result,'dispose',row.dispose);return dshFreeze(result) as Readonly<{dispose():Promise<void>}>;
}
export function readOriginalDshBudgetObservation(port: unknown, receipt: unknown): DshBudgetObservationView {
    const runtime = privateBudgetGet(originalBudgetPorts, port), row = privateBudgetGet(originalBudgetObservations, receipt);
    if (!runtime || !row || row.runtime !== runtime) {
        throw Error('dsh_budget_observation_required');
    }
    return row.view;
}
export function readOriginalDshBudgetAttemptReceipt(port: unknown, receipt: unknown): DshBudgetAttemptReceiptView {
    const runtime = privateBudgetGet(originalBudgetPorts, port), row = privateBudgetGet(originalBudgetAttempts, receipt);
    if (!runtime || !row || row.runtime !== runtime) {
        throw Error('dsh_budget_attempt_receipt_required');
    }
    return row.view;
}
export interface OriginalDshSourceReadPort {
    migrateSetup(input:unknown,proof:object):Promise<unknown>;
    openScan(input:unknown,proof:object):Promise<unknown>;
    reserveRequest(input:unknown,proof:object):Promise<object>;
    settleRequest(reservation:object,proof:object):Promise<unknown>;
}
export interface DshSourceReadReservationView {
    readonly disposition:'newly_reserved'|'existing';
    readonly accountId:string;readonly scanId:string;readonly attemptId:string;readonly requestDigest:string;
    readonly responseBytesUpperBound:number;readonly timeoutMs:number;readonly deadline:number;
}
interface SourceReadReservation {cap:object;runtime:OriginalBudgetRuntime;proof:object;view:DshSourceReadReservationView;used:boolean;eligible:boolean;current:()=>void;identity:unknown;actor:unknown;}
const originalSourceReadReservations=new WeakMap<object,SourceReadReservation>();
export function readOriginalDshSourceReadPort(runtime:unknown,exactConstructorSource:unknown):OriginalDshSourceReadPort {
    const row=privateBudgetGet(originalBudgetRuntimes,runtime);
    if(!row||!row.readSource||row.readSource!==exactConstructorSource)throw Error('dsh_source_budget_runtime_required');
    return row.readPort;
}
export function readOriginalDshSourceReadReservation(port:unknown,cap:unknown):DshSourceReadReservationView {
    const runtime=privateBudgetGet(originalBudgetPorts,port),row=privateBudgetGet(originalSourceReadReservations,cap);
    if(!runtime||!row||row.runtime!==runtime||runtime.readPort!==port)throw Error('dsh_source_reservation_required');
    return row.view;
}
export function takeOriginalDshSourceReadReservation(port:unknown,proof:unknown,cap:unknown):DshSourceReadReservationView {
    const runtime=privateBudgetGet(originalBudgetPorts,port),row=privateBudgetGet(originalSourceReadReservations,cap);
    if(!runtime||!row||row.runtime!==runtime||runtime.readPort!==port||row.proof!==proof)throw Error('dsh_source_reservation_required');
    if(row.used||!row.eligible)throw Error('dsh_source_reservation_unavailable');
    row.used=true;row.current();return row.view;
}
interface Options {
  dataRoot: string; profileId: string; workspaceId: string;
  authorizeUser(context: HarnessUserContext): boolean;
  manifestLookup(id: string): HarnessResearchManifest | undefined;
  now?: () => number;
  dshBudgetAuthoritySource?:object;
  dshSourceReadAuthoritySource?:object;
  originalCoreLease?:object;
}
interface CloseOperation {
  intent: HarnessCloseIntent; journalAck: boolean; phase: 'working' | 'closed' | 'failed';
  work: Promise<unknown>; result?: unknown;
}
export async function createHarnessOptimizationRuntime(options: Options) {
  const now = options.now ?? Date.now;
  const dshProfileId=options.profileId,dshWorkspaceId=options.workspaceId;
  let originalBudgetRuntime: OriginalBudgetRuntime | undefined;
  const accountMutations=new Map<string,{revision:number;pending:number}>();
  const mutationGet=Map.prototype.get,mutationSet=Map.prototype.set;
  const mutationFor=(id:string)=>{
      let row=dshApply(mutationGet,accountMutations,[id]) as {revision:number;pending:number}|undefined;
      if(!row){row={__proto__:null,revision:0,pending:0} as {revision:number;pending:number};dshApply(mutationSet,accountMutations,[id,row]);}
      return row;
  };
  const sourceOption = dshDescriptor(options, 'dshBudgetAuthoritySource');
  const dshSource = sourceOption && dshOwn(sourceOption, 'value') ? sourceOption.value : undefined;
  const resolveRow = dshSource && typeof dshSource === 'object' && !dshIsProxy(dshSource) ? dshDescriptor(dshSource, 'resolve') : undefined;
  const dshResolve = resolveRow && dshOwn(resolveRow, 'value') && dshSync(resolveRow.value) ? resolveRow.value : undefined;
  const readOption=dshDescriptor(options,'dshSourceReadAuthoritySource');
  const readSource=readOption&&dshOwn(readOption,'value')?readOption.value:undefined;
  const readResolveRow=readSource&&typeof readSource==='object'&&!dshIsProxy(readSource)?dshDescriptor(readSource,'resolve'):undefined;
  const readResolve=readResolveRow&&dshOwn(readResolveRow,'value')&&dshSync(readResolveRow.value)?readResolveRow.value:undefined;
  let readSourceFailed=false,readFailure:unknown;
  const dshObserved = createIntrinsicSet<unknown>(), dshUnknown = createIntrinsicSet<unknown>(), dshTails = createIntrinsicSet<object>(), dshRoots=createIntrinsicSet<object>(),dshWaiters = createIntrinsicSet<() => void>();
  let dshSourceFailed = false, dshSourceFailure: unknown;
  const dshNotify = () => {
      const rows = dshWaiters.snapshot();
      for (let i = 0; i < rows.length; i++) {
          const row = rows[i]!;
          dshWaiters.delete(row);
          row();
      }
  };
  const dshFailSource = (raw: unknown) => {
      if (!dshSourceFailed) {
          dshSourceFailed = true;
          dshSourceFailure = raw;
      }
      dshInventory(raw);
  };
  function dshInventory(value: unknown): void {
      retainSourceErrorTails(value, (raw, kind) => {
          if (kind === 'unknown') {
              dshUnknown.add(raw);
              return;
          }
          if (dshObserved.has(raw))
              return;
          dshObserved.add(raw);
          const row = dshCreate(null);
          dshTails.add(row);
          try {
              assertStandardIpcPromise(raw, 'dsh_budget_source_unconfirmed');
              const done = (outcome: unknown) => {
                  try {
                      dshInventory(outcome);
                  }
                  catch (error) {
                      dshUnknown.add(error);
                  }
                  finally {
                      dshTails.delete(row);
                      dshNotify();
                  }
              };
              dshApply(dshThen, raw, [done, done]);
          }
          catch (error) {
              dshUnknown.add(raw);
              dshUnknown.add(error);
              dshTails.delete(row);
              dshNotify();
          }
      });
  }
  async function dshDrainSource(): Promise<void> {
      while (dshRoots.size || dshTails.size)
          await new DshPromise<void>(resolve => {
              dshWaiters.add(resolve);
              if (!dshRoots.size && !dshTails.size) {
                  dshWaiters.delete(resolve);
                  resolve();
              }
          });
      if (dshUnknown.size)
          throw Error('dsh_budget_source_unconfirmed', {
              cause: dshSourceFailure
          });
      if (dshSourceFailed)
          throw Error('dsh_budget_source_failed', {
              cause: dshSourceFailure
          });
  }
  let lock: ReturnType<typeof acquireHarnessOwnerLock> | undefined;
  let lifecycle: HarnessOptimizationLifecycle | undefined, witness: Awaited<ReturnType<HarnessOptimizationLifecycle['prepare']>>['witness'] | undefined;
  let store: HarnessOptimizationStore | undefined, state: HarnessStoreState | undefined;
  let unavailable = false, reason = 'optimization_unavailable', disposed = false, clockBlocked = false, budgetPending = 0, admissionSeq = 0;
  let disposePromise: Promise<void> | undefined;
  const tickets = new WeakSet<object>();
  const ticketControllers = new Map<string, { ticket: HarnessAttemptTicket; controller: AbortController }>();
  const runs = new Map<string, { manifestId: string; revoked: boolean }>();
  const operations = new Map<string, CloseOperation>();
  const knownSends = new Set<string>();
  const authority = (ctx: HarnessUserContext) => {
    if (!ctx || ctx.requestSource !== 'user' || !options.authorizeUser(ctx)) throw new Error('actor_forbidden');
  };
  const ready = () => { if (disposed || unavailable || !state || !store || !lock?.held()) throw new Error('optimization_unavailable'); };
  const publish = (value: HarnessStoreState) => { validateStoredHarnessConfig(value.config); state = value; clockBlocked ||= value.clockGuard; };
  const scopeMatches = (op: CloseOperation, runId: string) => !op.intent.manifestId || runs.get(runId)?.manifestId === op.intent.manifestId;
  const blocked = (runId?: string) => budgetPending > 0 || [...operations.values()].some(op => op.phase !== 'closed' && (!runId || scopeMatches(op, runId)));
  const checkTime = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('clock_invalid');
    if (state && value < state.highWaterMark - 2000) {
      clockBlocked = true;
      queueMicrotask(() => { void store?.call('observe_time', { now: value }).catch(() => { unavailable = true; }); });
    }
    if (clockBlocked) throw new Error('clock_rollback');
    return value;
  };
  const manifest = (id: string) => {
    ready();
    return validateRegisteredHarnessManifest(options.manifestLookup(id), {
      ownerId: state!.ownerId, profileId: options.profileId, workspaceId: options.workspaceId,
    }, checkTime());
  };
  try {
    lock = acquireHarnessOwnerLock(options.dataRoot);
    lifecycle = new HarnessOptimizationLifecycle(lock);
    const prepared = options.originalCoreLease?await prepareOriginalMainDshBudgetLifecycle(options.originalCoreLease,lifecycle):await lifecycle.prepare(); witness = prepared.witness;
    const protectedBirth=options.originalCoreLease?await prepareOriginalMainDshBudgetWorker(options.originalCoreLease,prepared):undefined;
    store = new HarnessOptimizationStore({ dbPath: lifecycle.dbPath, root: lock.root, identity: lock.identity,
      ownerId: witness.ownerId, initOperationId: witness.initOperationId, initializing: prepared.initializing,
      now: now(), defaultConfig: structuredClone(DEFAULT_HARNESS_OPTIMIZATION_CONFIG),profileId:dshProfileId,workspaceId:dshWorkspaceId }, () => { unavailable = true; },protectedBirth);
    publish(await store.ready);
    await lifecycle.ready(witness);
    for (const intent of await lifecycle.journals()) {
      if (intent.ownerId !== witness.ownerId) throw new Error('journal_owner_mismatch');
      await store.call('revoke', intent); await lifecycle.clearJournal(intent.operationId);
    }
    publish(await store.call<HarnessStoreState>('activate', { dirty: prepared.previousDirty }));
  } catch (error) {
    unavailable = true;
    reason = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'optimization_unavailable';
    try { await store?.dispose(); } catch {} lock?.release();
  }

  async function startClose(op: CloseOperation) {
    op.phase = 'working';
    op.work = (async () => {
      try {
        if (!op.journalAck) { await lifecycle!.writeJournal(op.intent); op.journalAck = true; }
        const summary = await store!.call('revoke', op.intent);
        publish(await store!.call<HarnessStoreState>('read'));
        await lifecycle!.clearJournal(op.intent.operationId);
        op.phase = 'closed'; op.result = { phase: 'closed', ...summary as object };
        return op.result;
      } catch { op.phase = 'failed'; return { phase: 'close_persistence_failed', operationId: op.intent.operationId }; }
    })();
  }
  async function revoke(input: { scope: 'all' | 'research'; manifestId?: string }, ctx: HarnessUserContext, disable = false): Promise<unknown> {
    authority(ctx); ready();
    if (!input || !['all', 'research'].includes(input.scope) || Object.keys(input).some(k => !['scope', 'manifestId'].includes(k))
      || (input.scope === 'all' && input.manifestId !== undefined)
      || (input.manifestId !== undefined && !/^[a-zA-Z0-9_-]{1,128}$/.test(input.manifestId))) throw new Error('revoke_invalid');
    const key = `${input.scope}:${input.manifestId ?? ''}:${disable}`;
    let op = operations.get(key);
    if (!op || op.phase === 'closed') {
      admissionSeq++;
      const intent: HarnessCloseIntent = { ...input, ownerId: state!.ownerId, ownerEpoch: state!.ownerEpoch, operationId: randomUUID(), disable, knownSends: [...knownSends] };
      op = { intent, journalAck: false, phase: 'working', work: Promise.resolve() }; operations.set(key, op);
      for (const [runId, r] of runs) if (!input.manifestId || r.manifestId === input.manifestId) {
        r.revoked = true;
        for (const value of ticketControllers.values()) if (value.ticket.runId === runId) value.controller.abort();
      }
      void startClose(op);
    } else if (op.phase === 'failed') void startClose(op);
    const active = op;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([active.work, new Promise(resolve => {
        timeout = setTimeout(() => resolve({ phase: active.journalAck ? 'closing_pending' : 'close_persistence_failed', operationId: active.intent.operationId }), 1000);
      })]);
    } finally { if (timeout) clearTimeout(timeout); }
  }
  const api = {
    async read(): Promise<HarnessOptimizationState> {
      if (unavailable || disposed || !state) return { status: 'unavailable', publicStatus: 'unavailable', reason };
      return structuredClone({ status: 'ready' as const, publicStatus: 'unavailable' as const,
        ownerId: state.ownerId, ownerEpoch: state.ownerEpoch, config: state.config, recoveryGuard: state.recoveryGuard,
        dispatchBlocked: blocked() || clockBlocked,
        highWaterMark: state.highWaterMark,
        closeOperations: [...operations.values()].map(op => ({ operationId: op.intent.operationId, phase: op.phase, journalAcknowledged: op.journalAck })) });
    },
    async saveConfig(input: unknown, ctx: HarnessUserContext) {
      authority(ctx); ready(); const patch = validateHarnessConfigPatch(input);
      const lower = Object.entries(patch).some(([key, value]) => ['maxExtraRequestTokensPerUtcDay', 'maxExtraRequestsPerUtcDay', 'maxTotalOptimizationTokensPerUtcDay'].includes(key)
        && typeof value === 'number' && value < (state!.config as unknown as Record<string, number>)[key]);
      if (lower) {
        budgetPending++; admissionSeq++;
        for (const r of runs.values()) r.revoked = true;
        for (const value of ticketControllers.values()) value.controller.abort();
      }
      try { publish(await store!.call<HarnessStoreState>('save_config', { patch })); return api.read(); }
      catch (error) { if (lower) unavailable = true; throw error; }
      finally { if (lower) budgetPending--; }
    },
    async setEnabled(enabled: boolean, ctx: HarnessUserContext) {
      authority(ctx); ready(); if (typeof enabled !== 'boolean') throw new Error('invalid_config');
      if (enabled) { if (blocked()) throw new Error('closing_pending'); throw new Error('public_unavailable'); }
      const active = [...operations.values()].find(op => op.intent.disable && op.phase !== 'closed');
      if (!state!.config.enabled && !active) return { noOp: true };
      return revoke({ scope: 'all' }, ctx, true);
    },
    async issueResearchIntent(input: { manifestId: string }, ctx: HarnessUserContext) {
      authority(ctx); ready(); if (blocked()) throw new Error('closing_pending');
      const m = manifest(input.manifestId);
      return store!.call<{ requestId: string }>('intent', { manifest: m, now: checkTime() });
    },
    async startResearch(input: { manifestId: string; requestId: string }, ctx: HarnessUserContext) {
      authority(ctx); ready(); if (blocked()) throw new Error('closing_pending');
      const m = manifest(input.manifestId), seq = admissionSeq;
      const result = await store!.call<{ runId: string }>('start', { manifest: m, requestId: input.requestId, now: checkTime() });
      if (admissionSeq !== seq || blocked()) { await store!.call('cancel_run', result); throw new Error('admission_changed'); }
      runs.set(result.runId, { manifestId: m.id, revoked: false }); return result;
    },
    revoke,
    async resetClockGuard(input: { expectedHighWaterMark: number; correctionEventId?: string }, ctx: HarnessUserContext) {
      authority(ctx); ready(); if (!input || Object.keys(input).some(k => !['expectedHighWaterMark', 'correctionEventId'].includes(k))
        || !Number.isSafeInteger(input.expectedHighWaterMark) || (input.correctionEventId !== undefined && typeof input.correctionEventId !== 'string')) throw new Error('clock_reset_forbidden');
      publish(await store!.call<HarnessStoreState>('reset_clock', { ...input, now: now() })); clockBlocked = false; return api.read();
    },
  };
  const driver = {
    async prepareAttempt(input: { runId: string; stepId: string; bodyHash: string }) {
      ready(); if (blocked(input.runId) || runs.get(input.runId)?.revoked) throw new Error('grant_revoked');
      const ticket = await store!.call<HarnessAttemptTicket>('prepare', { ...input, now: checkTime() });
      if (blocked(input.runId) || runs.get(input.runId)?.revoked) throw new Error('grant_revoked');
      Object.freeze(ticket); tickets.add(ticket); ticketControllers.set(ticket.invocationId, { ticket, controller: new AbortController() }); return ticket;
    },
    async send(ticket: HarnessAttemptTicket, dispatch: (signal: AbortSignal) => unknown) {
      ready(); if (!tickets.has(ticket)) throw new Error('ticket_invalid');
      if (blocked(ticket.runId) || runs.get(ticket.runId)?.revoked) throw new Error('grant_revoked');
      checkTime();
      tickets.delete(ticket);
      publish(await store!.call<HarnessStoreState>('marker', { ticket, now: checkTime() }));
      const control = ticketControllers.get(ticket.invocationId)!;
      // Pure memory compare-and-send. No await or I/O until after dispatch.
      const dispatchTime = checkTime();
      if (dispatchTime > ticket.latestSendAt || new Date(dispatchTime).toISOString().slice(0, 10) !== ticket.utcDay) throw new Error('research_expired');
      if (!lock!.held() || unavailable || disposed || blocked(ticket.runId) || runs.get(ticket.runId)?.revoked
        || control.controller.signal.aborted || ticket.ownerEpoch !== state!.ownerEpoch || ticket.researchGeneration !== state!.config.researchGeneration) throw new Error('grant_revoked');
      knownSends.add(ticket.invocationId);
      const result = dispatch(control.controller.signal);
      void store!.call('send_started', { invocationId: ticket.invocationId }).catch(() => { unavailable = true; });
      return result;
    },
    async settle(input: { invocationId: string; inputTokens: number; outputTokens: number }) {
      ready(); if (![input.inputTokens, input.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1000000000)) throw new Error('usage_invalid');
      publish(await store!.call<HarnessStoreState>('settle', input));
    },
    async audit() { ready(); return store!.call<{ budget: HarnessBudgetSnapshot; [key: string]: unknown }>('audit'); },
  };
  function dispose(): Promise<void> {
    if (!disposePromise) disposePromise = (async () => {
      disposed = true; admissionSeq++;
      for (const value of ticketControllers.values()) value.controller.abort();
      let dshCloseFailure:unknown,dshCloseFailed=false;
      try{await dshDrainSource();}catch(error){dshCloseFailed=true;dshCloseFailure=error;}
      try {
        await Promise.all([...operations.values()].map(op => op.work));
        await store?.dispose();
        if (!unavailable && !dshSourceFailed&&[...operations.values()].every(op => op.phase === 'closed') && witness) await lifecycle!.clean(witness);
      } finally { lock?.release(); }
      if(dshCloseFailed)throw dshCloseFailure;
    })();
    return disposePromise;
  }
  async function dshCall(command: string, purpose: string, input: unknown, context: unknown, receiptKind?: PrivateReceiptKind) {
      ready();
      if (dshSourceFailed)
          throw Error('dsh_budget_source_unconfirmed');
      if (!dshResolve)
          throw Error('dsh_actor_forbidden');
      let mutation:{revision:number;pending:number}|undefined,mutationRevision=0;
      let observationCut:{holder:{revision:number;pending:number};revision:number;eligible:boolean}|undefined;
      const callRoot = dshCreate(null);
      dshRoots.add(callRoot);
      try {
          // The fixed Source checks its private membership before any context/input
          // field is read. This hook is not a Main-role or transport grant.
          let raw: unknown;
          try {
              raw = dshApply(dshResolve, dshSource, [context, purpose]);
          }
          catch (error) {
              dshFailSource(error);
              throw error;
          }
          if (raw === null)
              throw Error('dsh_actor_forbidden');
          let fields: Record<string, unknown>;
          try {
              const withLocal=!!raw&&typeof raw==='object'&&!dshIsProxy(raw)&&!!dshDescriptor(raw,'assertLocal');
              fields = dshRecord(raw, withLocal?['requestSource', 'actor', 'profileId', 'workspaceId', 'tenantId', 'mandateId', 'mandateRevision', 'authorizationEpoch', 'authorityHash', 'commandDigest', 'assertCurrent','assertLocal']:['requestSource', 'actor', 'profileId', 'workspaceId', 'tenantId', 'mandateId', 'mandateRevision', 'authorizationEpoch', 'authorityHash', 'commandDigest', 'assertCurrent']);
          }
          catch (error) {
              dshFailSource(raw);
              dshFailSource(error);
              throw error;
          }
          const guard = fields.assertCurrent;
          if (!dshSync(guard)||fields.assertLocal!==undefined&&!dshSync(fields.assertLocal)) {
              dshFailSource(raw);
              throw Error('dsh_actor_forbidden');
          }
          const localGuard=fields.assertLocal;
          const sourceLocal=()=>{
              if(localGuard===undefined)return;
              const root=dshCreate(null);dshRoots.add(root);
              try {
                  ready();
                  const value=dshApply(localGuard,undefined,[]);
                  privateBudgetData(root,'raw',value);
                  if(value!==undefined){dshFailSource(value);throw Error('dsh_budget_source_unconfirmed');}
                  ready();
              }catch(error){privateBudgetData(root,'failure',error);dshInventory(error);throw error;}
              finally{dshRoots.delete(root);dshNotify();}
          };
          const current = () => {
              ready();
              if (dshSourceFailed)
                  throw Error('dsh_budget_source_unconfirmed');
              let value: unknown;
              try {
                  value = dshApply(guard, undefined, []);
              }
              catch (error) {
                  dshFailSource(error);
                  throw error;
              }
              if (value !== undefined) {
                  dshFailSource(value);
                  throw Error('dsh_actor_forbidden');
              }
              if (dshSourceFailed)
                  throw Error('dsh_budget_source_unconfirmed');
              ready();
          };
          current();
          const sourceData = dshCreate(null);
          for (const name of ['requestSource', 'profileId', 'workspaceId', 'tenantId', 'mandateId', 'mandateRevision', 'authorizationEpoch', 'authorityHash', 'commandDigest'])
              privateBudgetData(sourceData,name,fields[name]);
          let authority: Readonly<Record<string, unknown>>;
          try {
              authority = parseDshAuthority(sourceData);
          }
          catch (error) {
              dshFailSource(raw);
              dshFailSource(error);
              throw error;
          }
          checkDshSource(purpose, authority);
          if (authority.profileId !== dshProfileId || authority.workspaceId !== dshWorkspaceId)
              throw Error('dsh_actor_forbidden');
          if (authority.requestSource !== 'user' && fields.actor !== null) {
              dshFailSource(fields.actor);
              throw Error('dsh_actor_forbidden');
          }
          if (authority.requestSource === 'user') {
              if (!fields.actor || typeof fields.actor !== 'object' || dshIsProxy(fields.actor) || dshTypes.isPromise(fields.actor)) {
                  dshFailSource(fields.actor);
                  throw Error('dsh_actor_forbidden');
              }
              let allowed: unknown;
              try {
                  allowed = options.authorizeUser(fields.actor as HarnessUserContext);
              }
              catch (error) {
                  dshFailSource(error);
                  throw error;
              }
              if (typeof allowed !== 'boolean') {
                  dshFailSource(allowed);
                  throw Error('dsh_actor_forbidden');
              }
              if (!allowed) {
                  dshFailSource(fields.actor);
                  throw Error('dsh_actor_forbidden');
              }
          }
          const data = parseDshInput(purpose, input);
          if(receiptKind==='attempt'||receiptKind==='draft_attempt') {
              const operation=data.operation as Readonly<Record<string,unknown>>;
              if(receiptKind==='draft_attempt'){if(operation.purpose!=='draft'||typeof operation.workId!=='string'||!operation.workId)throw Error('dsh_draft_attempt_required');}else if(operation.purpose==='draft'||operation.workId!==null)throw Error('dsh_workless_attempt_required');
          }
          if (dshBudgetCommandDigest(purpose, data) !== authority.commandDigest)
              throw Error('dsh_actor_forbidden');
          if(purpose!=='read'&&purpose!=='work_read') {mutation=mutationFor(data.accountId as string);mutationRevision=++mutation.revision;mutation.pending++;}
          ready();
          current();
          // Cleanup records an already owned fact. It never needs a new deadline
          // or send authority, and must still work when the clock is unavailable.
          let timestamp = 0;
          if (purpose === 'open' || purpose === 'reserve' || purpose === 'marker' || purpose === 'work_policy' || purpose==='work_policy_sync' || purpose === 'work_reserve') {
              try {
                  timestamp = now();
              }
              catch (error) {
                  dshFailSource(error);
                  throw error;
              }
              try { dshInteger(timestamp, 0, 1e15); }
              catch (error) {
                  dshFailSource(timestamp);
                  throw error;
              }
          }
          current();
          let response: {
              result: unknown;
              ownerState: HarnessStoreState;
          };
          if(receiptKind==='observation'){
              const holder=mutationFor(data.accountId as string);
              observationCut={holder,revision:holder.revision,eligible:holder.pending===0};
          }
          try {
              const workerRaw=store!.call<{result:unknown;ownerState:HarnessStoreState}>(command, {
                  input: data, authority, now: timestamp
              }, () => {
                  // This last check is local; no Source callback or clock runs
                  // between it and the original worker post.
                  ready();
                  if (dshSourceFailed)
                      throw Error('dsh_budget_source_unconfirmed');
              });
              privateBudgetData(callRoot,'workerRaw',workerRaw);
              if(receiptKind) {
                  try {assertStandardIpcPromise(workerRaw,'dsh_budget_worker_unconfirmed');}
                  catch(error){dshFailSource(workerRaw);throw error;}
              }
              response=await workerRaw;
          }
          catch (error) {
              if (error && typeof error === 'object' && dshDescriptor(error, 'message')?.value === 'clock_rollback')
                  clockBlocked = true;
              throw error;
          }
          if(receiptKind){privateBudgetData(callRoot,'workerResponse',response);dshInventory(response);}
          publish(response.ownerState);
          ready();
          current();
          if (!receiptKind) {
              return response.result;
          }
          if(receiptKind==='commit_proof') {
              const value=dshRecord(captureDispatchBusinessData(response.result,raw=>dshFailSource(raw)),['schemaVersion','kind','issuerDomain','proof','eligible']);
              const proof=dshRecord(value.proof,['proofId','budgetOwnerId','reservationRef','operationKey','ownerWorkId','bindingId','inputManifestHash','finalizedUsageRevision','validUntil','receiptDigest','chargedBasis','ledgerRevision']);
              if(value.schemaVersion!==1||value.kind!=='draft_commit_proof'||value.issuerDomain!==data.accountId||typeof value.eligible!=='boolean'||proof.budgetOwnerId!==state!.ownerId||proof.reservationRef!==data.reservationId||proof.operationKey!==data.operationKey||proof.ownerWorkId!==data.ownerWorkId||proof.bindingId!==data.bindingId||proof.inputManifestHash!==data.inputManifestHash)throw Error('dsh_budget_commit_proof_required');
              dshInteger(proof.finalizedUsageRevision,1);dshInteger(proof.ledgerRevision,1);
              current();ready();if(!originalBudgetRuntime)throw Error('dsh_budget_commit_proof_required');
              const held=mutation!,revision=mutationRevision,eligible=value.eligible;
              const checkCut=()=>{ready();if(!eligible||dshSourceFailed||dshUnknown.size||held.pending!==0||held.revision!==revision)throw Error('dsh_budget_commit_unavailable');};
              const delivery=()=>{const root=dshCreate(null);dshRoots.add(root);try{checkCut();current();sourceLocal();checkCut();}finally{dshRoots.delete(root);dshNotify();}};
              const receipt=dshFreeze(dshCreate(null));
              const view=captureDispatchBusinessData({issuerDomain:value.issuerDomain,proof}) as unknown as DshBudgetCommitProofView;
              privateBudgetSet(originalBudgetCommitProofs,receipt,{runtime:originalBudgetRuntime,view,current:delivery});return receipt;
          }
          if(receiptKind==='work_snapshot') {
              const value=dshRecord(captureDispatchBusinessData(response.result,raw=>dshFailSource(raw)),['schemaVersion','kind','accountId','state','reservation','head','attestation','commandReceipt','closureBasis','status']);
              if(value.schemaVersion!==1||value.kind!=='work_snapshot'||value.accountId!==data.accountId||value.state!=='not_observed'&&value.state!=='observed')throw Error('dsh_budget_work_snapshot_required');
              const status=parseOriginalDshBudgetStatus(value.status);
              if(status.account.account_id!==data.accountId||status.account.owner_id!==state!.ownerId)throw Error('dsh_budget_work_snapshot_required');
              if(value.state==='not_observed'&&(value.reservation!==null||value.head!==null||value.attestation!==null||value.commandReceipt!==null||value.closureBasis!==null))throw Error('dsh_budget_work_snapshot_required');
              if(value.state==='observed'){
                  if(!value.reservation||!value.head||!value.closureBasis)throw Error('dsh_budget_work_snapshot_required');
                  const closureBasis=dshRecord(value.closureBasis,['commandReceiptsHash','usageHash']);dshHash(closureBasis.commandReceiptsHash);dshHash(closureBasis.usageHash);
                  const reservation=value.reservation as Record<string,unknown>,head=value.head as Record<string,unknown>;
                  if(reservation.account_id!==data.accountId||reservation.binding_id!==data.bindingId||reservation.generation!==data.generation||head.reservation_id!==reservation.reservation_id)throw Error('dsh_budget_work_snapshot_required');
                  if(value.attestation){const at=value.attestation as Record<string,unknown>;if(at.reservation_id!==reservation.reservation_id||at.operation_key!==data.operationKey||at.semantic_payload_hash!==data.semanticPayloadHash||at.purpose!==data.purpose)throw Error('dsh_budget_work_snapshot_required');}
              }
              current();ready();if(!originalBudgetRuntime)throw Error('dsh_budget_work_snapshot_required');
              const view=captureDispatchBusinessData({...value,status}) as unknown as DshBudgetWorkSnapshotView,receipt=dshFreeze(dshCreate(null));
              privateBudgetSet(originalWorkSnapshots,receipt,{runtime:originalBudgetRuntime,view});return receipt;
          }
          if(receiptKind==='work') {
              let frozen:DshBudgetWorkReceiptView;
              try {
                  const value=dshRecord(captureDispatchBusinessData(response.result,raw=>dshFailSource(raw)),['schemaVersion','kind','disposition','reservation','head','attestation','status']);
                  if(value.schemaVersion!==1||value.kind!=='work_reservation_receipt'||value.disposition!=='newly_reserved'&&value.disposition!=='existing')throw Error('dsh_budget_receipt_unconfirmed');
                  const reservation=dshRecord(value.reservation,['reservation_id','account_id','binding_id','generation','scope_json','scope_hash','thread_json','thread_hash','initial_tokens','initial_cost','max_draft_requests','deadline','birth_hash']);
                  const head=dshRecord(value.head,['reservation_id','revision','state','owner_work_id','available_tokens','available_cost','held_tokens','held_cost','spent_tokens','spent_cost','released_tokens','released_cost','overrun_tokens','overrun_cost','next_sequence','charged_requests','closure_receipt_hash']);
                  const at=dshRecord(value.attestation,['attestation_id','reservation_id','operation_key','semantic_payload_hash','assessment_ref','purpose','issuer_domain','authority_hash','owner_epoch','valid_until','payload_hash']);
                  const cmd=data.command as Record<string,unknown>;
                  if(reservation.account_id!==data.accountId||reservation.binding_id!==data.bindingId||reservation.generation!==data.generation||reservation.initial_tokens!==data.initialTokens||reservation.initial_cost!==data.initialCostMicros||reservation.deadline!==data.deadline||head.reservation_id!==reservation.reservation_id||at.reservation_id!==reservation.reservation_id||at.operation_key!==cmd.operationKey||at.semantic_payload_hash!==cmd.semanticPayloadHash||at.assessment_ref!==cmd.assessmentRef||at.purpose!==cmd.purpose||at.issuer_domain!==data.accountId||at.authority_hash!==authority.authorityHash)throw Error('dsh_budget_receipt_unconfirmed');
                  const status=parseOriginalDshBudgetStatus(value.status);
                  if(status.account.owner_id!==state!.ownerId||status.account.account_id!==data.accountId)throw Error('dsh_budget_receipt_unconfirmed');
                  const budgetData={__proto__:null,reservationId:reservation.reservation_id,issuerDomain:at.issuer_domain,mandateId:authority.mandateId,mandateRevision:authority.mandateRevision,authorizationEpoch:authority.authorizationEpoch,scope:data.scope,thread:data.thread,operationKey:cmd.operationKey,semanticPayloadHash:cmd.semanticPayloadHash,assessmentRef:cmd.assessmentRef,purpose:cmd.purpose,state:'reserved'};
                  frozen=captureDispatchBusinessData({__proto__:null,schemaVersion:1,kind:'work_reservation_receipt',ownerId:state!.ownerId,ownerEpoch:state!.ownerEpoch,disposition:value.disposition,reservation,head,attestation:at,data:budgetData,status}) as unknown as DshBudgetWorkReceiptView;
              }catch(error){dshFailSource(response.result);dshFailSource(error);throw error;}
              current();ready();
              if(!originalBudgetRuntime||dshSourceFailed)throw Error('dsh_budget_source_unconfirmed');
              const heldMutation=mutation!,revision=mutationRevision;
              const checkCut=()=>{ready();if(dshSourceFailed||dshUnknown.size||heldMutation.pending!==0||heldMutation.revision!==revision)throw Error('dsh_budget_admission_unavailable');};
              const pure=()=>{checkCut();sourceLocal();checkCut();};
              const delivery=()=>{const root=dshCreate(null);dshRoots.add(root);try{pure();current();pure();}finally{dshRoots.delete(root);dshNotify();}};
              const receipt=dshFreeze(dshCreate(null));
              privateBudgetSet(originalBudgetWorks,receipt,{runtime:originalBudgetRuntime,view:frozen,proof:context,used:false,eligible:frozen.disposition==='newly_reserved'&&frozen.attestation.owner_epoch===state!.ownerEpoch,current:delivery,unchanged:pure});
              return receipt;
          }
          let value: Record<string, unknown>, frozen: unknown;
          try {
              dshInventory(response.result);
              const captured = captureDispatchBusinessData(response.result, raw => dshFailSource(raw));
              value = dshRecord(captured, receiptKind === 'observation' ? ['schemaVersion', 'kind', 'status'] : [
                  'schemaVersion', 'kind', 'accountId', 'operationKey', 'attemptId', 'sequence', 'disposition', 'status'
              ]);
              if (value.schemaVersion !== 1 || value.kind !== (receiptKind === 'observation' ? 'ledger_observation' : receiptKind==='draft_attempt'?'draft_attempt_receipt':'workless_attempt_receipt')) {
                  throw Error('dsh_budget_receipt_unconfirmed');
              }
              const status = parseOriginalDshBudgetStatus(value.status);
              if (status.account.owner_id !== state!.ownerId || status.account.owner_id !== witness!.ownerId || status.account.profile_id !== dshProfileId || status.account.workspace_id !== dshWorkspaceId || status.account.account_id !== data.accountId || status.account.tenant_id !== authority.tenantId || status.account.mandate_id !== authority.mandateId || status.account.mandate_revision !== authority.mandateRevision || status.account.authorization_epoch !== authority.authorizationEpoch || status.account.authority_hash !== authority.authorityHash) {
                  throw Error('dsh_budget_receipt_unconfirmed');
              }
              const view = dshCreate(null);
              const headerNames = ['schemaVersion', 'kind'];
              for (let i = 0; i < headerNames.length; i++) {
                  const name = headerNames[i]!;
                  privateBudgetData(view, name, value[name]);
              }
              privateBudgetData(view, 'ownerId', state!.ownerId);
              privateBudgetData(view, 'ownerEpoch', state!.ownerEpoch);
              privateBudgetData(view, 'profileId', dshProfileId);
              privateBudgetData(view, 'workspaceId', dshWorkspaceId);
              privateBudgetData(view, 'status', status);
              if (receiptKind === 'attempt'||receiptKind==='draft_attempt') {
                  const operation = data.operation as Readonly<Record<string, unknown>>, attempt = data.attempt as Readonly<Record<string, unknown>>;
                  if (value.accountId !== data.accountId || value.operationKey !== operation.operationKey || value.attemptId !== attempt.attemptId || value.sequence !== attempt.sequence || value.disposition !== 'newly_reserved' && value.disposition !== 'existing') {
                      throw Error('dsh_budget_receipt_unconfirmed');
                  }
                  let matching = 0;
                  for (let i = 0; i < status.attempts.length; i++) {
                      const row = status.attempts[i]!;
                      if (row.operation_key === value.operationKey && row.attempt_id === value.attemptId && row.attempt_sequence === value.sequence) {
                          matching++;
                          if (row.body_hash !== attempt.bodyHash || value.disposition === 'newly_reserved' && row.state !== 'prepared') {
                              throw Error('dsh_budget_receipt_unconfirmed');
                          }
                      }
                  }
                  if (matching !== 1) {
                      throw Error('dsh_budget_receipt_unconfirmed');
                  }
                  const attemptNames = [
                      'accountId', 'operationKey', 'attemptId', 'sequence', 'disposition'
                  ];
                  for (let i = 0; i < attemptNames.length; i++) {
                      const name = attemptNames[i]!;
                      privateBudgetData(view, name, value[name]);
                  }
              }
              frozen = captureDispatchBusinessData(view);
          }
          catch (error) {
              dshFailSource(response.result);
              dshFailSource(error);
              throw error;
          }
          // Expected lifecycle withdrawal is separate from malformed SDK data.
          // No callback or projection follows this final original Source check.
          current();
          ready();
          if (dshSourceFailed || !originalBudgetRuntime) {
              throw Error('dsh_budget_source_unconfirmed');
          }
          const receipt = dshFreeze(dshCreate(null));
          if (receiptKind === 'observation') {
              const cut=observationCut!;
              const checkCut=()=>{
                  ready();
                  if(!cut.eligible||cut.holder.pending!==0||cut.holder.revision!==cut.revision||dshSourceFailed||dshUnknown.size)throw Error('dsh_budget_observation_unavailable');
              };
              const pure=()=>{checkCut();sourceLocal();checkCut();};
              const delivery=()=>{
                  const root=dshCreate(null);dshRoots.add(root);
                  try{pure();current();pure();}
                  finally{dshRoots.delete(root);dshNotify();}
              };
              privateBudgetSet(originalBudgetObservations, receipt, {
                  runtime: originalBudgetRuntime, view: frozen as DshBudgetObservationView,current:delivery,unchanged:pure
              });
          }
          else if(receiptKind==='draft_attempt') {
              privateBudgetSet(originalBudgetDraftAttempts,receipt,{runtime:originalBudgetRuntime,view:frozen as DshBudgetDraftAttemptReceiptView});
          }
          else {
              privateBudgetSet(originalBudgetAttempts, receipt, {
                  runtime: originalBudgetRuntime, view: frozen as DshBudgetAttemptReceiptView
              });
          }
          return receipt;

      }
      catch (error) {
          dshInventory(error);
          throw error;
      }
      finally {
          if(mutation)mutation.pending--;
          dshRoots.delete(callRoot);
          dshNotify();
      }
  }
  const sourceReadFault=(raw:unknown)=>{if(!readSourceFailed){readSourceFailed=true;readFailure=raw;}dshInventory(raw);};
  async function sourceReadCall(purpose:string,input:unknown,proof:object,existing?:SourceReadReservation):Promise<unknown> {
      ready();if(!readResolve)throw Error('dsh_source_authority_required');
      if(readSourceFailed&&purpose!=='source_read_settle')throw Error('dsh_source_budget_unconfirmed',{cause:readFailure});
      const root=dshCreate(null);dshRoots.add(root);let mutation:{revision:number;pending:number}|undefined,revision=0;
      try {
          let raw:unknown;
          try{raw=dshApply(readResolve,readSource,[proof,purpose]);}catch(error){sourceReadFault(error);throw error;}
          privateBudgetData(root,'sourceRaw',raw);
          if(raw===null)throw Error('dsh_source_authority_required');
          const names=['requestSource','actor','profileId','workspaceId','accountId','identity','commandDigest','assertCurrent','assertLocal'];
          if(purpose==='source_read_settle')names.push('outcome','reservation');
          let fields:Record<string,unknown>;
          try{fields=dshRecord(raw,names);}catch(error){sourceReadFault(raw);sourceReadFault(error);throw error;}
          const guard=fields.assertCurrent,localGuard=fields.assertLocal;
          if(!dshSync(guard)||!dshSync(localGuard)){sourceReadFault(raw);throw Error('dsh_source_authority_required');}
          const local=()=>{ready();if(readSourceFailed&&purpose!=='source_read_settle')throw Error('dsh_source_budget_unconfirmed',{cause:readFailure});};
          const invokeGuard=(fn:Function)=>{
              let returned:unknown;try{returned=dshApply(fn,undefined,[]);}catch(error){sourceReadFault(error);throw error;}
              if(returned!==undefined){sourceReadFault(returned);throw Error('dsh_source_authority_required');}
          };
          const current=()=>{local();invokeGuard(guard);invokeGuard(localGuard);local();};
          current();
          let identity:Readonly<Record<string,unknown>>,data:Readonly<Record<string,unknown>>;
          try{identity=parseSourceIdentity(fields.identity);data=parseSourceReadInput(purpose,purpose==='source_read_settle'?fields.outcome:input);}catch(error){sourceReadFault(raw);throw error;}
          if(fields.profileId!==dshProfileId||fields.workspaceId!==dshWorkspaceId||identity.kind==='source_setup'&&fields.requestSource!=='user'||identity.kind==='source_binding'&&fields.requestSource!=='scheduler')throw Error('dsh_source_authority_required');
          if(purpose==='source_read_settle') {
              if(!existing||fields.reservation!==existing.cap||fields.actor!==existing.actor)throw Error('dsh_source_reservation_required');
          } else if(fields.requestSource==='user') {
              if(!fields.actor||typeof fields.actor!=='object'||dshIsProxy(fields.actor)||dshTypes.isPromise(fields.actor))throw Error('dsh_source_authority_required');
              let allowed:unknown;try{allowed=options.authorizeUser(fields.actor as HarnessUserContext);}catch(error){sourceReadFault(error);throw error;}
              if(allowed!==true){if(typeof allowed!=='boolean')sourceReadFault(allowed);throw Error('dsh_source_authority_required');}
          } else if(fields.actor!==null){sourceReadFault(fields.actor);throw Error('dsh_source_authority_required');}
          if(fields.commandDigest!==dshSourceReadCommandDigest(purpose,data))throw Error('dsh_source_authority_required');
          const accountId=purpose==='source_read_settle'?existing!.view.accountId:data.accountId;
          if(fields.accountId!==accountId)throw Error('dsh_source_account_forbidden');
          if(existing&&captureIdentity(identity)!==captureIdentity(existing.identity))throw Error('dsh_source_reservation_required');
          mutation=mutationFor(accountId as string);revision=++mutation.revision;mutation.pending++;
          current();
          let timestamp=0;
          if(purpose!=='source_read_settle') {
              try{timestamp=now();dshInteger(timestamp,0,1e15);}catch(error){sourceReadFault(error);throw error;}
              invokeGuard(localGuard);local();
          }
          const authority={__proto__:null,requestSource:fields.requestSource,profileId:dshProfileId,workspaceId:dshWorkspaceId,accountId,identity,commandDigest:fields.commandDigest};
          const workerRaw=store!.call<{result:unknown;ownerState:HarnessStoreState}>('dsh_'+purpose,{input:data,authority,now:timestamp,existing:existing?.view??null},()=>{invokeGuard(localGuard);local();});
          privateBudgetData(root,'workerRaw',workerRaw);
          try{assertStandardIpcPromise(workerRaw,'dsh_source_worker_unconfirmed');}catch(error){sourceReadFault(workerRaw);throw error;}
          const response=await workerRaw;privateBudgetData(root,'workerResponse',response);dshInventory(response);
          publish(response.ownerState);
          if(purpose==='source_read_settle')return captureDispatchBusinessData(response.result,raw=>sourceReadFault(raw));
          current();
          const result=captureDispatchBusinessData(response.result,raw=>sourceReadFault(raw));
          if(purpose==='source_read_scan'||purpose==='source_read_migrate')return result;
          const envelope=dshRecord(result,['disposition','attempt','scan']);
          const attempt=dshRecord(envelope.attempt,['attempt_id','scan_id','request_sequence','request_digest','upper_bytes','state','request_sent','actual_bytes','settlement_json','settlement_hash']);
          const scan=dshRecord(envelope.scan,['scan_id','account_id','owner_epoch','started_at','deadline','held_bytes','spent_bytes','spent_requests','held_requests','next_sequence','uncertain']);
          if(attempt.attempt_id!==data.attemptId||attempt.scan_id!==data.scanId||attempt.request_digest!==data.requestDigest||attempt.upper_bytes!==data.responseBytesUpperBound||scan.account_id!==accountId||scan.scan_id!==data.scanId||envelope.disposition!=='existing'&&envelope.disposition!=='newly_reserved')throw Error('dsh_source_budget_unconfirmed');
          const deadline=dshInteger(scan.deadline,0,1e15),timeoutMs=Math.min(30000,deadline-timestamp);
          const view=captureDispatchBusinessData({__proto__:null,disposition:envelope.disposition,accountId,scanId:data.scanId,attemptId:data.attemptId,requestDigest:data.requestDigest,responseBytesUpperBound:data.responseBytesUpperBound,timeoutMs,deadline}) as unknown as DshSourceReadReservationView;
          invokeGuard(localGuard);local();
          if(!originalBudgetRuntime)throw Error('dsh_source_budget_unconfirmed');
          const held=mutation,ownRevision=revision;
          const pure=()=>{local();if(held.pending||held.revision!==ownRevision)throw Error('dsh_source_reservation_unavailable');};
          const delivery=()=>{
              const deliveryRoot=dshCreate(null);dshRoots.add(deliveryRoot);
              try{pure();current();let clock:unknown;try{clock=now();dshInteger(clock,0,1e15);}catch(error){sourceReadFault(error);throw error;}invokeGuard(localGuard);pure();if((clock as number)>=deadline)throw Error('dsh_source_budget_expired');}
              finally{dshRoots.delete(deliveryRoot);dshNotify();}
          };
          const cap=dshFreeze(dshCreate(null));
          privateBudgetSet(originalSourceReadReservations,cap,{cap,runtime:originalBudgetRuntime,proof,view,identity,actor:fields.actor,used:false,eligible:envelope.disposition==='newly_reserved'&&attempt.state==='prepared'&&scan.owner_epoch===state!.ownerEpoch,current:delivery});
          return cap;
      }catch(error){dshInventory(error);throw error;}
      finally{if(mutation)mutation.pending--;dshRoots.delete(root);dshNotify();}
  }
  const captureIdentity=(identity:unknown)=>dshDigest('dsh-source-read-identity-v1',identity);
  const dsh = dshFreeze({
      openAccount: (input: unknown, context: unknown) => dshCall('dsh_open_account', 'open', input, context),
      reserveAttempt: (input: unknown, context: unknown) => dshCall('dsh_reserve_attempt', 'reserve', input, context),
      markPreSend: (input: unknown, context: unknown) => dshCall('dsh_mark_pre_send', 'marker', input, context),
      markSent: (input: unknown, context: unknown) => dshCall('dsh_mark_sent', 'sent', input, context),
      markUnknown: (input: unknown, context: unknown) => dshCall('dsh_mark_unknown', 'unknown', input, context),
      settleAttempt: (input: unknown, context: unknown) => dshCall('dsh_settle_attempt', 'settle', input, context),
      settleConservative:(input:unknown,context:unknown)=>dshCall('dsh_settle_conservative','settle_conservative',input,context),
      status: (input: unknown, context: unknown) => dshCall('dsh_status', 'read', input, context),
  });
  const runtime = dshCreate(null);
  const publicFields = [
      ['api', api], ['driver', driver], ['dsh', dsh], ['dispose', dispose]
  ] as const;
  for (let i = 0; i < publicFields.length; i++) {
      const pair = publicFields[i]!;
      dshDefine(runtime, pair[0], {
          __proto__: null, value: pair[1], enumerable: true, writable: true, configurable: true
      } as PropertyDescriptor);
  }
  const port = dshCreate(null);
  privateBudgetData(port,'reserveDraftAttempt',(input:unknown,proof:object)=>dshCall('dsh_reserve_draft_attempt_receipt','reserve',input,proof,'draft_attempt'));
  privateBudgetData(port,'markPreSend',(input:unknown,proof:object)=>dshCall('dsh_mark_pre_send','marker',input,proof));
  privateBudgetData(port,'markSent',(input:unknown,proof:object)=>dshCall('dsh_mark_sent','sent',input,proof));
  privateBudgetData(port,'markUnknown',(input:unknown,proof:object)=>dshCall('dsh_mark_unknown','unknown',input,proof));
  privateBudgetData(port,'settleConservative',(input:unknown,proof:object)=>dshCall('dsh_settle_conservative','settle_conservative',input,proof));
  privateBudgetData(port,'finalizeDraftUsage',(input:unknown,proof:object)=>dshCall('dsh_draft_finalize','draft_finalize',input,proof,'commit_proof'));
  privateBudgetData(port,'observeWork',(input:unknown,proof:object)=>dshCall('dsh_work_read','work_read',input,proof,'work_snapshot'));
  privateBudgetData(port, 'observe', (input: unknown, proof: object) => dshCall('dsh_observe_receipt', 'read', input, proof, 'observation'));
  privateBudgetData(port, 'reserveAttempt', (input: unknown, proof: object) => dshCall('dsh_reserve_attempt_receipt', 'reserve', input, proof, 'attempt'));
  privateBudgetData(port,'configureWorkPolicy',(input:unknown,proof:object)=>dshCall('dsh_work_policy','work_policy',input,proof));
  privateBudgetData(port,'syncWorkPolicy',(input:unknown,proof:object)=>dshCall('dsh_work_policy_sync','work_policy_sync',input,proof));
  privateBudgetData(port,'reserveDraftAdmission',(input:unknown,proof:object)=>dshCall('dsh_work_reserve','work_reserve',input,proof,'work'));
  privateBudgetData(port,'bindDraftWork',(input:unknown,proof:object)=>dshCall('dsh_work_bind','work_bind',input,proof));
  privateBudgetData(port,'closeWork',(input:unknown,proof:object)=>dshCall('dsh_work_close','work_close',input,proof));
  dshFreeze(port);
  const readPort=dshCreate(null);
  privateBudgetData(readPort,'migrateSetup',(input:unknown,proof:object)=>sourceReadCall('source_read_migrate',input,proof));
  privateBudgetData(readPort,'openScan',(input:unknown,proof:object)=>sourceReadCall('source_read_scan',input,proof));
  privateBudgetData(readPort,'reserveRequest',(input:unknown,proof:object)=>sourceReadCall('source_read_reserve',input,proof));
  privateBudgetData(readPort,'settleRequest',(cap:object,proof:object)=>{
      const row=privateBudgetGet(originalSourceReadReservations,cap);
      if(!row||row.runtime!==originalBudgetRuntime)throw Error('dsh_source_reservation_required');
      return sourceReadCall('source_read_settle',null,proof,row);
  });dshFreeze(readPort);
  const binding=dshCreate(null);
  const bindingCurrent=()=>{ready();if(!dshResolve||dshSourceFailed)throw Error('dsh_budget_source_unconfirmed');};
  privateBudgetData(binding,'port',port);privateBudgetData(binding,'ownerId',state?.ownerId??'');
  privateBudgetData(binding,'profileId',dshProfileId);privateBudgetData(binding,'workspaceId',dshWorkspaceId);
  privateBudgetData(binding,'assertCurrent',bindingCurrent);privateBudgetData(binding,'assertLocal',bindingCurrent);dshFreeze(binding);
  originalBudgetRuntime = {
      dispose,
      source: dshResolve ? dshSource : undefined, port,binding,readSource:readResolve?readSource:undefined,readPort
  };
  privateBudgetSet(originalBudgetRuntimes, runtime, originalBudgetRuntime);
  privateBudgetSet(originalBudgetPorts, port, originalBudgetRuntime);
  privateBudgetSet(originalBudgetPorts, readPort, originalBudgetRuntime);
  return runtime as {
      api: typeof api;
      driver: typeof driver;
      dsh: typeof dsh;
      dispose: typeof dispose;
  };
}
