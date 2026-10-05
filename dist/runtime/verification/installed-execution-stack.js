import { claimInstalledCapacityStackConstruction, assertInstalledAssemblyLifetime, resolveInstalledVerificationOwner, createInstalledVerificationCapacityBinding, readInstalledApprovedRecipe, assertInstalledInputCleanup, assertInstalledTranscriptRead, assertInstalledTranscriptDelete, assertInstalledRunDelete, assertInstalledRunStart, assertInstalledRunRead } from './installed-controller.js';
import { assertInstalledSharedCapacity, registerInstalledCapacityIssuer } from './installed-shared-capacity.js';
import { assertInstalledRootBrokerClient } from './root-broker-client.js';
import { createStagingFactualCleanup } from './staging-factual-cleanup.js';
import { join } from 'node:path';
import { assertInstalledControllerLifetime } from './installed-controller-lifetime.js';
import { initializeInstalledMacEngine } from './installed-engine.js';
import { createInstalledEngineQualification } from './installed-engine-qualification.js';
import { createControllerMaterialPipeline } from './material-pipeline.js';
import { createInstalledExecutionController } from './installed-execution-controller.js';
import { createExecutionTranscriptStore } from './execution-transcripts.js';
import { setImmediate as yieldRecoveryBatch } from 'node:timers/promises';
import { createApprovedBlackboxExecutor } from './approved-blackbox-executor.js';
import { createProtectedRunLedger } from './protected-run-ledger.js';
import { ExecutionJournal } from '../isolated-execution/execution-journal.js';
import { canonicalVerificationJson as json } from './protocol.js';
const installedStacks = new WeakMap();
const capacityConstructions = new WeakMap();
export function assertInstalledStackCapacityComponent(ticket, owner, slot, component, engine) { const state = capacityConstructions.get(ticket); if (!state || state.owner !== owner || state.components.get(slot) !== component || slot === 'qualification' && state.engine !== engine)
    throw Error('installed_capacity_construction'); assertInstalledControllerLifetime(state.lifetime); }
export function assertInstalledExecutionStack(value, lifetime) { const facts = installedStacks.get(value); if (!facts || facts.lifetime !== lifetime)
    throw Error('installed_stack_identity'); if (facts.closed)
    throw Error('installed_stack_closed'); assertInstalledControllerLifetime(lifetime); }
/** Fixed installed stack, not a factory for caller-provided engines or keys.
 * Entry must provide actual same-authority ACL implementations and close public
 * admission before closing its lifetime. No default authorization callbacks. */
