'use strict';
const fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url'), assert = require('node:assert/strict');
const [bundle, domain, result, userData, brokerService, brokerServer, mode] = process.argv.slice(2);
// Isolate every default discovery writer before importing Source/Services.
const configRoot = path.join(domain, 'config');
fs.mkdirSync(configRoot, { recursive: true, mode: 0o700 });
process.env.XIAOK_CONFIG_DIR = configRoot;
const app = require('electron').app;
app.setPath('userData', userData);
app.disableHardwareAcceleration();
const cleanup = [];
// A controlled SDK-wrapper fault after the actual co-located Native verifier.
// This does not change the production loader or fabricate a Native grant.
let consumeFaultArmed = false, consumeFaultHits = 0, consumeFault, consumeFaultRelease, consumeFaultRevoke, consumeRevokeRaw, settleFaultHits = 0, consumeSettlementRaw;
if (mode.startsWith('preconsume')) {
    const originalDlopen = process.dlopen;
    process.dlopen = function (module, filename, ...rest) {
        const returned = Reflect.apply(originalDlopen, process, [module, filename, ...rest]);
        if (fs.realpathSync(filename) !== fs.realpathSync(path.join(path.dirname(bundle), 'root_resource_authority_main.node')))
            return returned;
        const original = module.exports, descriptors = Object.getOwnPropertyDescriptors(original);
        const verify = descriptors.assertOriginalModelSdkBridge.value;
        descriptors.assertOriginalModelSdkBridge = { ...descriptors.assertOriginalModelSdkBridge, value: function (...args) {
                const value = Reflect.apply(verify, original, args);
                if (consumeFaultArmed)
                    fs.appendFileSync(path.join(domain, 'native-wrapper-stacks.jsonl'), JSON.stringify({ stack: new Error().stack }) + '\n');
                if (consumeFaultArmed && new Error().stack.includes('consumeProcess')) {
                    consumeFaultArmed = false;
                    consumeFaultHits++;
                    if (mode === 'preconsume-local') {
                        consumeFaultRevoke();
                        return value;
                    }
                    throw consumeFault;
                }
                return value;
            } };
        if (mode === 'preconsume-local') {
            const settle = descriptors.settleOriginalProcess.value;
            descriptors.settleOriginalProcess = { ...descriptors.settleOriginalProcess, value: function (...args) {
                    const value = Reflect.apply(settle, original, args);
                    if (consumeFaultHits === 1) {
                        settleFaultHits++;
                        assert.equal(value.newlySettled, true);
                        return consumeSettlementRaw.then(() => value);
                    }
                    return value;
                } };
        }
        Object.defineProperty(module, 'exports', { value: Object.create(null, descriptors) });
        process.dlopen = originalDlopen;
        return returned;
    };
}
const leafCase=process.argv[9] || 'success';
const leafProbe=require('./readonly-leaf-sdk-probe.cjs')({domain,bundle,mode,caseName:leafCase});
const phase=name=>fs.appendFileSync(path.join(domain,'fixture-phases.jsonl'),JSON.stringify({name,pid:process.pid})+'\n');
async function run() {
    phase('before-app-ready');await app.whenReady();phase('after-app-ready');
    phase('before-component-import');const api = await import(pathToFileURL(bundle).href);phase('after-component-import');
    const { createBrokerService } = await import(pathToFileURL(brokerService).href);
    const { createServer } = await import(pathToFileURL(brokerServer).href);
    const broker = createBrokerService({ dbPath: path.join(domain, 'actual-broker.sqlite') });
    const server = createServer({ broker, roomService: broker.room, roomDesktopToken: 'actual-room-fixture' });
    await server.listen(0, '127.0.0.1');
    cleanup.push(async () => { await server.close(); broker.close(); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const client = api.createCollaborationRoomBrokerClient({ token: 'actual-room-fixture', fetchImpl: (url, init) => fetch(base + new URL(String(url)).pathname, init) });
    const created = await client.createRoom({ title: 'actual Native Room', memberAgentIds: ['agent-a', 'agent-b'] });
    assert.equal(created.ok, true);
    const sent = await client.sendRoomMessage({
        roomId: created.room.roomId, text: 'original source actual message', responsePolicy: 'mentioned', mentions: [{ kind: 'agent', logicalAgentId: 'agent-a' }, { kind: 'agent', logicalAgentId: 'agent-b' }], idempotencyKey: 'original-native-message'
    });
    assert.equal(sent.ok, true);
    let effects = 0;
    const services = api.createDesktopServices({ dataRoot: path.join(domain, 'desktop'), runner: async () => { effects++; throw Error('component must not execute'); }, kswarmService: { request: async () => new Response('{}'), getDesktopMutationToken: () => '' } });
    cleanup.push(() => services.closeTaskSourceWritersForMigration());
    const workspace = new api.RoomWorkspaceLocalStore(path.join(domain, 'workspace.sqlite'));
    cleanup.push(() => workspace.close());
    const noClaim = async () => { throw Error('legacy direct runtime must not claim'); };
    const runtime = api.createRoomWorkspaceRuntime({
        store: workspace, broker: { get: noClaim, request: noClaim }, wake: { claimWake: noClaim, completeWake: noClaim }, execute: services.runCollaborationRoomAgentTask, ensureProtocol: noClaim
    });
    cleanup.push(() => runtime.shutdown());
    const dispatcher = api.createCollaborationRoomWakeDispatcher({
        brokerClient: client, execute: services.runCollaborationRoomAgentTask, executeTurn: runtime.run, canExecute: async () => true
    });
    const source = api.createOriginalRoomTurnSource({
        dispatcher, runtime, services, scope: { profileId: 'actual-profile', workspaceId: 'actual-workspace' }
    });
    cleanup.push(() => source.drain());
    const store = new api.FileTaskSnapshotStore(path.join(domain, 'tasks'));
    const population = api.createTaskSourceWriterPopulation(store);
    let hostRun = async () => { throw Error('Host SDK not authorized'); };
    const host = population.createHost({ materialRegistry: new api.MaterialRegistry({ workspaceRoot: path.join(domain, 'workspace'), maxBytes: 1024 }), runner: input => hostRun(input) });
    cleanup.push(() => population.close());
    const identity = await api.readOriginalTaskHostIdentityIO(host, store).initialize();
    let grepBaselineCases = [];
    if (mode === 'grep') {
        const search = path.join(domain, 'grep-owned');
        fs.mkdirSync(search);
        fs.writeFileSync(path.join(search, 'input.txt'), 'alpha\nneedle-one\nbeta\nneedle-two\nword12\nlast');
        const inputs = [{ pattern: 'needle' }, { pattern: '^(alpha|beta)$' }, { pattern: 'word[0-9]+' }, { pattern: 'needle', context: 1 }, { pattern: 'needle', output_mode: 'files' }, { pattern: 'needle', output_mode: 'count' }, { pattern: 'needle', offset: 1, head_limit: 1 }, { pattern: 'needle', max_chars: 24 }];
        for (const item of inputs) {
            const input = { ...item, path: search };
            grepBaselineCases.push({ input, output: await api.grepTool.execute(input) });
        }
        const unicode = path.join(domain, 'unicode.txt');
        fs.writeFileSync(unicode, '中文');
        const rust = await api.grepTool.execute({ pattern: '\\w+', path: unicode });
        const js = await api.runFallbackGrepSearch({ pattern: '\\w+', path: unicode });
        assert.match(rust, /中文/);
        assert.deepEqual(js, []);
    }
    const owner = api.createOriginalMainRootAdmissionOwner({ roomSource: source, host, store });
    const port = api.createOriginalMainRoomRootAdmissionPort({ roomSource: source, host, store });
    assert.equal(owner.room, port);
    assert.equal(typeof owner.physical, 'object');
    assert.equal(typeof owner.physical.acquireModel, 'function');
    assert.equal(typeof api.assertOriginalMainDshPhysicalComposition, 'function');
    let traps = 0;
    const foreign = new Proxy({}, { get() { traps++; throw Error('untrusted'); }, getOwnPropertyDescriptor() { traps++; throw Error('untrusted'); } });
    assert.throws(() => api.assertOriginalMainDshPhysicalComposition(foreign, foreign, foreign, foreign), /COMPOSITION_REQUIRED/);
    assert.equal(traps, 0);
    assert.equal(api.createOriginalMainRootAdmissionOwner({ roomSource: source, host, store }), owner);
    assert.throws(() => api.createOriginalMainRootAdmissionOwner({ roomSource: source, host: { ...host }, store }), /OWNER_ALREADY_BOUND/);
    cleanup.push(() => port.drain());
    const input = { roomId: created.room.roomId, roomMessageId: sent.message.messageId, logicalAgentIds: ['agent-a', 'agent-b'] };
    const proofs = await source.acceptMessage(input);
    assert.equal(proofs.length, 2);
    const first = await port.enqueueRoom(proofs[0]);
    const repeated = await port.enqueueRoom(proofs[0]);
    assert.equal(first.record.executionKey, repeated.record.executionKey);
    const second = await port.enqueueRoom(proofs[1]);
    assert.notEqual(first.record.executionKey, second.record.executionKey);
    const metadata = JSON.parse(first.record.metadataJson);
    assert.equal(metadata.hostId, identity.hostId);
    assert.equal(metadata.subject.messageId, input.roomMessageId);
    const reservation = await port.claimNext();
    assert.ok(reservation);
    const consumed = await port.consumeLaunch(reservation);
    assert.equal(consumed.newlyConsumed, true);
    assert.equal((await port.consumeLaunch(reservation)).newlyConsumed, false);
    const parent = api.readOriginalMainRootExecutionContext(owner, reservation);
    let resourceDone, resourceFail;
    const resources = new Promise((yes, no) => { resourceDone = yes; resourceFail = no; });
    leafProbe.withdraw=()=>runtime.shutdown();
    hostRun = async (input) => {
        try {
            const manager = new api.PermissionManager({ mode: 'auto' });
            let release;
            const held = new Promise(yes => { release = yes; });
            let childClosed = false, callbackSeen = false;
            const tool = { permission: 'safe', definition: { name: 'actual_process_sdk', description: 'owned SDK fixture', inputSchema: { type: 'object', properties: {} } }, async execute() {
                    const attempt = await api.spawnOriginalToolProcess(process.execPath, ['-e', 'process.stdout.write("actual-owned-process");'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
                    let closeDone;
                    const closeObserved = new Promise(yes => { closeDone = yes; });
                    api.listenOriginalToolProcess(attempt.attempt, 'stdout', 'data', () => { callbackSeen = true; return held; });
                    api.listenOriginalToolProcess(attempt.attempt, 'child', 'close', () => { childClosed = true; closeDone(); });
                    api.sealOriginalToolProcessListeners(attempt.attempt);
                    try {
                        await closeObserved;
                        assert.equal(childClosed, true);
                        assert.equal(callbackSeen, true);
                        const db = new (require('node:sqlite').DatabaseSync)(path.join(domain, 'root-resource-v1.sqlite'), { readOnly: true });
                        try {
                            assert.equal(db.prepare("SELECT COUNT(*) n FROM root_physical_resources WHERE resource_kind=2 AND state='reserved'").get().n, 1);
                        }
                        finally {
                            db.close();
                        }
                        release();
                        await assert.rejects(api.waitOriginalToolProcessPhysical(attempt.attempt), /TOOL_PROCESS_WHOLE_DOMAIN_UNCONFIRMED/);
                        return 'actual-component-unconfirmed';
                    }
                    finally {
                        release();
                        if (attempt.handle.exitCode === null && attempt.handle.signalCode === null)
                            attempt.handle.kill();
                    }
                } };
            const globTool = { permission: 'safe', definition: { name: 'actual_glob_sdk', description: 'original bounded Worker fixture', inputSchema: { type: 'object', properties: {} } }, async execute() {
                    const counts = [];
                    const hook = require('node:async_hooks').createHook({ init(_id, type) {
                            if (type !== 'WORKER')
                                return;
                            const db = new (require('node:sqlite').DatabaseSync)(path.join(domain, 'root-resource-v1.sqlite'), { readOnly: true });
                            try {
                                counts.push(db.prepare("SELECT COUNT(*) n FROM root_physical_resources WHERE resource_kind=2 AND state='reserved'").get().n);
                            }
                            finally {
                                db.close();
                            }
                        } });
                    const runner = api.createBoundedGlobRunner();
                    hook.enable();
                    try {
                        await leafProbe.run(runner,{ patterns: '*', cwd: domain });
                    }
                    finally {
                        hook.disable();
                    }
                    assert.deepEqual(counts, [], 'Native leaf must not nest a Worker');
                    if (leafCase === 'success') assert.deepEqual(leafProbe.go,[{reserved:1,intents:1,bindings:1}]);
                    else if (['sdk-error','sdk-undefined','abort-after-ready','source-revoke','source-revoke-before-ready','source-revoke-after-bind'].includes(leafCase)) assert.deepEqual(leafProbe.go,[]);
                    return 'actual-glob-known';
                } };
            const queueTool = { permission: 'safe', definition: { name: 'actual_queued_sdk', description: 'original queue withdrawal fixture', inputSchema: { type: 'object', properties: {} } }, async execute() {
                    const releases = leafProbe.releases;leafProbe.holdClosures=true;
                    let workers = 0;
                    const hook = require('node:async_hooks').createHook({ init(_id, type) {
                            if (type === 'WORKER')
                                workers++;
                        } });
                    hook.enable();
                    const holdTool = { permission: 'safe', definition: { name: 'hold_closed_worker', description: 'original fixed Worker callback', inputSchema: { type: 'object', properties: {} } }, async execute() {
                            await api.runOriginalBoundedReadonlyLeaf({
                                workerData: { input: { patterns: '*', cwd: domain }, limits: api.GLOB_LIMITS }, resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 }, execArgv: [], stdout: true, stderr: true
                            });
                            return 'worker-known';
                        } };
                    const holder = new api.ToolRegistry({ permissionManager: new api.PermissionManager({ mode: 'auto' }) }, [holdTool]);
                    const queuedManager = new api.PermissionManager({ mode: 'auto' }), queuedRegistry = new api.ToolRegistry({ permissionManager: queuedManager }, [globTool]);
                    const a = holder.executeTool('hold_closed_worker', {}, {}), b = holder.executeTool('hold_closed_worker', {}, {});
                    try {
                        while (leafProbe.closedReached < 2)
                            await new Promise(yes => setTimeout(yes, 1));
                        assert.equal(leafProbe.go.length,2);
                        const queued = queuedRegistry.executeTool('actual_glob_sdk', {}, {});
                        for (;;) {
                            const db = new (require('node:sqlite').DatabaseSync)(path.join(domain, 'root-resource-v1.sqlite'), { readOnly: true });
                            let n;
                            try {
                                n = db.prepare("SELECT COUNT(*) n FROM root_physical_resources WHERE resource_kind=2 AND state='queued'").get().n;
                            }
                            finally {
                                db.close();
                            }
                            if (n === 1)
                                break;
                            await new Promise(yes => setTimeout(yes, 1));
                        }
                        queuedManager.setMode('plan');
                        for (const release of releases)
                            release();
                        assert.deepEqual(await Promise.all([a, b]), ['worker-known', 'worker-known']);
                        assert.match(await queued, /tool authorization changed/);
                        assert.equal(workers, 0);
                        assert.equal(leafProbe.go.length,2,'withdrawn third request must enter zero Native payload SDK');
                    }
                    finally {
                        for (const release of releases)
                            release();
                        hook.disable();
                    }
                    return 'actual-queue-withdrawn';
                } };
            const sourceFaultTool = { permission: 'safe', definition: { name: 'actual_source_fault', description: 'original Source error tail', inputSchema: { type: 'object', properties: {} } }, async execute() {
                    let release, faultReached;
                    const held = new Promise(yes => { release = yes; }), reached = new Promise(yes => { faultReached = yes; });
                    const failure = Error('ORIGINAL_PRE_SDK_SOURCE_ERROR');
                    Object.defineProperty(failure, Symbol('actual-source-sdk-error-tail'), { value: held });
                    let faulty = false, done = false, workers = 0;
                    const hook = require('node:async_hooks').createHook({ init(_id, type) {
                            if (type === 'WORKER')
                                workers++;
                        } });
                    hook.enable();
                    const inner = { permission: 'safe', definition: { name: 'source_fault_worker', description: 'original P producer', inputSchema: { type: 'object', properties: {} } }, async execute() {
                            faulty = true;
                            try {
                                await api.runOriginalBoundedReadonlyLeaf({
                                    workerData: { input: { patterns: '*', cwd: domain }, limits: api.GLOB_LIMITS }, resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 }, execArgv: [], stdout: true, stderr: true
                                });
                                return 'unexpected-worker';
                            }
                            finally {
                                faulty = false;
                            }
                        } };
                    const original = new api.ToolRegistry({ permissionManager: new api.PermissionManager({ mode: 'auto' }) }, [inner]);
                    const pending = original.executeTool('source_fault_worker', {}, { assertPermissionApproval() {
                            if (faulty) {
                                faultReached();
                                throw failure;
                            }
                        } });
                    pending.then(() => { done = true; }, () => { done = true; });
                    try {
                        await reached;
                        await new Promise(yes => setImmediate(yes));
                        assert.equal(workers, 0);
                        assert.equal(done, false);
                    }
                    finally {
                        release();
                        hook.disable();
                    }
                    assert.match(await pending, /ORIGINAL_PRE_SDK_SOURCE_ERROR/);
                    return 'source-tail-known';
                } };
            const preconsumeTool = { permission: 'safe', definition: { name: 'actual_preconsume_fault', description: 'actual Native SDK wrapper negative fate', inputSchema: { type: 'object', properties: {} } }, async execute() {
                    let workers = 0, done = false;
                    const hook = require('node:async_hooks').createHook({ init(_id, type) { if (type === 'WORKER')
                            workers++; } });
                    const held = new Promise(yes => { consumeFaultRelease = yes; });
                    consumeSettlementRaw = held;
                    consumeFaultRevoke = () => { consumeRevokeRaw = runtime.shutdown(); };
                    consumeFault = mode === 'preconsume-undefined' ? undefined : Error('ORIGINAL_NATIVE_PRE_CONSTRUCT_FAILURE');
                    if (consumeFault)
                        Object.defineProperty(consumeFault, Symbol('original-native-wrapper-error-tail'), { value: held });
                    consumeFaultArmed = true;
                    hook.enable();
                    const pending = api.runOriginalBoundedReadonlyLeaf({
                        workerData: { input: { patterns: '*', cwd: domain }, limits: api.GLOB_LIMITS }, resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 }, execArgv: [], stdout: true, stderr: true
                    });
                    const observed = pending.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
                    observed.then(value => { done = true; fs.writeFileSync(path.join(domain, 'preconsume-observed.json'), JSON.stringify({
                        ok: value.ok, error: value.error?.stack || String(value.error), hits: consumeFaultHits, settleFaultHits, workers
                    })); });
                    try {
                        while (consumeFaultHits === 0 && !done)
                            await new Promise(yes => setImmediate(yes));
                        if (consumeFaultHits !== 1) {
                            const outcome = await observed;
                            throw Error('actual Native SDK wrapper must be hit: ' + String(outcome.error?.stack || outcome.error || outcome.ok));
                        }
                        assert.equal(workers, 0);
                        if (mode === 'preconsume-local')
                            while (settleFaultHits === 0 && !done)
                                await new Promise(yes => setImmediate(yes));
                        if (consumeFault) {
                            await new Promise(yes => setImmediate(yes));
                            assert.equal(done, false, 'creation must wait for the actual SDK negative settlement tail');
                        }
                        consumeFaultRelease();
                        const outcome = await observed;
                        assert.equal(outcome.ok, false);
                        if (mode === 'preconsume-local') {
                            assert.equal(settleFaultHits, 1);
                            assert.ok(outcome.error);
                            await consumeRevokeRaw;
                        }
                        else
                            assert.equal(outcome.error, consumeFault);
                        const db = new (require('node:sqlite').DatabaseSync)(path.join(domain, 'root-resource-v1.sqlite'), { readOnly: true });
                        try {
                            assert.equal(db.prepare("SELECT COUNT(*) n FROM root_physical_resources WHERE resource_kind=2 AND state IN ('reserved','queued')").get().n, 0);
                        }
                        finally {
                            db.close();
                        }
                        return 'preconsume-negative-known';
                    }
                    finally {
                        consumeFaultRelease();
                        hook.disable();
                    }
                } };
            const registry = new api.ToolRegistry({ permissionManager: manager }, [tool, globTool, queueTool, sourceFaultTool, preconsumeTool, api.grepTool]);
            if (mode === 'grep') {
                const counts = [];
                const hook = require('node:async_hooks').createHook({ init(_id, type) {
                        if (type !== 'WORKER')
                            return;
                        const db = new (require('node:sqlite').DatabaseSync)(path.join(domain, 'root-resource-v1.sqlite'), { readOnly: true });
                        try {
                            counts.push(db.prepare("SELECT COUNT(*) n FROM root_physical_resources WHERE resource_kind=2 AND state='reserved'").get().n);
                        }
                        finally {
                            db.close();
                        }
                    } });
                hook.enable();
                try {
                    const normalize = value => value.replace(/(input\.txt)[-:](\d+)[-:]/g, '$1:$2:');
                    for (const item of grepBaselineCases) {
                        const actual = await registry.executeTool('grep', item.input, {});
                        assert.equal(normalize(actual), normalize(item.output));
                    }
                    const before = counts.length;
                    assert.equal(await registry.executeTool('grep', { pattern: '\\w+', path: path.join(domain, 'unicode.txt') }, {}), 'Error: grep_native_regex_profile_unavailable');
                    assert.equal(counts.length, before);
                }
                finally {
                    hook.disable();
                }
                assert.deepEqual(counts, []);
                assert.equal(leafProbe.go.length,grepBaselineCases.length);
                assert.ok(leafProbe.go.every(row=>row.reserved===1 && row.intents===row.bindings));
            }
            else {
                const result = await registry.executeTool(mode === 'glob' ? 'actual_glob_sdk' : mode === 'queue' ? 'actual_queued_sdk' : mode === 'sourcefault' ? 'actual_source_fault' : mode.startsWith('preconsume') ? 'actual_preconsume_fault' : 'actual_process_sdk', {}, {});
                assert.equal(result, mode === 'glob' ? 'actual-glob-known' : mode === 'queue' ? 'actual-queue-withdrawn' : mode === 'sourcefault' ? 'source-tail-known' : mode.startsWith('preconsume') ? 'preconsume-negative-known' : 'actual-component-unconfirmed');
            }
            const db = new (require('node:sqlite').DatabaseSync)(path.join(domain, 'root-resource-v1.sqlite'), { readOnly: true });
            try {
                assert.equal(db.prepare("SELECT COUNT(*) n FROM root_physical_resources WHERE resource_kind=2 AND state='reserved'").get().n, mode === 'process' || leafCase === 'unknown-raw' ? 1 : 0);
            }
            finally {
                db.close();
            }
            resourceDone();
        }
        catch (error) {
            resourceFail(error);
            throw error;
        }
    };
    const siblingHost = population.createHost({ materialRegistry: new api.MaterialRegistry({ workspaceRoot: path.join(domain, 'sibling-materials'), maxBytes: 1024 }), runner: async () => { } });
    const foreignPopulation = api.createTaskSourceWriterPopulation(store), foreignHost = foreignPopulation.createHost({ materialRegistry: new api.MaterialRegistry({ workspaceRoot: path.join(domain, 'foreign-materials'), maxBytes: 1024 }), runner: async () => { } });
    const foreignStore = new api.FileTaskSnapshotStore(path.join(domain, 'foreign-store'));
    const foreignProvider = new api.DesktopTaskObservationStore(path.join(domain, 'foreign-provider'));
    const foreignVerifier = new api.DeliveryVerifier();
    const relationChecks = [];
    let privateTickets = 0;
    function checkReadonlyTicket() {
        const ticket = api.readCurrentOriginalHostWorkerTicket();
        assert.ok(ticket);
        privateTickets++;
        let traps = 0;
        const proxy = new Proxy(ticket, { get() { traps++; throw Error('unexpected ticket getter'); }, ownKeys() { traps++; throw Error('unexpected ticket keys'); }, getPrototypeOf() { traps++; throw Error('unexpected ticket prototype'); } });
        const copy = { ...ticket };
        assert.equal(api.readOptionalOriginalTaskHostDeliveryWorkerRequest(proxy), undefined);
        assert.equal(api.readOptionalOriginalTaskStoreProtectionWorkerRequest(proxy), undefined);
        assert.equal(api.readOptionalOriginalTaskHostDeliveryWorkerRequest(copy), undefined);
        assert.equal(api.readOptionalOriginalTaskStoreProtectionWorkerRequest(copy), undefined);
        assert.equal(traps, 0);
        const delivery = api.readOptionalOriginalTaskHostDeliveryWorkerRequest(ticket);
        if (delivery) {
            assert.equal(api.readOptionalOriginalTaskHostDeliveryWorkerContext(ticket, siblingHost, store).pOnly, true);
            assert.throws(() => api.readOptionalOriginalTaskHostDeliveryWorkerContext(ticket, foreignHost, store), /CONTEXT_REQUIRED/);
            assert.throws(() => api.readOptionalOriginalTaskHostDeliveryWorkerContext(ticket, host, foreignStore), /CONTEXT_REQUIRED/);
            // A real different verifier plus foreign snapshot/options cannot replay the
            // actual producer's ticket. The original in-method call checks the true tuple.
            assert.throws(() => api.readOptionalOriginalTaskHostDeliveryWorkerRequest(ticket, foreignVerifier, {}, {}), /REQUEST_REQUIRED/);
        }
        else {
            const request = api.readOptionalOriginalTaskStoreProtectionWorkerRequest(ticket);
            assert.ok(request);
            const taskId = request.options.workerData.taskId;
            assert.equal(api.readOptionalOriginalTaskStoreProtectionWorkerRequest(ticket, store.observations, taskId), request);
            assert.throws(() => api.readOptionalOriginalTaskStoreProtectionWorkerRequest(ticket, foreignProvider, taskId), /REQUEST_REQUIRED/);
            assert.throws(() => api.readOptionalOriginalTaskStoreProtectionWorkerRequest(ticket, store.observations, taskId + '-foreign'), /REQUEST_REQUIRED/);
            assert.equal(api.readOptionalOriginalTaskStoreProtectionWorkerContext(ticket, store).pOnly, true);
            assert.throws(() => api.readOptionalOriginalTaskStoreProtectionWorkerContext(ticket, foreignStore), /CONTEXT_REQUIRED/);
        }
        const rejected = owner.physical.acquireModel(ticket, 'readonly-must-not-model-' + privateTickets, 'a'.repeat(64));
        relationChecks.push(assert.rejects(rejected, /ROOT_RESOURCE_MODEL_CONTEXT_REQUIRED/));
        relationChecks.push(Promise.resolve().then(() => assert.equal(api.readCurrentOriginalHostWorkerTicket(), null)));
    }
    if (mode === 'protection') {
        const counts = [];
        const hook = require('node:async_hooks').createHook({ init(_id, type) {
                if (type !== 'WORKER')
                    return;
                checkReadonlyTicket();
                const db = new (require('node:sqlite').DatabaseSync)(path.join(domain, 'root-resource-v1.sqlite'), { readOnly: true });
                try {
                    counts.push(db.prepare("SELECT COUNT(*) n FROM root_physical_resources WHERE resource_kind=2 AND state='reserved'").get().n);
                }
                finally {
                    db.close();
                }
            } });
        hostRun = async (input) => {
            hook.enable();
            try {
                const pending = [];
                assert.ok(await store.recoverTask(input.taskId, { signal: input.signal, trackPending(raw) { pending.push(raw); } }));
                await Promise.allSettled(pending);
            }
            finally {
                hook.disable();
            }
            resourceDone();
        };
        await api.runWithOriginalRootExecutionContext(parent, () => host.createTask({ prompt: 'actual protected Store Worker read', materials: [] }));
        await resources;
        await host.drain();
        await Promise.all(relationChecks);
        assert.equal(privateTickets, counts.length);
        assert.ok(counts.length > 0);
        assert.ok(counts.every(n => n === 1), JSON.stringify(counts));
    }
    else if (mode === 'delivery') {
        const counts = [];
        const hook = require('node:async_hooks').createHook({ init(_id, type) {
                if (type !== 'WORKER')
                    return;
                checkReadonlyTicket();
                const db = new (require('node:sqlite').DatabaseSync)(path.join(domain, 'root-resource-v1.sqlite'), { readOnly: true });
                try {
                    counts.push(db.prepare("SELECT COUNT(*) n FROM root_physical_resources WHERE resource_kind=2 AND state='reserved'").get().n);
                }
                finally {
                    db.close();
                }
            } });
        const deliveryHost = population.createHost({
            materialRegistry: new api.MaterialRegistry({ workspaceRoot: path.join(domain, 'delivery-materials'), maxBytes: 1024 }), runner: async () => { }, getExecutionPolicy: () => ({ deliveryRepair: 'explicit' }), authorizePreparation: () => { }, onDeliveryReport: async (report) => report
        });
        deliveryHost.bindMultiAgentRecovery(Promise.resolve());
        const prepared = await deliveryHost.prepareTask({ prompt: 'actual finite delivery verifier', materials: [] }, { reservation: deliveryHost.reserveTaskIdentity(), marker: {
                groupId: 'fixture-g', rootEpoch: 1, rootTurnId: 'fixture-turn', preparationId: 'fixture-preparation', bootId: 'fixture-boot'
            } });
        hook.enable();
        try {
            await api.runWithOriginalRootExecutionContext(parent, () => deliveryHost.startTask(prepared.taskId));
            await deliveryHost.drain();
        }
        finally {
            hook.disable();
        }
        await Promise.all(relationChecks);
        assert.equal(privateTickets, counts.length);
        assert.ok(counts.length > 0);
        assert.ok(counts.every(n => n === 1), JSON.stringify(counts));
    }
    else {
        await api.runWithOriginalRootExecutionContext(parent, () => host.createTask({ prompt: 'original Native descendant resource path', materials: [] }));
        await resources;
        await host.drain();
    }
    await foreignStore.closeAndDrain();
    assert.equal(effects, 0);
    return {
        leafCase, actualMain: true, actualBroker: true, actualHostIdentity: identity.hostId, opaqueAcceptedSource: true, nativeConsumedOnce: true, modelEffects: effects, notProductNQualification: true, componentOnly: mode === 'process' || leafCase === 'unknown-raw'
    };
}
let failed = false, primary;
run().then(async (facts) => {
    if (!facts.componentOnly)
        for (let i = cleanup.length - 1; i >= 0; i--)
            try {
                await cleanup[i]();
            }
            catch (error) {
                if (!failed) {
                    failed = true;
                    primary = error;
                }
            }
    if (failed)
        throw primary;
    fs.writeFileSync(result + '.tmp', JSON.stringify({ pid: process.pid, ok: true, ...facts }), { flag: 'wx', mode: 0o600 });
    fs.renameSync(result + '.tmp', result);
}, async (error) => {
    process.stderr.write('ORIGINAL_PROCESS_FIXTURE_FAILURE_NO_PRODUCT_DRAIN\n');
    throw error;
}).catch(error => { failed = true; process.stderr.write((error?.stack || String(error)) + '\n'); fs.writeFileSync(result, JSON.stringify({ pid: process.pid, ok: false, error: error?.stack || String(error) })); }).finally(() => app.exit(failed ? 1 : 0));
