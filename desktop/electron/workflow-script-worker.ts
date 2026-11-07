import type { OriginalProcessSourceRequest } from '../../src/runtime/verification/original-process-source-types.js';
import type * as OriginalProcessSdk from '../../src/runtime/verification/original-process-sdk.js';
import { loadOriginalProcessSdk } from '../../src/runtime/verification/original-process-sdk-loader.js';
import { hasOriginalMainSdkBridgeInstallation } from '../../src/runtime/verification/original-main-sdk-bridge.js';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { WorkflowScriptRuntimeOptions, WorkflowScriptRunResult } from './workflow-script-runtime.js';
import { readOptionalWorkflowScriptWorkerOrigin, type OriginalWorkflowScriptWorkerOrigin } from './workflow-script-worker-origin.js';
import { createRoomTurnCustody } from './original-room-turn-custody.js';
import { captureDispatchBusinessData } from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import { assertBeforeEffects } from '../../src/runtime/verification/before-effects.js';
import { validateWorkflowScript } from './workflow-script-contract.js';
import { types } from 'node:util';
import { Worker } from 'node:worker_threads';
import { createIntrinsicSet, settleIntrinsicOperations } from '../../src/runtime/verification/intrinsic-async-collection.js';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { runWithOriginalRootExecutionContext } from '../../src/runtime/verification/original-root-execution-context.js';
const postMessage = Worker.prototype.postMessage;
const get = WeakMap.prototype.get, set = WeakMap.prototype.set, apply = Reflect.apply, freeze = Object.freeze, NativeWeakMap = WeakMap, isProxy = types.isProxy;
const descriptor = Object.getOwnPropertyDescriptor, own = Object.hasOwn, keys = Reflect.ownKeys, isArray = Array.isArray, integer = Number.isSafeInteger, json = JSON.stringify, parse = JSON.parse, bytes = Buffer.byteLength;
const NativePromise = Promise, then = Promise.prototype.then, NativeError = Error, NativeWorker = Worker, on = EventEmitter.prototype.on, terminate = Worker.prototype.terminate, create = Object.create;
const clock = performance.now, setTimer = setTimeout, clearTimer = clearTimeout;
const methods = ['createAgentNode', 'emitPhase', 'emitLog', 'requestUserInput', 'beginParallelGroup', 'reserveBudget', 'consumeBudget', 'releaseBudget', 'checkRemainingBudget', 'verifyEvidence', 'markNodeIntervention', 'markBranchSkipped'] as const;
export interface WorkflowScriptRuntimePhysicalFate {
    waitKnown(): Promise<void>;
    assertKnown(): void;
    assertOpen(): void;
}
interface RuntimeRow {
    controller: object;
    fate: WorkflowScriptRuntimePhysicalFate;
}
const runtimes = new NativeWeakMap<object, RuntimeRow>();
function error(code: string): Error { return new NativeError(code); }
function fixed(receiver: object, key: string): Function | undefined { const row = descriptor(receiver, key); if (!row)
    return; if (!own(row, 'value') || typeof row.value !== 'function' || isProxy(row.value))
    throw error('WORKFLOW_WORKER_CONTROLLER_INVALID'); return row.value; }
function record(raw: unknown): Record<string, unknown> { const value = captureDispatchBusinessData(raw); if (!value || typeof value !== 'object' || isArray(value))
    throw error('WORKFLOW_WORKER_FRAME_INVALID'); return value as Record<string, unknown>; }
function closed(value: Record<string, unknown>, names: readonly string[]) { const actual = keys(value); if (actual.length !== names.length)
    throw error('WORKFLOW_WORKER_FRAME_INVALID'); for (let i = 0; i < actual.length; i++) {
    let found = false;
    for (let j = 0; j < names.length; j++)
        if (actual[i] === names[j])
            found = true;
    if (!found)
        throw error('WORKFLOW_WORKER_FRAME_INVALID');
} }
/** An original runtime reference is physical inventory, never a Native grant. */
export function readOriginalWorkflowScriptRuntimeFate(controller: unknown, reference: unknown): WorkflowScriptRuntimePhysicalFate {
    if (!reference || typeof reference !== 'object' || isProxy(reference))
        throw error('WORKFLOW_WORKER_ORIGINAL_FATE_REQUIRED');
    const row = apply(get, runtimes, [reference]) as RuntimeRow | undefined;
    if (!row || row.controller !== controller)
        throw error('WORKFLOW_WORKER_ORIGINAL_FATE_REQUIRED');
    return row.fate;
}
interface VmProcessSourceRow {
    readonly parentRef: object;
    readonly request: OriginalProcessSourceRequest;
}
const vmProcessSources = new NativeWeakMap<object, VmProcessSourceRow>();
/** Only an accepted original controller's actual VM entry can populate this map.
 * Passive metadata remains available for negative settlement after effects stop. */
