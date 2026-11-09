import {withDecisionCleanup} from './decision-model-cleanup.js';
import { DECISION_MODEL_PYTHON as wrapper } from './decision-model-python.js';
import { createIntrinsicSet } from '../../src/runtime/verification/intrinsic-async-collection.js';
import { randomUUID, createHash, Hash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { loadOriginalProcessSdk } from '../../src/runtime/verification/original-process-sdk-loader.js';
import type { DecisionModelManifest, DecisionRuntimeObservation } from '../shared/decision-model-types.js';
import { DecisionModelFiles } from './decision-model-files.js';
import { DecisionModelHttp } from './decision-model-http.js';
import { encodeDecisionData, parseDecisionData, ownDecisionData } from './decision-model-data.js';
const apply = Reflect.apply, hashUpdate = Hash.prototype.update, hashDigest = Hash.prototype.digest;
const bytesText = Buffer.prototype.toString;
const NativePromise = Promise;
type RuntimeRow = {
    owner: DecisionModelFiles;
    closeOwned: () => Promise<void>;
};
const runtimeRows = createIntrinsicSet<RuntimeRow>();
export interface DecisionModelRuntime {
    endpoint: string;
    pid?: number;
    info: DecisionRuntimeObservation;
    alive(): boolean;
    stop(): Promise<void>;
}
function observation(raw: unknown): DecisionRuntimeObservation {
    if (ownDecisionData(raw, 'implementation') !== 'xiaok-local-text-v2')
        throw Error('runtime_failed');
    const engine = ownDecisionData(raw, 'engine'), device = ownDecisionData(raw, 'device'), precision = ownDecisionData(raw, 'parameterPrecision'), quantization = ownDecisionData(raw, 'quantization');
    if (![null, 'mlx-vlm', 'torch-eager'].includes(engine as null) || ![null, 'metal', 'mps', 'cpu', 'cuda'].includes(device as null) || ![null, 'mixed-4bit-bf16', 'float32', 'float16', 'bfloat16'].includes(precision as null) || ![null, 'affine-4bit-group64', 'none'].includes(quantization as null))
        throw Error('runtime_failed');
    const source = ownDecisionData(raw, 'versions'), versions: Record<string, string> = Object.create(null);
    if (!source || typeof source !== 'object' || Object.keys(source).length > 32)
        throw Error('runtime_failed');
    for (const key of Object.keys(source)) {
        const v = ownDecisionData(source, key);
        if (typeof v !== 'string' || v.length > 256)
            throw Error('runtime_failed');
        versions[key] = v;
    }
    const peak = (key: string) => {
        const v = ownDecisionData(raw, key);
        if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0))
            throw Error('runtime_failed');
        return v as number | null;
    };
    return { implementation: 'xiaok-local-text-v2', engine: engine as DecisionRuntimeObservation['engine'], device: device as DecisionRuntimeObservation['device'], parameterPrecision: precision as DecisionRuntimeObservation['parameterPrecision'], quantization: quantization as DecisionRuntimeObservation['quantization'], versions, peakRssBytes: peak('peakRssBytes'), peakGpuAllocatedBytes: peak('peakGpuAllocatedBytes') };
}
export async function startDecisionModelRuntime(model: DecisionModelManifest, path: string, files: DecisionModelFiles, signal: AbortSignal, pythonCommand: string): Promise<DecisionModelRuntime> {
    signal.throwIfAborted();
    if (!model.platforms.includes(`${process.platform}-${process.arch}`) || !['clef-mlx', 'laya'].includes(model.runtime))
        throw Error('unsupported_platform');
    const runtimeDir = join(dirname(path), '.runtime');
    if (!files.exists(runtimeDir))
        files.mkdir(runtimeDir);
    const hash = createHash('sha256');
    apply(hashUpdate, hash, [wrapper]);
    const name = apply(hashDigest, hash, ['hex']) as string;
    const code = join(runtimeDir, `decision-server-${name.slice(0, 16)}.py`);
    if (files.exists(code)) {
        if (files.readText(code, 32768) !== wrapper)
            throw Error('runtime_code_changed');
    }
    else
        files.exclusiveBytes(code, wrapper);
    if (files.readText(code, 32768) !== wrapper)
        throw Error('runtime_code_changed');
    const token = randomUUID(), sdk = await loadOriginalProcessSdk();
    signal.throwIfAborted();
    const row: {
        owner: DecisionModelFiles;
        closeOwned: () => Promise<void>;
        entered: boolean;
        attempt?: object;
        child?: import('node:child_process').ChildProcess;
        birthFailure?: {
            raw: unknown;
        };
        stop?: Promise<void>;
        physical?: Promise<object>;
        physicalDone: boolean;
        alive: boolean;
    } = { owner: files, closeOwned: stop, entered: false, physicalDone: false, alive: false };
    runtimeRows.add(row);
    let completeBirth!: () => void;
    const birthKnown = new NativePromise<void>(yes => { completeBirth = yes; });
    let readyYes!: (port: number) => void, readyNo!: (raw: unknown) => void, settled = false, buffer = '';
    const ready = new NativePromise<number>((yes, no) => { readyYes = yes; readyNo = no; });
    let readyFailure: {
        raw: unknown;
    } | undefined;
    void ready.then(() => undefined, raw => { readyFailure = { raw }; });
    const fail = (raw: unknown) => {
        if (!settled) {
            settled = true;
            readyNo(raw);
        }
    };
    const timer = setTimeout(() => fail(Error('runtime_timeout')), 180000);
    async function stop(): Promise<void> {
        if (row.stop)
            return row.stop;
        row.stop = (async () => {
            await birthKnown;
            if (!row.entered) {
                runtimeRows.delete(row);
                return;
            }
            if (!row.attempt && row.birthFailure)
                throw row.birthFailure.raw;
            if (!row.attempt || !row.physical)
                throw Error('runtime_source_unconfirmed');
            const errors: unknown[] = [];
            if (!row.physicalDone) {
                try {
                    await sdk.terminateOriginalToolProcess(row.attempt, 'SIGTERM');
                }
                catch (raw) {
                    errors.push(raw);
                }
            }
            let killTimer: ReturnType<typeof setTimeout> | undefined, deadline: ReturnType<typeof setTimeout> | undefined, killWork: Promise<void> | undefined;
            try {
                await NativePromise.race([row.physical, new NativePromise<never>((_yes, no) => {
                        killTimer = setTimeout(() => {
                            if (!row.physicalDone) {
                                killWork = sdk.terminateOriginalToolProcess(row.attempt!, 'SIGKILL');
                                void killWork.then(() => undefined, raw => { files.retain(raw); });
                            }
                            deadline = setTimeout(() => no(Error('runtime_stop_failed')), 1500);
                        }, 1500);
                    })]);
            }
            catch (raw) {
                errors.push(raw);
            }
            finally {
                if (killTimer)
                    clearTimeout(killTimer);
                if (deadline)
                    clearTimeout(deadline);
            }
            if (killWork) {
                try {
                    await killWork;
                }
                catch (raw) {
                    errors.push(raw);
                }
            }
            if (errors.length)
                throw errors.length === 1 ? errors[0] : new AggregateError(errors, 'decision_runtime_stop', { cause: errors[0] });
            row.alive = false;
            runtimeRows.delete(row);
        })();
        return row.stop;
    }
    const cancel = () => { fail(Error('runtime_cancelled')); };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted)
        cancel();
    let primary: {
        raw: unknown;
    } | undefined;
    try {
        signal.throwIfAborted();
        const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, LANG: process.env.LANG, TMPDIR: process.env.TMPDIR, SYSTEMROOT: process.env.SYSTEMROOT, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_DATASETS_OFFLINE: '1', HF_HOME: join(runtimeDir, 'hf-cache'), PYTHONDONTWRITEBYTECODE: '1', USE_TF: '0', HF_HUB_DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1', XIAOK_DECISION_HTTP_TOKEN: token };
        try {
            signal.throwIfAborted();
            row.entered = true;
            const born = await sdk.spawnOriginalToolProcess(pythonCommand, ['-I', '-B', code, path, model.codeHash ?? '', '-', model.runtime, encodeDecisionData(model.runtimePackage ?? {})], { cwd: runtimeDir, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
            row.attempt = born.attempt;
            row.child = born.handle;
            row.alive = true;
            row.physical = sdk.waitOriginalToolProcessPhysical(born.attempt);
            void row.physical.then(() => { row.physicalDone = true; row.alive = false; }, raw => { row.birthFailure ??= { raw }; row.alive = false; });
            sdk.listenOriginalToolProcess(born.attempt, 'child', 'error', () => fail(Error('runtime_missing')));
            sdk.listenOriginalToolProcess(born.attempt, 'child', 'exit', () => { row.alive = false; fail(Error('runtime_failed')); });
            sdk.listenOriginalToolProcess(born.attempt, 'stderr', 'data', () => undefined);
            sdk.listenOriginalToolProcess(born.attempt, 'stdout', 'data', (chunk: unknown) => {
                if (settled)
                    return;
                if (!Buffer.isBuffer(chunk)) {
                    fail(Error('runtime_failed'));
                    return;
                }
                buffer += apply(bytesText, chunk, ['utf8']);
                if (buffer.length > 65536) {
                    fail(Error('runtime_failed'));
                    return;
                }
                const error = /XIAOK_ERROR (runtime_missing|runtime_version|hash_mismatch|runtime_failed)/.exec(buffer);
                if (error) {
                    fail(Error(error[1]));
                    return;
                }
                const match = /XIAOK_READY (\{[^\n]+\})/.exec(buffer);
                if (!match)
                    return;
                try {
                    const port = ownDecisionData(parseDecisionData(match[1]!), 'port');
                    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535)
                        throw Error('runtime_failed');
                    settled = true;
                    readyYes(port);
                }
                catch (raw) {
                    fail(raw);
                }
            });
            sdk.sealOriginalToolProcessListeners(born.attempt);
        }
        catch (raw) {
            if (!row.attempt)
                row.birthFailure = { raw };
            files.retain(raw);
            throw raw;
        }
        finally {
            completeBirth();
        }
        if (signal.aborted)
            cancel();
        const port = await ready, endpoint = `http://127.0.0.1:${port}/v1/systemone`;
        const http = new DecisionModelHttp();
        files.holdHttp(http);
        let healthFailure: {
            raw: unknown;
        } | undefined;
        const info = await withDecisionCleanup(async () => {
            try {
                const result = await http.request(`http://127.0.0.1:${port}/health`, { headers: { 'X-Xiaok-Decision-Token': token }, signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]), redirect: 'error' }, 65536);
                if (result.status !== 200)
                    throw Error('runtime_failed');
                const health = parseDecisionData(result.text);
                if (ownDecisionData(health, 'ready') !== true)
                    throw Error('runtime_failed');
                return observation(ownDecisionData(health, 'runtime'));
            }
            catch (raw) {
                healthFailure = { raw };
                throw raw;
            }
        }, async () => {
            try {
                await files.closeHttp(http);
            }
            catch (raw) {
                if (healthFailure)
                    throw new AggregateError([healthFailure.raw, raw], 'decision_health_cleanup', { cause: healthFailure.raw });
                throw raw;
            }
        });
        signal.throwIfAborted();
        return Object.freeze({ endpoint, pid: row.child?.pid, info, alive: () => row.alive, stop });
    }
    catch (raw) {
        primary = { raw };
        files.retain(raw);
        completeBirth();
        try {
            if (row.attempt) {
                try {
                    sdk.sealOriginalToolProcessListeners(row.attempt);
                }
                catch (cleanup) {
                    files.retain(cleanup);
                }
            }
            await stop();
        }
        catch (cleanup) {
            files.retain(cleanup);
            throw new AggregateError([raw, cleanup], 'decision_runtime_start_cleanup', { cause: raw });
        }
        throw raw;
    }
    finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        if (primary)
            readyFailure ??= primary;
    }
}
/** Fixed negative consumer of rows born in this module for this exact original
 * manager owner. It accepts no PID, path, role, provider or alleged fate. */
export async function settleDecisionModelRuntimes(files: DecisionModelFiles): Promise<void> {
    const pending: Promise<void>[] = [], errors: unknown[] = [];
    for (const row of runtimeRows.snapshot())
        if (row.owner === files) {
            try {
                pending.push(row.closeOwned());
            }
            catch (raw) {
                errors.push(raw);
            }
        }
    for (const work of pending) {
        try {
            await work;
        }
        catch (raw) {
            errors.push(raw);
        }
    }
    if (errors.length)
        throw errors.length === 1 ? errors[0] : new AggregateError(errors, 'decision_runtime_inventory', { cause: errors[0] });
}