export async function createInstalledExecutionStack(input) {
    const lifetime = input.lifetime;
    assertInstalledControllerLifetime(lifetime);
    const { assembly, signal } = input;
    assertInstalledAssemblyLifetime(assembly, lifetime);
    const sharedOwner = input.sharedCapacity, actualBroker = input.broker;
    assertInstalledSharedCapacity(sharedOwner, lifetime, true);
    assertInstalledRootBrokerClient(actualBroker, lifetime);
    const construction = claimInstalledCapacityStackConstruction(assembly, sharedOwner), constructionFacts = { owner: sharedOwner, lifetime, components: new Map() };
    capacityConstructions.set(construction, constructionFacts);
    function bindCapacity(slot, component, engine) { if (constructionFacts.components.has(slot))
        throw Error('installed_capacity_construction'); constructionFacts.components.set(slot, component); if (engine)
        constructionFacts.engine = engine; registerInstalledCapacityIssuer(sharedOwner, slot, component, engine, construction); }
    const capacityOwner = (peer, invocation) => createInstalledVerificationCapacityBinding(assembly, peer, invocation), resolveOwnerKey = (peer, invocation) => resolveInstalledVerificationOwner(assembly, peer, invocation), readApprovedRecipeBinding = binding => readInstalledApprovedRecipe(assembly, binding);
    const cleanup = (id) => assertInstalledInputCleanup(assembly, id), read = (...args) => assertInstalledTranscriptRead(assembly, ...args), remove = (...args) => assertInstalledTranscriptDelete(assembly, ...args), db = lifetime.database, admission = new AbortController(), identity = { lifetime, closed: false };
    function current() { if (identity.closed)
        throw Error('installed_stack_closed'); assertInstalledControllerLifetime(lifetime); }
    let materialCleanup;
    let blackbox;
    let qualification, materials, execution, transcripts, runs;
    const budget = sharedOwner.budget;
    async function drainOwners() { const errors = []; for (const close of [() => materialCleanup?.close(), () => blackbox?.close(), () => execution?.close(), () => runs?.close(), () => transcripts?.close(), () => qualification?.close()])
        try {
            await close();
        }
        catch (error) {
            errors.push(error);
        } if (errors.length)
        throw new AggregateError(errors, 'installed_stack_shutdown_unknown'); identity.closed = true; }
    try {
        // Broker and shared capacity are borrowed; root closes them after all owners drain.
        // The actual separate OS lifetime lock was acquired before this recovery. It
        // only marks unresolved execution unknown; no guest receipt is invented.
        const recovery = new ExecutionJournal({ database: db });
        try {
            recovery.recoverInterrupted();
        }
        finally {
            recovery.close();
        }
        const engine = await initializeInstalledMacEngine({ database: db, signal });
        constructionFacts.engine = engine;
        current();
        qualification = createInstalledEngineQualification({ engine, database: db, budget });
        bindCapacity('qualification', qualification, engine);
        await qualification.ensureCurrent(signal);
        current();
        materials = createControllerMaterialPipeline({ root: join(lifetime.state, 'staging'), database: db, budget, engineBinding: qualification.currentFacts().engineBinding, broker: actualBroker, assertCurrent: current, assertCleanup: cleanup, resolveOwnerKey, createCapacityOwnerBinding: capacityOwner });
        bindCapacity('materials', materials);
        execution = createInstalledExecutionController({ engine, database: db, qualification, budget, materials, resolveOwnerKey, readApprovedRecipeBinding, onActualExecutionResult(result, raw) { if (!transcripts)
                throw Error('installed_transcript_not_initialized'); transcripts.record({ ownerKey: raw.readOwnerKey(result.expected), ...result }); if (runs?.hasExecution(result.expected))
                runs.recordActualExecution(result); } });
        bindCapacity('execution', execution.privateHost.raw);
        transcripts = createExecutionTranscriptStore({ root: join(lifetime.state, 'transcripts'), database: db, budget, assertCurrent: current, execution: execution.privateHost.raw, quiescence: execution.privateHost.quiescence, access: { assertRead: read, assertDelete: remove } });
        bindCapacity('transcripts', transcripts);
        runs = createProtectedRunLedger({ root: join(lifetime.state, 'protected-runs'), database: db, budget, assertCurrent: current, execution: execution.privateHost.raw, quiescence: execution.privateHost.quiescence, access: { assertStart: (...args) => assertInstalledRunStart(assembly, ...args), assertRead: (...args) => assertInstalledRunRead(assembly, ...args), assertDelete: (...args) => assertInstalledRunDelete(assembly, ...args) } });
        bindCapacity('runs', runs);
        // Only reconcile already durable deletion facts. No body deletion or native
        // approval is replayed; normal admission remains closed until these pages finish.
        for (const archive of [transcripts, runs]) {
            let after;
            do {
                current();
                admission.signal.throwIfAborted();
                const page = archive.reconcileDeletedBudget({ limit: 64, ...(after ? { after } : {}) });
                if (page.nextCursor === null)
                    break;
                if (after !== undefined && page.nextCursor <= after)
                    throw Error('installed_archive_recovery_cursor');
                after = page.nextCursor;
                await yieldRecoveryBatch(undefined, { signal: admission.signal });
            } while (true);
        }
        blackbox = createApprovedBlackboxExecutor({ assembly, database: db, raw: execution.privateHost.raw, caseStager: execution.privateHost.caseStager, quiescence: execution.privateHost.quiescence });
        const originalCleanupEngine = json(qualification.currentFacts().engineBinding), cleanupQualification = qualification;
        materialCleanup = createStagingFactualCleanup({ database: db, materials, raw: execution.privateHost.raw, quiescence: execution.privateHost.quiescence, assertCurrent: current, async ensureQualified(signal) { await cleanupQualification.ensureCurrent(signal); if (json(cleanupQualification.currentFacts().engineBinding) !== originalCleanupEngine)
                throw Error('staging_cleanup_engine_changed'); } });
        const actualBlackbox = blackbox, actualRuns = runs;
        const actualExecution = execution, actualMaterials = materials, actualQualification = qualification, actualTranscripts = transcripts, active = new Set();
        let closing;
        function shape(raw, keys) { const value = JSON.parse(json(raw)); if (!value || Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
            throw Error('installed_stack_shape'); return value; }
        async function invoke(method, payload, peer, callerSignal) {
            current();
            const activeSignal = AbortSignal.any([callerSignal, admission.signal]);
            activeSignal.throwIfAborted();
            if (method === 'controller.qualification') {
                shape(payload, []);
                await actualQualification.ensureCurrent(activeSignal);
                current();
                return { ...actualQualification.currentFacts(), authorityId: lifetime.manifest.authorityId, serviceEpoch: lifetime.serviceEpoch, deploymentPackageHash: lifetime.manifest.packageHash };
            }
            if (method === 'materials.prepareRequest')
                return actualMaterials.prepareRequest(payload, peer, activeSignal);
            if (method === 'materials.lookupRequest')
                return actualMaterials.lookupRequest(payload, peer);
            if (method === 'materials.retireRequest')
                return actualMaterials.retireRequest(payload, peer);
            if (method === 'materials.prepare')
                return actualMaterials.prepare(payload, peer, activeSignal);
            if (method === 'materials.authorize') {
                const p = shape(payload, ['challengeId']);
                return actualMaterials.authorize(p.challengeId, peer, activeSignal);
            }
            if (method === 'materials.stage') {
                const p = shape(payload, ['grantHandle', 'invocation']);
                return actualMaterials.stage(p, peer, activeSignal);
            }
            if (['execution.reserve', 'execution.dispatch', 'execution.quiescence'].includes(method))
                return actualExecution.publicPort.invoke(method, payload, peer, activeSignal);
            throw Error('installed_stack_method');
        }
        materialCleanup.startMaintenance();
        const result = Object.freeze({ publicPort: Object.freeze({ invoke(method, payload, peer, callerSignal) { const work = invoke(method, payload, peer, callerSignal); active.add(work); void work.then(() => active.delete(work), () => active.delete(work)); return work; } }), privateHost: Object.freeze({ materialCleanup, engine, broker: actualBroker, budget, qualification: actualQualification, materials: actualMaterials, execution: actualExecution, transcripts: actualTranscripts, runs: actualRuns, blackbox: actualBlackbox }),
            close() { return closing ??= (async () => { admission.abort(); await Promise.allSettled([...active]); await drainOwners(); })(); }, });
        installedStacks.set(result, identity);
        return result;
    }
    catch (error) {
        admission.abort();
        try {
            await drainOwners();
        }
        catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'installed_stack_construction_cleanup_unknown');
        }
        throw error;
    }
}