export function readOptionalOriginalWorkflowVmProcessSourceRequest(ticket: unknown): OriginalProcessSourceRequest | null {
    const row = apply(get, vmProcessSources, [ticket]) as VmProcessSourceRow | undefined;
    return row?.request ?? null;
}
export function readOptionalOriginalWorkflowVmProcessContext(ticket: unknown) {
    const row = apply(get, vmProcessSources, [ticket]) as VmProcessSourceRow | undefined;
    if (!row)
        return null;
    return freeze({ parentRef: row.parentRef, executionRef: row.request.invocationId,
        assertCurrent: row.request.assertCurrent, assertLocal: row.request.assertLocal,
        assertAttempt(id: string, hash: string) { if (id !== row.request.invocationId || hash !== row.request.specHash)
            throw error('WORKFLOW_VM_PROCESS_SPEC_MISMATCH'); } });
}
export function runOriginalWorkflowScriptWorker(script: string, options: WorkflowScriptRuntimeOptions): Promise<WorkflowScriptRunResult> {
    const origin = readOptionalWorkflowScriptWorkerOrigin(options.controller);
    if (!origin)
        throw error('WORKFLOW_WORKER_ORIGINAL_ORIGIN_REQUIRED');
    return runWorkerCore(script, options, origin);
}
// Test loader only. Product callers cannot provide an origin/deadline/Worker.
async function runWorkerCore(script: string, options: WorkflowScriptRuntimeOptions, origin?: OriginalWorkflowScriptWorkerOrigin | null, deadlineMs = 1800000): Promise<WorkflowScriptRunResult> {
    let processSdk: typeof OriginalProcessSdk | undefined, ownedProcess: Awaited<ReturnType<typeof OriginalProcessSdk.createOriginalSourceWorker>> | undefined;
    let processTicket: object | undefined, processAttemptEntered = false;
    let releaseProcess!: () => void, rejectProcess!: (raw: unknown) => void;
    const processBarrier = new NativePromise<void>((yes, no) => { releaseProcess = yes; rejectProcess = no; });
    void apply(then, processBarrier, [() => { }, () => { }]);
    const controller = options.controller;
    if (!controller || typeof controller !== 'object' || isProxy(controller))
        throw error('WORKFLOW_WORKER_CONTROLLER_INVALID');
    const before = options.beforeEffects, known = options.isKnownBusinessFailure;
    const captured: Record<string, Function> = create(null), available: string[] = [];
    let normalized!: Extract<ReturnType<typeof validateWorkflowScript>, {
        ok: true;
    }>['normalized'];
    const custody = createRoomTurnCustody(), rpcCustodies: ReturnType<typeof createRoomTurnCustody>[] = [], pending = createIntrinsicSet<Promise<void>>(), rawErrors = new Map<string, unknown>();
    let worker: Worker | undefined, threadId: number | null = null, entered = false, exited = false, joined = false, unsafe = false, sealed = false, primary: unknown, present = false, result: WorkflowScriptRunResult | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    let done!: (value?: unknown) => void, exit!: (value?: unknown) => void, physicalYes!: () => void, physicalNo!: (raw: unknown) => void;
    const bodyDone = new NativePromise(yes => { done = yes; }), exitDone = new NativePromise(yes => { exit = yes; }), physical = new NativePromise<void>((yes, no) => { physicalYes = yes; physicalNo = no; });
    void apply(then, physical, [() => { }, () => { }]);
    const reference = freeze(create(null)) as object;
    const fate = freeze({ waitKnown: () => physical, assertKnown() { if (!joined || unsafe || entered && !exited)
            throw error('WORKFLOW_WORKER_PHYSICAL_UNCONFIRMED'); }, assertOpen() { if (sealed || unsafe)
            throw error('WORKFLOW_WORKER_CLOSED'); origin?.assertLocal(); } });
    const row = { controller, fate };
    apply(set, runtimes, [reference, row]);
    const remember = (raw: unknown) => { if (!present) {
        present = true;
        primary = raw;
    } };
    const stop = (raw?: unknown, failed = false) => { if (failed)
        remember(raw); sealed = true; done(); };
    let requestId = 0;
    const send = (packet: unknown) => { if (sealed)
        return; const encoded = json(captureDispatchBusinessData(packet, () => { }, true)); if (bytes(encoded) > 1048576)
        throw error('WORKFLOW_WORKER_REPLY_TOO_LARGE'); custody.syncVoid(postMessage, worker, [encoded]); };
    async function rpc(packet: Record<string, unknown>) {
        const c = createRoomTurnCustody();
        rpcCustodies[rpcCustodies.length] = c;
        const id = packet.id as number, method = packet.method as string, args = packet.args as unknown[];
        let value: unknown;
        try {
            fate.assertOpen();
            assertBeforeEffects(before);
            origin?.assertLocal();
            const invoke = () => c.sdk(captured[method]!, controller, args);
            value = await (origin ? runWithOriginalRootExecutionContext(origin.executionContext, invoke) : invoke());
            const data = captureDispatchBusinessData(value === undefined ? null : value, raw => c.inventory(raw), true);
            if (!sealed)
                send({ v: 1, type: 'reply', id, ok: true, value: data });
        }
        catch (raw) {
            const ref = 'rpc-' + id;
            rawErrors.set(ref, raw);
            let business = false;
            if (known)
                try {
                    const outcome = apply(known, undefined, [raw]);
                    c.inventory(outcome);
                    if (typeof outcome !== 'boolean')
                        throw error('WORKFLOW_WORKER_CLASSIFIER_INVALID');
                    business = outcome;
                }
                catch (classification) {
                    c.inventory(classification);
                    stop(raw, true);
                }
            if (!sealed)
                send({ v: 1, type: 'reply', id, ok: false, errorRef: ref, knownBusinessFailure: business });
        }
        try {
            await c.waitPhysicalKnown();
        }
        catch (raw) {
            unsafe = true;
            remember(raw);
            stop(raw, true);
        }
    }
    function receive(raw: unknown) {
        custody.inventory(raw);
        if (sealed)
            return;
        if (typeof raw !== 'string' || bytes(raw) > 1048576)
            throw error('WORKFLOW_WORKER_FRAME_INVALID');
        const packet = record(parse(raw));
        if (packet.v !== 1)
            throw error('WORKFLOW_WORKER_FRAME_INVALID');
        if (packet.type === 'call') {
            closed(packet, ['v', 'type', 'id', 'method', 'args']);
            if (!integer(packet.id) || packet.id !== requestId + 1 || packet.id > 1024 || typeof packet.method !== 'string' || !own(captured, packet.method) || !isArray(packet.args) || packet.args.length !== 1 || pending.size >= 64)
                throw error('WORKFLOW_WORKER_FRAME_INVALID');
            requestId = packet.id;
            const task = rpc(packet);
            pending.add(task);
            void apply(then, task, [() => pending.delete(task), (raw: unknown) => { pending.delete(task); remember(raw); stop(raw, true); }]);
            return;
        }
        if (packet.type === 'done') {
            closed(packet, ['v', 'type', 'result', 'tailFailureRefs', 'policyConsumedFailureRefs']);
            const data = record(packet.result);
            if (data.ok !== true || data.scriptHash !== normalized.scriptHash)
                throw error('WORKFLOW_WORKER_RESULT_INVALID');
            const recover = (refs: unknown) => { if (!isArray(refs))
                throw error('WORKFLOW_WORKER_RESULT_INVALID'); const values: unknown[] = []; for (let i = 0; i < refs.length; i++) {
                if (typeof refs[i] !== 'string' || !rawErrors.has(refs[i] as string))
                    throw error('WORKFLOW_WORKER_RESULT_INVALID');
                values[values.length] = rawErrors.get(refs[i] as string);
            } return values; };
            result = { ...data, tailFailures: recover(packet.tailFailureRefs), policyConsumedFailures: recover(packet.policyConsumedFailureRefs) } as unknown as WorkflowScriptRunResult;
            sealed = true;
            done();
            return;
        }
        if (packet.type === 'failed') {
            closed(packet, ['v', 'type', 'errorRef']);
            if (typeof packet.errorRef === 'string' && rawErrors.has(packet.errorRef))
                remember(rawErrors.get(packet.errorRef));
            else
                remember(error('WORKFLOW_WORKER_SCRIPT_FAILED'));
            sealed = true;
            done();
            return;
        }
        throw error('WORKFLOW_WORKER_FRAME_INVALID');
    }
    const deadline = (apply(clock, performance, []) as number) + deadlineMs;
    try {
        origin?.bindRuntime(reference);
        origin?.claim(script);
        for (let i = 0; i < methods.length; i++) {
            const name = methods[i]!, fn = fixed(controller, name);
            if (fn) {
                captured[name] = fn;
                available[available.length] = name;
            }
        }
        if (!captured.createAgentNode)
            throw error('WORKFLOW_WORKER_CONTROLLER_INVALID');
        const validation = validateWorkflowScript(script, { policy: options.policy ?? {} });
        if (!validation.ok)
            throw error(validation.error);
        normalized = validation.normalized;
        if (bytes(script) > 262144)
            throw error('WORKFLOW_WORKER_SCRIPT_TOO_LARGE');
        if (before && (typeof before !== 'function' || isProxy(before) || types.isAsyncFunction(before)))
            throw error('WORKFLOW_WORKER_GUARD_INVALID');
        if (known && (typeof known !== 'function' || isProxy(known) || types.isAsyncFunction(known)))
            throw error('WORKFLOW_WORKER_CLASSIFIER_INVALID');
        const compiled = new URL('./workflow-script-runtime-worker.js', import.meta.url), source = new URL('./workflow-script-runtime-worker.ts', import.meta.url);
        const entry = existsSync(compiled) ? compiled : existsSync(source) ? new URL('./workflow-script-runtime-worker-bootstrap.mjs', import.meta.url) : compiled;
        const execArgv: string[] = [];
        origin?.assertCurrent();
        assertBeforeEffects(before);
        origin?.assertLocal();
        const workerOptions = { execArgv, env: {}, resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 8, stackSizeMb: 4 }, workerData: { v: 1, script, options: { concurrency: options.concurrency ?? 4, policy: options.policy ?? {}, syncTimeoutMs: Math.min(options.syncTimeoutMs ?? 1000, 1000), workflowRunId: options.workflowRunId ?? normalized.meta.name, workspaceRoot: options.workspaceRoot ?? '', methods: available } } };
        if (hasOriginalMainSdkBridgeInstallation()) {
            if (!origin)
                throw error('WORKFLOW_WORKER_ORIGINAL_ORIGIN_REQUIRED');
            if (!existsSync(compiled))
                throw error('WORKFLOW_WORKER_COMPILED_ENTRY_REQUIRED');
            const ticket = freeze(create(null)) as object;
            const fixedOptions = captureDispatchBusinessData(workerOptions) as typeof workerOptions;
            const fixedEntry = fileURLToPath(compiled);
            const invocationId = 'workflow-vm:' + origin.scriptHash;
            const specHash = createHash('sha256').update(json({ entry: fixedEntry, options: fixedOptions })).digest('hex');
            const request: OriginalProcessSourceRequest = freeze({ kind: 'original_process_source_request_v1', sourceKind: 'workflow_vm', operation: 'worker', context: ticket, invocationId, specHash, domain: 'sealed_worker', entry: fixedEntry, options: fixedOptions,
                assertCurrent() { if (sealed || unsafe)
                    throw error('WORKFLOW_WORKER_CLOSED'); origin.assertCurrent(); assertBeforeEffects(before); origin.assertLocal(); },
                assertLocal() { if (sealed || unsafe)
                    throw error('WORKFLOW_WORKER_CLOSED'); origin.assertLocal(); assertBeforeEffects(before); origin.assertLocal(); } });
            apply(set, vmProcessSources, [ticket, { parentRef: origin.executionContext, request }]);
            processTicket = ticket;
            processSdk = await loadOriginalProcessSdk();
            processAttemptEntered = true;
            ownedProcess = await processSdk.createOriginalSourceWorker(ticket);
            worker = ownedProcess.handle;
            entered = true;
            threadId = worker.threadId;
            // Register the complete VM/DSL/RPC barrier before listeners can seal. The
            // Core cannot settle this P group from Worker exit while RPC still lives.
            processSdk.retainOriginalToolProcessValue(ownedProcess.attempt, processBarrier);
        }
        else {
            const launch = () => { entered = true; worker = new NativeWorker(entry, workerOptions); threadId = worker.threadId; return worker; };
            await custody.sdk(launch, undefined, [], { accept: value => value === worker, consumer: terminate });
        }
        const register = async (name: string, fn: Function) => {
            if (ownedProcess)
                processSdk!.listenOriginalToolProcess(ownedProcess.attempt, 'child', name, fn);
            else
                await custody.sdk(on, worker, [name, fn], { accept: value => value === worker, consumer: terminate });
        };
        await register('message', (raw: unknown) => { void apply(then, custody.sdk(receive, undefined, [raw]), [() => { }, (failure: unknown) => stop(failure, true)]); });
        await register('error', (raw: unknown) => { custody.inventory(raw); stop(raw, true); });
        await register('exit', (code: unknown) => { custody.inventory(code); if (typeof code !== 'number' || !integer(code)) {
            unsafe = true;
            remember(error('WORKFLOW_WORKER_EXIT_UNCONFIRMED'));
        } exited = true; exit(); if (!sealed)
            stop(error('WORKFLOW_WORKER_EARLY_EXIT'), true); });
        if (ownedProcess)
            processSdk!.sealOriginalToolProcessListeners(ownedProcess.attempt);
        const wake = () => { if (sealed)
            return; const remaining = deadline - (apply(clock, performance, []) as number); if (remaining > 0) {
            timer = setTimer(wake, remaining);
            return;
        } stop(error('WORKFLOW_WORKER_DEADLINE'), true); };
        timer = setTimer(wake, Math.max(0, deadline - (apply(clock, performance, []) as number)));
        await bodyDone;
    }
    catch (raw) {
        remember(raw);
        custody.inventory(raw);
        sealed = true;
    }
    finally {
        if (timer !== undefined)
            clearTimer(timer);
        sealed = true;
        if (worker) {
            try {
                if (ownedProcess)
                    await processSdk!.terminateOriginalToolProcess(ownedProcess.attempt);
                else
                    await custody.consumeResource(terminate, worker, []);
            }
            catch (raw) {
                remember(raw);
                custody.inventory(raw);
            }
            await exitDone;
        }
        for (;;) {
            const all = pending.snapshot();
            if (!all.length)
                break;
            await settleIntrinsicOperations(all, value => value);
        }
        for (let i = 0; i < rpcCustodies.length; i++)
            try {
                await rpcCustodies[i]!.waitPhysicalKnown();
            }
            catch (raw) {
                unsafe = true;
                remember(raw);
            }
        try {
            await custody.waitPhysicalKnown();
        }
        catch (raw) {
            unsafe = true;
            remember(raw);
        }
        if (entered && !worker)
            unsafe = true;
        if (origin)
            try {
                await origin.waitControllerPhysicalKnown();
            }
            catch (raw) {
                unsafe = true;
                remember(raw);
                custody.inventory(raw);
            }
        if (unsafe)
            rejectProcess(error('WORKFLOW_WORKER_PHYSICAL_UNCONFIRMED'));
        else
            releaseProcess();
        if (processAttemptEntered)
            try {
                const fate = processSdk!.readOriginalSourceProcessPhysicalFate(processTicket);
                await fate.waitKnown();
                fate.assertKnown();
            }
            catch (raw) {
                unsafe = true;
                remember(raw);
            }
        joined = true;
        if (unsafe)
            physicalNo(error('WORKFLOW_WORKER_PHYSICAL_UNCONFIRMED'));
        else
            physicalYes();
        console.log(json({ event: 'workflow-worker-closed', threadId, entered, exited, physicallyKnown: !unsafe, reaped: !!worker && exited, notNativeQualification: !origin }));
        worker = undefined;
    }
    if (result)
        apply(set, runtimes, [result, row]);
    if (present) {
        if (primary && typeof primary === 'object' && !isProxy(primary))
            apply(set, runtimes, [primary, row]);
        throw primary;
    }
    if (!result)
        throw error('WORKFLOW_WORKER_RESULT_REQUIRED');
    return result;
}
