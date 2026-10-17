import { assertControllerMaterialPipelineDatabase } from './material-pipeline.js';
import { consumeExecutionCommandContext } from '../isolated-execution/docker-runner.js';
import { createApprovedBlackboxStager } from './approved-blackbox-stager.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { assertInstalledMacEngineHandle, assertInstalledEngineDatabase } from './installed-engine.js';
import { assertInstalledEngineQualification } from './installed-engine-qualification.js';
import { canonicalVerificationJson as json } from './protocol.js';
import { DockerEngineTransport } from '../isolated-execution/docker-engine-transport.js';
import { createDockerRunner } from '../isolated-execution/docker-runner.js';
const hash = (value) => createHash('sha256').update(json(value)).digest('hex');
const principal = (peer) => json(peer);
function shape(raw, keys) { const text = json(raw); if (Buffer.byteLength(text) > 1024 ** 2)
    throw Error('execution_request_size'); const value = JSON.parse(text); if (!value || Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
    throw Error('execution_request_shape'); return value; }
const materialExecutionCommands = new WeakMap();
export function inspectMaterialExecutionCommand(command, raw, database) { const facts = materialExecutionCommands.get(command); if (!facts)
    return false; if (facts.raw !== raw || facts.database !== database)
    throw Error('execution_command_owner'); return true; }
export function executeMaterialExecutionCommand(command, context) { const facts = materialExecutionCommands.get(command); if (!facts)
    return false; const transaction = consumeExecutionCommandContext(context, facts.raw, facts.database, command); const reserved = facts.raw.reserveExecution(facts.input, transaction); facts.reservation = reserved; facts.materials.attachMountPlanHandoff(facts.handoff, transaction, reserved.expected); return true; }
/** Actual installed private composition. No fake engine/qualification callback can
 * reach the receipt issuer; only publicPort is registered on authenticated IPC. */
export function createInstalledExecutionController(input) {
    const installed = input.engine;
    assertInstalledMacEngineHandle(installed);
    const { database, qualification, budget, materials, resolveOwnerKey, onActualExecutionResult } = input;
    assertInstalledEngineDatabase(installed, database);
    assertControllerMaterialPipelineDatabase(materials, database);
    assertInstalledEngineQualification(qualification, installed);
    if (typeof onActualExecutionResult !== 'function')
        throw Error('execution_transcript_required');
    const consumePlan = materials.consumeMountPlan, getManifest = materials.stager.getManifest.bind(materials.stager), engineBinding = qualification.currentFacts().engineBinding, lifetime = new AbortController();
    const caseStager = createApprovedBlackboxStager({ stager: materials.stager, readApprovedRecipeBinding: input.readApprovedRecipeBinding });
    const raw = createDockerRunner({ database, budget, engine: new DockerEngineTransport({ socketPath: installed.hostSocket }), engineBinding: { ...engineBinding, epoch: 1 }, imageId: installed.imageDigest, assertCurrent() { assertInstalledMacEngineHandle(installed); }, stager: caseStager, outputBytes: 16 * 1024 ** 2 });
    const handles = new Map(), receipts = new WeakMap(), active = new Set();
    let closing;
    function current() { lifetime.signal.throwIfAborted(); assertInstalledMacEngineHandle(installed); }
    function checkOwner(peer, expected) { current(); const owner = resolveOwnerKey(peer, { sessionIdentity: expected.sessionIdentity, compoundOperationId: expected.compoundOperationId, validationInvocationId: expected.validationInvocationId }); if (typeof owner !== 'string' || owner !== raw.readOwnerKey(expected))
        throw Error('execution_owner'); }
    async function qualified(signal) { await qualification.ensureCurrent(signal); assertInstalledEngineQualification(qualification, installed); if (hash(qualification.currentFacts().engineBinding) !== hash(engineBinding))
        throw Error('execution_engine_changed'); }
    async function cancelPrepared(expected) { try {
        const state = raw.readExecution(expected);
        if (state.state === 'prepared')
            raw.cancelPreparedExecution(expected);
        const after = raw.readExecution(expected);
        if (after.cancelledBeforeStart || after.state === 'cancelling-created')
            await raw.cleanupExecution(expected);
    }
    catch { /* Durable prepared/cancellation/unknown resources remain inspectable; never report a refund. */ } }
    const quiescence = Object.freeze({
        async inspectExecution(expected) { current(); await qualified(); const record = raw.readExecution(expected); if (record.cancelledBeforeStart)
            await raw.inspectCancellationFacts(expected);
        else
            await raw.inspectExecutionFacts(expected); assertInstalledEngineQualification(qualification, installed); const receipt = Object.freeze({}); receipts.set(receipt, JSON.parse(json(expected))); return receipt; },
        assertQuiescent(receipt, expected) { current(); assertInstalledEngineQualification(qualification, installed); const fact = receipts.get(receipt); if (!fact || hash(fact) !== hash(expected) || raw.readExecution(expected).state !== 'terminal')
            throw Error('execution_receipt'); },
    });
    function physical(receipt, expected) { quiescence.assertQuiescent(receipt, expected); return { expected, engineId: engineBinding.engineId, engineEpoch: engineBinding.incarnation, quiescent: true }; }
    async function invoke(method, payload, peerInput, signal) {
        current();
        const peer = Object.freeze({ ...peerInput }), combined = AbortSignal.any([signal, lifetime.signal]);
        if (method === 'execution.reserve') {
            const request = shape(payload, ['mountPlanHandle', 'invocation', 'command', 'scopeDigest']), authorized = consumePlan(request.mountPlanHandle, peer);
            let expected;
            try {
                await qualified(combined);
                current();
                combined.throwIfAborted();
                const manifest = getManifest(authorized.plan);
                if (hash(manifest.invocation) !== hash(request.invocation) || hash(manifest.command) !== hash(request.command) || manifest.scopeDigest !== request.scopeDigest)
                    throw Error('execution_material_binding');
                const ownerKey = resolveOwnerKey(peer, manifest.invocation);
                if (typeof ownerKey !== 'string' || !ownerKey)
                    throw Error('execution_owner');
                if (handles.size >= 4096)
                    throw Error('execution_handle_limit');
                const command = Object.freeze({}), facts = { database, raw, materials, input: { ...manifest.invocation, ownerKey, scopeDigest: manifest.scopeDigest, command: manifest.command, materializedInput: authorized.plan }, handoff: authorized.handoff };
                materialExecutionCommands.set(command, facts);
                try {
                    raw.reserveCommand(command);
                }
                finally {
                    expected = facts.reservation?.expected;
                    materialExecutionCommands.delete(command);
                }
                const reserved = facts.reservation;
                if (!reserved)
                    throw Error('execution_command_result');
                expected = reserved.expected;
                const id = randomUUID(), secret = randomBytes(32).toString('hex');
                handles.set(id, { secretHash: hash(secret), principal: principal(peer), expected });
                return { ...reserved, executionHandle: { id, secret } };
            }
            catch (error) {
                if (expected) {
                    if (database.prepare('SELECT 1 FROM execution_attempts WHERE execution_id=?').get(expected.executionIdentity))
                        await cancelPrepared(expected);
                    else
                        raw.discardUncommittedExecution(expected);
                }
                throw error;
            }
        }
        if (method === 'execution.dispatch') {
            const request = shape(payload, ['expected', 'executionHandle']), handle = shape(request.executionHandle, ['id', 'secret']), record = handles.get(handle.id);
            if (record)
                handles.delete(handle.id); // Consume before checks or any await, including rejection.
            if (!record)
                throw Error('execution_handle');
            try {
                if (record.secretHash !== hash(handle.secret) || record.principal !== principal(peer) || hash(record.expected) !== hash(request.expected))
                    throw Error('execution_handle');
                checkOwner(peer, record.expected);
                await qualified(combined);
                checkOwner(peer, record.expected);
                combined.throwIfAborted();
                const result = await raw.dispatchExecution(record.expected, { signal: combined }), out = raw.readCapturedOutput(result.output, { expected: record.expected }), receipt = await quiescence.inspectExecution(record.expected);
                const archived = onActualExecutionResult({ expected: record.expected, output: result.output, receipt }, raw);
                if (archived !== undefined) {
                    void Promise.resolve(archived).catch(() => { });
                    throw Error('execution_transcript_sync');
                }
                checkOwner(peer, record.expected);
                quiescence.assertQuiescent(receipt, record.expected);
                raw.assertOutputDisclosure(result.output, { expected: record.expected });
                return { expected: record.expected, exitCode: result.exitCode, termination: 'terminal', outputTruncated: out.truncated || !out.complete, stdout: out.stdout.toString('utf8'), stderr: out.stderr.toString('utf8'), physical: physical(receipt, record.expected) };
            }
            catch (error) {
                await cancelPrepared(record.expected);
                throw error;
            }
        }
        if (method === 'execution.quiescence') {
            const request = shape(payload, ['expected']);
            checkOwner(peer, request.expected);
            const receipt = await quiescence.inspectExecution(request.expected);
            checkOwner(peer, request.expected);
            return physical(receipt, request.expected);
        }
        throw Error('execution_method');
    }
    return Object.freeze({ deletionAuthority: raw.deletionAuthority, publicPort: Object.freeze({ invoke(method, payload, peer, signal) { const task = invoke(method, payload, peer, signal); active.add(task); void task.then(() => active.delete(task), () => active.delete(task)); return task; } }), privateHost: Object.freeze({ raw, quiescence, caseStager }),
        close() { return closing ??= (async () => { lifetime.abort(); await Promise.allSettled([...active]); for (const record of handles.values())
            await cancelPrepared(record.expected); handles.clear(); caseStager.close(); raw.close(); })(); }, });
}
