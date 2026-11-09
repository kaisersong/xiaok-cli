// @vitest-environment node
import { it, expect } from 'vitest';
it('requires original Process SDK and private physical receipt APIs', async () => {
    const sdk = await import('../../../src/runtime/verification/original-process-sdk.js');
    for (const key of ['readOriginalToolProcessKernelObservation', 'readOriginalSourceProcessPhysicalFate', 'createOriginalSourceProcess', 'createOriginalSourceWorker', 'createOriginalHostWorker', 'postOriginalHostWorkerRequest', 'retainOriginalToolProcessValue', 'readCurrentOriginalHostWorkerTicket', 'spawnOriginalToolProcess', 'spawnSyncOriginalToolProcess', 'createOriginalToolWorker', 'listenOriginalToolProcess', 'sealOriginalToolProcessListeners', 'waitOriginalToolProcessPhysical', 'readOriginalToolProcessPhysicalReceipt'])
        expect(typeof (sdk as any)[key]).toBe('function');
    let traps = 0;
    const fake = new Proxy({}, { get() { traps++; throw Error('get'); }, ownKeys() { traps++; return []; } });
    expect(() => sdk.readOriginalToolProcessPhysicalReceipt(fake, fake, fake)).toThrow('TOOL_PROCESS_ORIGINAL_RECEIPT_REQUIRED');
    expect(() => sdk.readOriginalToolProcessKernelObservation(fake)).toThrow('TOOL_PROCESS_ORIGINAL_ATTEMPT_REQUIRED');
    expect(traps).toBe(0);
    await expect(sdk.createOriginalHostWorker(fake)).rejects.toThrow('TOOL_PROCESS_ORIGINAL_HOST_WORKER_REQUIRED');
    await expect(sdk.createOriginalSourceProcess(fake)).rejects.toThrow('TOOL_PROCESS_ORIGINAL_SOURCE_REQUIRED');
    await expect(sdk.createOriginalSourceWorker(fake)).rejects.toThrow('TOOL_PROCESS_ORIGINAL_SOURCE_REQUIRED');
    expect(() => sdk.readOriginalHostWorkerPhysicalFate(fake)).toThrow('TOOL_PROCESS_ORIGINAL_HOST_WORKER_REQUIRED');
    expect(() => sdk.readOriginalSourceProcessPhysicalFate(fake)).toThrow('TOOL_PROCESS_ORIGINAL_SOURCE_REQUIRED');
    expect(traps).toBe(0);
});
it('keeps the actual exited process occupied until its accepted callback raw symbol tails finish', async () => {
    const sdk = await import('../../../src/runtime/verification/original-process-sdk.js');
    let release!: () => void, releaseSibling!: () => void;
    const held = new Promise<void>(yes => { release = yes; }), sibling = new Promise<void>(yes => { releaseSibling = yes; });
    Object.defineProperty(held, Symbol('actual-callback-sdk-sibling'), { value: sibling });
    const box = await sdk.spawnOriginalToolProcess(process.execPath, ['-e', 'process.stdout.write("owned");'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const originalChild = sdk.readOriginalToolProcessKernelObservation(box.attempt);
    expect(originalChild.pid).toBe(box.handle.pid);
    expect(originalChild.nativeMetered).toBe(false);
    originalChild.assertLocal();
    let hits = 0, closed = false, done = false;
    sdk.listenOriginalToolProcess(box.attempt, 'stdout', 'data', () => { hits++; return held; });
    sdk.listenOriginalToolProcess(box.attempt, 'child', 'close', () => { closed = true; });
    sdk.sealOriginalToolProcessListeners(box.attempt);
    const waiting = sdk.waitOriginalToolProcessPhysical(box.attempt).then(value => { done = true; return value; });
    try {
        await new Promise<void>(yes => box.handle.once('close', () => yes()));
        expect(closed).toBe(true);
        expect(hits).toBeGreaterThan(0);
        expect(done).toBe(false);
        release();
        await held;
        await Promise.resolve();
        expect(done).toBe(false);
        releaseSibling();
        const receipt = await waiting;
        const view = sdk.readOriginalToolProcessPhysicalReceipt(null, undefined, receipt);
        view.assertKnown();
        expect(view.nativeMetered).toBe(false);
    }
    finally {
        release();
        releaseSibling();
        box.handle.kill();
        await waiting;
    }
});
it('holds actual fixed Worker stdio and message callback outcomes until physical completion', async () => {
    const sdk = await import('../../../src/runtime/verification/original-process-sdk.js');
    const row = await sdk.createOriginalToolWorker(new URL('data:text/javascript,import {parentPort} from "node:worker_threads";parentPort.postMessage("owned");'), { stdout: true, stderr: true });
    sdk.listenOriginalToolProcess(row.attempt, 'stdout', 'data', () => { });
    sdk.listenOriginalToolProcess(row.attempt, 'stderr', 'data', () => { });
    sdk.listenOriginalToolProcess(row.attempt, 'child', 'message', () => { });
    sdk.sealOriginalToolProcessListeners(row.attempt);
    await sdk.waitOriginalToolProcessPhysical(row.attempt);
});
it.each([false, true])('preserves a real event callback first cause (undefined=%s) after its own SDK error tail drains', async (undefinedFailure) => {
    const sdk = await import('../../../src/runtime/verification/original-process-sdk.js');
    let release!: () => void;
    const held = new Promise<void>(yes => { release = yes; });
    const failure = undefinedFailure ? undefined : Error('original-owned-callback-error');
    if (failure)
        Object.defineProperty(failure, Symbol('actual-error-sdk-tail'), { value: held });
    const row = await sdk.spawnOriginalToolProcess(process.execPath, ['-e', 'process.stdout.write("error-tail");'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const callback = () => { throw failure; };
    Object.defineProperty(callback, Symbol('actual-callback-error-sdk-tail'), { value: held });
    sdk.listenOriginalToolProcess(row.attempt, 'stdout', 'data', callback);
    sdk.sealOriginalToolProcessListeners(row.attempt);
    const waiting = sdk.waitOriginalToolProcessPhysical(row.attempt);
    let done = false;
    void waiting.then(() => { done = true; }, () => { done = true; });
    await new Promise<void>(yes => row.handle.once('close', () => yes()));
    expect(done).toBe(false);
    release();
    await expect(waiting).rejects.toBe(failure);
});
it('never revives the original prepared Tool token after a current fault is restored', async () => {
    const { ToolRegistry, readCurrentOriginalToolProcessAuthorization, assertOriginalToolProcessAuthorizationCurrent } = await import('../../../src/ai/tools/index.js');
    const { PermissionManager } = await import('../../../src/ai/permissions/manager.js');
    let faulty = false;
    const registry = new ToolRegistry({ permissionManager: new PermissionManager({ mode: 'auto' }) }, [{
            permission: 'safe', definition: { name: 'original_token_restore_probe', description: 'private current lifetime probe', inputSchema: { type: 'object', properties: {} } },
            async execute() {
                const token = readCurrentOriginalToolProcessAuthorization();
                expect(token).not.toBeNull();
                faulty = true;
                let first = false;
                try {
                    assertOriginalToolProcessAuthorizationCurrent(token);
                }
                catch (error) {
                    first = true;
                    expect(error).toBeUndefined();
                }
                expect(first).toBe(true);
                faulty = false;
                let second = false;
                try {
                    assertOriginalToolProcessAuthorizationCurrent(token);
                }
                catch (error) {
                    second = true;
                    expect(error).toBeUndefined();
                }
                expect(second).toBe(true);
                return 'original-token-stays-revoked';
            },
        }]);
    const result = await registry.executeTool('original_token_restore_probe', {}, { assertPermissionApproval() {
            if (faulty)
                throw undefined;
        } });
    expect(result).toBe('original-token-stays-revoked');
});
it('keeps original spawnSync output and does not claim a failed constructor as known physical completion', async () => {
    const sdk = await import('../../../src/runtime/verification/original-process-sdk.js');
    const row = await sdk.spawnSyncOriginalToolProcess(process.execPath, ['-e', 'process.stdout.write("original-sync");'], { encoding: 'utf8' });
    expect(row.result.stdout).toBe('original-sync');
    expect(row.result.status).toBe(0);
    const receipt = await sdk.waitOriginalToolProcessPhysical(row.attempt);
    const view = sdk.readOriginalToolProcessPhysicalReceipt(null, undefined, receipt);
    view.assertKnown();
    expect(view.nativeMetered).toBe(false);
    // This is a genuine original SDK error, without a returned process handle.
    // The API preserves it; it supplies no known receipt for Native refund.
    await expect(sdk.spawnSyncOriginalToolProcess('/__xiaok_owned_missing_process__', [], {})).rejects.toHaveProperty('code', 'ENOENT');
});

it('never replaces an accepted SDK raw with a foreign completion-file proof', async () => {
    const sdk = await import('../../../src/runtime/verification/original-process-sdk.js');
    const row = await sdk.createOriginalToolWorker(new URL('data:text/javascript,import {parentPort} from "node:worker_threads";parentPort.postMessage("original");'), {stdout: true, stderr: true});
    let traps = 0;
    const proof = new Proxy({}, {get() {traps++; throw Error('get');}, ownKeys() {traps++; return [];}});
    const raw = Promise.resolve(undefined);
    sdk.retainOriginalToolProcessFileOperation(row.attempt, raw, proof);
    sdk.listenOriginalToolProcess(row.attempt, 'stdout', 'data', () => {});
    sdk.listenOriginalToolProcess(row.attempt, 'stderr', 'data', () => {});
    sdk.sealOriginalToolProcessListeners(row.attempt);
    await expect(sdk.waitOriginalToolProcessPhysical(row.attempt)).rejects.toThrow('COMPLETION_FILE_ORIGINAL_OPERATION_REQUIRED');
    expect(traps).toBe(0);
});

it('never revives a captured actual child PID association after replacement is restored', async () => {
    const sdk = await import('../../../src/runtime/verification/original-process-sdk.js');
    const box = await sdk.spawnOriginalToolProcess(process.execPath,
        ['-e', 'setTimeout(() => {}, 1000)'], {stdio: ['ignore', 'pipe', 'pipe']});
    const view = sdk.readOriginalToolProcessKernelObservation(box.attempt);
    const original = Object.getOwnPropertyDescriptor(box.handle, 'pid')!;
    let getters = 0;
    Object.defineProperty(box.handle, 'pid', {configurable: true, get() {getters++; throw Error('must not read');}});
    expect(() => view.assertLocal()).toThrow('TOOL_PROCESS_ORIGINAL_CHILD_UNCONFIRMED');
    Object.defineProperty(box.handle, 'pid', original);
    expect(() => view.assertLocal()).toThrow('TOOL_PROCESS_ORIGINAL_CHILD_REQUIRED');
    expect(() => sdk.readOriginalToolProcessKernelObservation(box.attempt)).toThrow('TOOL_PROCESS_ORIGINAL_CHILD_REQUIRED');
    expect(getters).toBe(0);
    sdk.sealOriginalToolProcessListeners(box.attempt);
    box.handle.kill();
    await expect(sdk.waitOriginalToolProcessPhysical(box.attempt)).rejects.toThrow();
});
