import { assertSessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
import { runCompoundObservationPublication } from './compound-publication-producer.js';
import { computeSessionHistoryDigest } from '../../ai/runtime/session-store/store.js';
import { getProfileDisclosureAccountBinding } from './profile-disclosure-ledger.js';
import { randomUUID, createHash } from 'node:crypto';
import { getProviderAncestorAdmissionBinding } from './compound-provider-admission.js';
import { wrapNativeObservationHistory, createNativeObservationProvenance, readFinalizedObservationProvenance } from './observation-provenance.js';
import { realpathSync } from 'node:fs';
import { relative, isAbsolute, sep } from 'node:path';
import { planObservationRequest } from './request-projection.js';
import { mergeProtectedObservationClosures } from '../../ai/runtime/protected-observation-closure.js';
import { createTransportLeaseIssuer } from './transport-lease.js';
import { createProviderDisclosureContext } from './provider-disclosure.js';
import { assertCapacityProfileReady, getCapacityProfileBudget, measureRequestCapacity } from './capacity-admission.js';
/** Exact, host-constructed source selector. Source text is hashed by the service. */
export function describeObservationSource(input) {
    if (input.toolName === 'read' && 'filePath' in input.source) {
        return JSON.stringify({ toolName: 'read', filePath: input.source.filePath, offset: input.source.offset,
            ...(input.source.limit === undefined ? {} : { limit: input.source.limit }) });
    }
    if (input.toolName === 'bash' && 'command' in input.source) {
        return JSON.stringify({ toolName: 'bash', command: input.source.command, workdir: input.source.workdir });
    }
    throw new Error('SOL_PI_SOURCE_NOT_SUPPORTED');
}
const compoundPublishers = new WeakMap();
/** Host factory only. The returned one-shot projector stays in Registry's private
 * execution stack; native tools never receive the lease or publication capability. */
export function bindCompoundObservationPublisher(input) {
    const { owner, store, root } = input;
    const binding = getObservationSessionOwnerHostBinding(owner), session = binding.session;
    const sessionIdentity = session.exportSnapshot().sessionId;
    const project = compoundPublishers.get(owner);
    if (!project || !store.compareAndSave)
        throw Error('compound_publication_owner_unavailable');
    return (invocationId, lease) => {
        let consumed = false;
        const assertCurrent = () => { owner.assertSession(session); assertSessionExecutionLease(lease, { root, sessionIdentity }); };
        assertCurrent();
        return async (nativeResult) => {
            if (consumed)
                throw Error('compound_publication_consumed');
            consumed = true;
            assertCurrent();
            return project(invocationId, nativeResult, async (snapshot) => {
                assertCurrent();
                if (snapshot.sessionId !== sessionIdentity)
                    throw Error('compound_publication_session_mismatch');
                const basis = session.getPublishedHistoryBasis();
                const next = structuredClone(snapshot), revision = session.planCompaction().sourceRevision;
                const historyDigest = computeSessionHistoryDigest(next), closure = JSON.stringify(next.protectedObservationClosure);
                const previous = await store.load(sessionIdentity);
                assertCurrent();
                if (!previous)
                    throw Error('compound_publication_snapshot_missing');
                if (previous.historyDigest !== basis)
                    throw Error('compound_publication_history_stale');
                await store.compareAndSave({ expectedStoreRevision: previous.storeRevision, expectedHistoryDigest: previous.historyDigest, nextSnapshot: next, lease, beforeCommit: () => {
                        assertCurrent();
                        const live = session.exportSnapshot();
                        if (session.planCompaction().sourceRevision !== revision || computeSessionHistoryDigest(live) !== historyDigest || JSON.stringify(live.protectedObservationClosure) !== closure)
                            throw Error('compound_publication_history_changed');
                    } });
                session.notePublishedHistory(next, basis);
            });
        };
    };
}
const ownerBindings = new WeakMap();
const closedReadOwners = new WeakMap();
const closedReadAnchors = new WeakMap();
/** No execution port: only this actual owner's completed disposal can seal it. */
export function getObservationClosedReadAnchor(owner) {
    const anchor = closedReadOwners.get(owner);
    if (!anchor || !closedReadAnchors.has(anchor))
        throw new Error('SOL_PI_CLOSED_SOURCE_READ_UNAVAILABLE');
    return anchor;
}
export function getObservationClosedReadBinding(anchor, recipientOwner) {
    const source = closedReadAnchors.get(anchor), recipient = getObservationSessionOwnerHostBinding(recipientOwner);
    if (!source?.references || source.service !== recipient.service)
        throw new Error('SOL_PI_CLOSED_SOURCE_READ_UNAVAILABLE');
    const validate = () => {
        recipientOwner.assertSession(recipient.session);
        source.service.assertConsumerExecution(recipient.caller, recipient.session.exportSnapshot().sessionId, recipient.destination);
        if (source.destination.provider !== recipient.destination.provider || source.destination.model !== recipient.destination.model || source.destination.url !== recipient.destination.url)
            throw new Error('SOL_PI_CLOSED_SOURCE_READ_DESTINATION');
        source.service.assertClosedSourceRead({ source: source.caller, recipient: recipient.caller, destination: recipient.destination, observationIds: source.references.map(ref => ref.observationId) });
        const closure = recipient.session.getProtectedObservationClosure()?.observations ?? [];
        for (const reference of source.references) {
            if (!closure.some(item => JSON.stringify(item) === JSON.stringify(reference))
                || JSON.stringify(source.service.getReferenceMetadata(recipient.caller, reference.observationId)) !== JSON.stringify(reference))
                throw new Error('SOL_PI_CLOSED_SOURCE_READ_CLOSURE');
        }
    };
    return Object.freeze({ service: source.service, validate, current: validate });
}
const publishedClosureReads = new WeakMap();
/** Actual publication writers only: no caller-supplied body or reference set. */
export function capturePublishedClosureRead(sourceOwner, recipientOwner) {
    const source = getObservationSessionOwnerHostBinding(sourceOwner), recipient = getObservationSessionOwnerHostBinding(recipientOwner), snapshot = source.session.exportSnapshot(), historyDigest = computeSessionHistoryDigest(snapshot);
    if (snapshot.executionProtected && source.session.getPublishedHistoryBasis() !== historyDigest)
        throw Error('published_message_history_not_durable');
    // Ordinary D1 publishes reference metadata through its original private map.
    // assertSession above already rejects injected or not-yet-published refs.
    if (!snapshot.executionProtected && !/^[a-f0-9]{64}$/.test(source.session.getPublishedHistoryBasis()))
        throw Error('published_message_history_not_durable');
    return restorePublishedClosureRead(sourceOwner, recipientOwner, { version: 1, sourceSessionId: snapshot.sessionId, recipientSessionId: recipient.session.exportSnapshot().sessionId, historyDigest: snapshot.executionProtected ? historyDigest : source.session.getPublishedHistoryBasis(), closure: mergeProtectedObservationClosures(undefined, snapshot.protectedObservationClosure) ?? { version: 1, requiresReauthorization: true, observations: [] } });
}
/** Host Main recovery only, after verifying the original immutable SQLite row.
 * This descriptor is not authority: both restored owners and every original
 * reference must still have current grants before a fresh anchor is returned. */
export function restorePublishedClosureRead(sourceOwner, recipientOwner, value) {
    const source = ownerBindings.get(sourceOwner), recipient = getObservationSessionOwnerHostBinding(recipientOwner);
    if (!source || source.service !== recipient.service || value.version !== 1 || Object.keys(value).sort().join(',') !== 'closure,historyDigest,recipientSessionId,sourceSessionId,version' || value.sourceSessionId !== source.session.exportSnapshot().sessionId || value.recipientSessionId !== recipient.session.exportSnapshot().sessionId || !/^[a-f0-9]{64}$/.test(value.historyDigest))
        throw Error('published_message_source_mismatch');
    const closure = mergeProtectedObservationClosures(undefined, value.closure);
    const anchor = Object.freeze({});
    publishedClosureReads.set(anchor, { facts: structuredClone({ ...value, closure }), source, recipientOwner });
    getPublishedClosureReadBinding(anchor).validate();
    return anchor;
}
export function getPublishedClosureReadBinding(anchor) {
    const entry = publishedClosureReads.get(anchor);
    if (!entry)
        throw Error('published_message_anchor_required');
    const { source, recipientOwner, facts } = entry;
    const validate = () => {
        const recipient = getObservationSessionOwnerHostBinding(recipientOwner);
        source.service.assertConsumerExecution(recipient.caller, facts.recipientSessionId, recipient.destination);
        source.service.assertPublishedSourceRead({ source: source.caller, recipient: recipient.caller, destination: recipient.destination, observationIds: facts.closure.observations.map(ref => ref.observationId) });
        const closure = recipient.session.getProtectedObservationClosure()?.observations ?? [];
        for (const ref of facts.closure.observations)
            if (!closure.some(item => JSON.stringify(item) === JSON.stringify(ref)) || JSON.stringify(source.service.getReferenceMetadata(recipient.caller, ref.observationId)) !== JSON.stringify(ref))
                throw Error('published_message_closure_changed');
    };
    return Object.freeze({ service: source.service, facts: structuredClone(facts), validate, current: validate });
}
const providerAdmissionOwners = new WeakMap();
const providerAdmissionBinders = new WeakMap();
/** Host child installer only; must run before the first provider preparation. */
export function bindObservationProviderAdmission(owner, capability) {
    const bind = providerAdmissionBinders.get(owner);
    if (!bind)
        throw new Error('SOL_PI_OBSERVATION_AUTHORIZATION_OWNER_UNKNOWN');
    bind(capability);
}
const publicationBarrierBinders = new WeakMap();
/** Additional host durability barrier, never an authorization or tool capability. Fixed before first publication. */
export function bindObservationPublicationBarrier(owner, barrier) {
    const bind = publicationBarrierBinders.get(owner);
    if (!bind || typeof barrier !== 'function')
        throw new Error('SOL_PI_OBSERVATION_AUTHORIZATION_OWNER_UNKNOWN');
    bind(barrier);
}
/** Host factory introspection; persisted DTOs and ordinary owner-shaped objects have no binding. */
export function getObservationSessionOwnerHostBinding(owner) {
    const binding = ownerBindings.get(owner);
    if (!binding)
        throw new Error('SOL_PI_OBSERVATION_AUTHORIZATION_OWNER_UNKNOWN');
    owner.assertSession(binding.session);
    return binding;
}
const projectionBindings = new WeakMap();
/** Host-only composition: the tool context never receives this wrapping capability. */
export function composeCompoundObservationResult(owner, invocationId, before, body, after) {
    const binding = getObservationSessionOwnerHostBinding(owner);
    owner.assertSession(binding.session);
    if (typeof before !== 'string' || typeof body !== 'string' || typeof after !== 'string')
        throw new Error('SOL_PI_COMPOUND_RESULT_INVALID');
    const port = projectionBindings.get(owner)?.provenance.get(invocationId);
    if (port)
        wrapNativeObservationHistory(port, before, body, after);
    return before + body + after;
}
/** Host-only adoption. Caller must already have exact source authorization;
 * model-supplied reference lists cannot invent the child's sticky footprint. */
export async function adoptDelegatedObservationClosure(parentOwner, childOwner) {
    return runCompoundObservationPublication(parentOwner, async () => {
        const parent = getObservationSessionOwnerHostBinding(parentOwner), child = getObservationSessionOwnerHostBinding(childOwner);
        if (parent.service !== child.service)
            throw new Error('SOL_PI_OBSERVATION_AUTHORIZATION_CROSS_AUTHORITY');
        const target = projectionBindings.get(parentOwner), source = projectionBindings.get(childOwner);
        const closure = child.session.getProtectedObservationClosure()?.observations ?? [];
        target.markReturnedHistory();
        for (const reference of closure) {
            const ref = source.refs.get(reference.observationId);
            if (!ref || JSON.stringify(source.published.get(ref.id)) !== JSON.stringify(reference)
                || JSON.stringify(parent.service.getReferenceMetadata(parent.caller, ref.id)) !== JSON.stringify(reference))
                throw new Error('SOL_PI_OBSERVATION_AUTHORIZATION_RETURN_CHANGED');
            const previous = target.refs.get(ref.id);
            if (previous && JSON.stringify(previous) !== JSON.stringify(ref))
                throw new Error('SOL_PI_OBSERVATION_AUTHORIZATION_RETURN_CHANGED');
            target.refs.set(ref.id, structuredClone(ref));
            if (reference.sourceSessionId !== parent.session.exportSnapshot().sessionId)
                target.foreignReferences.add(ref.id);
            await parentOwner.read(ref.id, 0, 4);
        }
        parentOwner.assertSession(parent.session);
        childOwner.assertSession(child.session);
    });
}
/** A host-authorized fork may preserve an exact native result's segmentation;
 * generated summaries and changed/unknown text never gain native provenance. */
export function inheritDelegatedObservationProjections(parentOwner, childOwner, snapshot) {
    const parent = getObservationSessionOwnerHostBinding(parentOwner), child = getObservationSessionOwnerHostBinding(childOwner);
    const source = projectionBindings.get(parentOwner), target = projectionBindings.get(childOwner);
    if (!source || !target || parent.service !== child.service || snapshot.sessionId !== parent.session.exportSnapshot().sessionId
        || !child.service.getDelegatedReferences(child.caller, child.session.exportSnapshot().sessionId, child.destination))
        throw new Error('SOL_PI_DELEGATION_PROVENANCE_REJECTED');
    for (const message of snapshot.messages)
        for (const block of message.content) {
            if (block.type !== 'tool_result' || typeof block.content !== 'string')
                continue;
            const proof = readFinalizedObservationProvenance(parentOwner.getFinalizedToolResult(block.tool_use_id));
            const entry = source.invocations.get(block.tool_use_id);
            if (!proof || !entry?.ref || proof.wholeContent !== block.content)
                continue;
            const ref = target.refs.get(entry.ref.id);
            if (!ref || ref.revision !== entry.ref.revision || ref.contentHash !== entry.ref.contentHash || !target.published.has(ref.id)
                || target.invocations.has(block.tool_use_id))
                throw new Error('SOL_PI_DELEGATION_PROVENANCE_REJECTED');
            const port = createNativeObservationProvenance({ hostInvocationId: block.tool_use_id, ownerGeneration: target.restoreGeneration, nativePreview: proof.segments.native });
            port.appendSuffix(proof.segments.after);
            port.sealRegistry(proof.segments.native + proof.segments.after);
            if (proof.segments.before)
                wrapNativeObservationHistory(port, proof.segments.before, proof.segments.native + proof.segments.after, '');
            const receipt = port.finalizeHistory(proof.wholeContent);
            if (!receipt)
                throw new Error('SOL_PI_DELEGATION_PROVENANCE_REJECTED');
            target.allocatedInvocations.add(block.tool_use_id);
            target.invocations.set(block.tool_use_id, { ref, ...(entry.facts ? { facts: structuredClone(entry.facts) } : {}) });
            target.provenance.set(block.tool_use_id, port);
            target.finalizedProvenance.set(block.tool_use_id, receipt);
        }
}
const counterServices = new WeakMap();
const recallDefinitions = new WeakMap();
/** Experimental ordinary CLI owner. Caller policy and durable barrier are host
 * capabilities; creating an owner never grants archive/disclosure permission. */
export function createObservationSessionOwner(options) {
    const { service, caller, session } = options;
    const counter = options.fullSendCounter;
    function validateCounterStorage() {
        if (!counter)
            return;
        const budget = service.getStorageBudget(), reservation = counter.getStorageReservation();
        const root = realpathSync(budget.profileRoot), counterRoot = realpathSync(reservation.root);
        const child = relative(root, counterRoot);
        if (reservation.sessionId !== session.exportSnapshot().sessionId || root !== budget.profileRoot || counterRoot !== reservation.root || !child || isAbsolute(child)
            || child === '..' || child.startsWith(`..${sep}`) || child.split(sep)[0].toLowerCase() === 'observations'
            || reservation.maximumBytes < 4 * 1024 * 1024 || budget.reservedBytes < reservation.maximumBytes)
            throw new Error('SOL_PI_COUNTER_RESERVATION_UNAVAILABLE');
    }
    validateCounterStorage();
    let counterUnavailable = false;
    const diagnostics = { preparedRequests: 0, projectedRequests: 0, skippedRequests: 0,
        fullObservationViews: 0, referenceObservationViews: 0, unknownFullObservationViews: 0, authorizedPages: 0, reasons: {} };
    if (session.getProtectedObservationClosure())
        throw new Error('SOL_PI_OBSERVATION_REAUTHORIZATION_REQUIRED');
    const restoreGeneration = session.getObservationRestoreGeneration();
    const sessionId = session.exportSnapshot().sessionId;
    service.bindConsumerIncarnation(caller, session);
    if (counter) {
        const account = getProfileDisclosureAccountBinding(counter, service, sessionId);
        const sourceCounter = account?.sourceCounter ?? counter;
        const existing = counterServices.get(service);
        if (existing && (!account || existing !== sourceCounter))
            throw new Error('SOL_PI_COUNTER_RESERVATION_ALREADY_BOUND');
        counterServices.set(service, sourceCounter);
    }
    const destination = Object.freeze({ ...options.destination });
    const contexts = new WeakMap();
    const invocations = new Map();
    const allocatedInvocations = new Set();
    const provenance = new Map();
    const finalizedProvenance = new Map();
    const projectedInvocations = new Set();
    const delegatedReferences = service.getDelegatedReferences(caller, sessionId, destination);
    const foreignReferences = new Set((delegatedReferences ?? []).map(ref => ref.id));
    let pendingReturnedHistory = 0;
    const refs = new Map((delegatedReferences ?? []).map(ref => [ref.id, ref]));
    const published = new Map();
    const dependencies = new Map();
    let dependencyGeneration = 0;
    let transportPaused = false, transportDrained = false;
    let providerAncestor;
    let providerPreparationStarted = false;
    const executionDependency = Object.freeze({ authority: service.transportPort.authority, key: `consumer-execution:${randomUUID()}`, epoch: 0 });
    const transportDependencies = () => [...dependencies.values()].flat().concat(providerAncestor ? [executionDependency] : []);
    const ancestorBinding = () => providerAncestor ? { capability: providerAncestor, destination,
        closureDigest: createHash('sha256').update(JSON.stringify(session.getProtectedObservationClosure() ?? { version: 1, requiresReauthorization: true, observations: [] })).digest('hex') } : undefined;
    function validateTransport(snapshot, url) {
        assertSession(session);
        if (pendingReturnedHistory || transportPaused)
            throw new Error('SOL_PI_OBSERVATION_AUTHORIZATION_PUBLICATION_PENDING');
        const current = transportDependencies();
        if (url !== destination.url || published.size !== dependencies.size || snapshot.length !== current.length
            || current.some(expected => !snapshot.some(actual => actual.authority === expected.authority && actual.key === expected.key && actual.epoch === expected.epoch)))
            throw new Error('SOL_PI_OBSERVATION_AUTHORIZATION_CLOSURE_CHANGED');
        if (providerAncestor)
            service.assertConsumerExecution(caller, sessionId, destination);
        const archiveDependencies = [...dependencies.values()].flat();
        if (archiveDependencies.length)
            service.transportPort.validate(archiveDependencies, url);
        else if (!providerAncestor)
            throw new Error('SOL_PI_OBSERVATION_AUTHORIZATION_EMPTY');
    }
    const newIssuer = () => createTransportLeaseIssuer({
        authority: service.transportPort.authority,
        withAdmission: operation => service.transportPort.withAdmission(operation),
        onRevoke: listener => service.transportPort.onRevoke(listener),
        validate: validateTransport,
    });
    let issuer = newIssuer();
    let recallOnly = false;
    let disposed = false;
    const disposeListeners = new Set();
    let disclosureFailed = false;
    let publicationBarrier;
    async function publishHostMetadata() {
        if (!publicationBarrier)
            return;
        const closure = structuredClone(session.getProtectedObservationClosure());
        if (closure) {
            for (const reference of closure.observations)
                Object.freeze(reference);
            Object.freeze(closure.observations);
            Object.freeze(closure);
        }
        await publicationBarrier(Object.freeze({ sessionId, closure }));
        assertSession(session);
    }
    // Serializes publication barriers; neither side can commit an older closure.
    let publication = Promise.resolve();
    function assertSession(actual) {
        if (disposed || disclosureFailed)
            throw new Error('SOL_PI_OBSERVATION_AUTHORIZATION_UNAVAILABLE');
        if (actual !== session || session.getObservationRestoreGeneration() !== restoreGeneration
            || session.exportSnapshot().sessionId !== sessionId)
            throw new Error('SOL_PI_OBSERVATION_RESTORE_NOT_READY');
        for (const reference of session.getProtectedObservationClosure()?.observations ?? []) {
            const known = published.get(reference.observationId);
            if (!known || JSON.stringify(known) !== JSON.stringify(reference))
                throw new Error('SOL_PI_OBSERVATION_REAUTHORIZATION_REQUIRED');
        }
    }
    function unavailable(ref, facts) {
        const outcome = facts?.outcome ?? ref?.outcome;
        const error = outcome === 'error' || outcome === 'timeout' || outcome === 'cancelled';
        return `${error ? 'Error: ' : ''}[observation unavailable; execution=${facts?.executionState ?? ref?.executionState ?? 'unknown'}; outcome=${outcome ?? 'unknown'}; complete=false]`;
    }
    function status(ref) {
        return `${ref.outcome === 'error' || ref.outcome === 'timeout' || ref.outcome === 'cancelled' ? 'Error: ' : ''}[observation ${ref.id}; execution=${ref.executionState}; outcome=${ref.outcome ?? 'unknown'}; complete=${ref.complete}; bytes=${ref.byteLength}${ref.incompleteReason ? `; reason=${ref.incompleteReason}` : ''}]`;
    }
    session.getPublishedHistoryBasis();
    async function disclose(ref, offset, maxBytes, persist = options.persist) {
        assertSession(session);
        assertCapacityProfileReady(options.capacityProfile, destination.url, destination.model);
        // Authorize before writing metadata, then recheck after the awaited barrier.
        service.read({ caller, id: ref.id, offset, maxBytes, destination });
        const metadata = service.getReferenceMetadata(caller, ref.id);
        if (metadata.sourceSessionId !== sessionId && !foreignReferences.has(ref.id))
            throw new Error('SOL_PI_OBSERVATION_SESSION_MISMATCH');
        const previous = published.get(ref.id);
        if (previous && JSON.stringify(previous) !== JSON.stringify(metadata))
            throw new Error('SOL_PI_OBSERVATION_REVISION_CHANGED');
        if (!previous) {
            try {
                service.pin({ requestSource: 'agent', caller, id: ref.id, referenceId: `session:${sessionId}` });
                // Any failure in this whole publication transaction permanently blocks
                // the owner. A partial private marker can never skip a failed barrier.
                published.set(ref.id, metadata);
                session.addProtectedObservationReferences([metadata]);
                const basis = session.getPublishedHistoryBasis(), snapshot = { ...session.exportSnapshot(), historyDigest: basis };
                await persist(snapshot);
                session.notePublishedHistory(snapshot, basis);
                await publishHostMetadata();
            }
            catch {
                disclosureFailed = true;
                issuer.dispose();
                throw new Error('SOL_PI_OBSERVATION_DURABILITY_UNAVAILABLE');
            }
        }
        assertSession(session);
        const page = service.read({ caller, id: ref.id, offset, maxBytes, destination });
        if (!dependencies.has(ref.id)) {
            dependencies.set(ref.id, page.dependencies);
            dependencyGeneration++;
        }
        // A prior page may have been revoked while a new page was being prepared.
        service.transportPort.validate([...dependencies.values()].flat(), destination.url);
        return `${status(ref)}\n${page.content}\n[observation_read id=${ref.id} nextOffset=${page.nextOffset} eof=${page.eof}]`;
    }
    function enqueue(ref, offset, maxBytes, persist = options.persist) {
        return runCompoundObservationPublication(owner, async () => {
            const work = publication.then(() => disclose(ref, offset, maxBytes, persist));
            publication = work.catch(() => { });
            return work;
        });
    }
    async function projectToolResult(invocationId, legacyResult, persist = options.persist) {
        if (recallOnly)
            return legacyResult;
        const entry = invocations.get(invocationId);
        if (!entry)
            return legacyResult;
        if (!entry.ref?.contentHash)
            return unavailable(entry.ref, entry.facts);
        try {
            assertCapacityProfileReady(options.capacityProfile, destination.url, destination.model);
        }
        catch {
            return `${unavailable(entry.ref, entry.facts)} [capacity_not_ready]`;
        }
        try {
            const preview = await enqueue(entry.ref, 0, 4096, persist);
            if (projectedInvocations.has(invocationId))
                provenance.get(invocationId)?.invalidate();
            else {
                projectedInvocations.add(invocationId);
                provenance.set(invocationId, createNativeObservationProvenance({ hostInvocationId: invocationId,
                    ownerGeneration: restoreGeneration, nativePreview: preview }));
            }
            return preview;
        }
        catch {
            return unavailable(entry.ref, entry.facts);
        }
    }
    function prepareDisclosure(invocationId = randomUUID()) {
        providerPreparationStarted = true;
        assertSession(session);
        if (transportPaused || pendingReturnedHistory)
            throw new Error('SOL_PI_OBSERVATION_AUTHORIZATION_PUBLICATION_PENDING');
        if (published.size !== dependencies.size)
            throw new Error('SOL_PI_OBSERVATION_AUTHORIZATION_PUBLICATION_PENDING');
        if (!dependencies.size && !providerAncestor)
            return undefined;
        assertCapacityProfileReady(options.capacityProfile, destination.url, destination.model);
        const snapshot = transportDependencies();
        validateTransport(snapshot, destination.url);
        const context = createProviderDisclosureContext({ issuer, ancestorAdmission: ancestorBinding(), invocationId,
            capacityProfile: options.capacityProfile,
            destination: destination.url, model: destination.model, dependencies: snapshot });
        contexts.set(context, dependencyGeneration);
        return context;
    }
    const closedReadAnchor = Object.freeze({});
    const closedReadEntry = { service, caller, destination: structuredClone(destination) };
    closedReadAnchors.set(closedReadAnchor, closedReadEntry);
    const owner = {
        stopNewCapture() { assertSession(session); recallOnly = true; },
        getMode() { assertSession(session); return recallOnly ? 'recall-only' : 'active'; },
        assertSession,
        collectorFor(invocationId) {
            assertSession(session);
            if (!invocationId || allocatedInvocations.has(invocationId))
                throw new Error('SOL_PI_DUPLICATE_OBSERVATION_INVOCATION');
            allocatedInvocations.add(invocationId);
            return { begin(source) {
                    assertSession(session);
                    if (recallOnly)
                        return { append() { }, finalize() { } };
                    if (!invocationId || invocations.has(invocationId))
                        throw new Error('SOL_PI_DUPLICATE_OBSERVATION_INVOCATION');
                    const entry = {};
                    invocations.set(invocationId, entry);
                    let capture;
                    try {
                        capture = service.begin({ requestSource: 'agent', caller, invocationId,
                            toolName: source.toolName, sourceAdapterId: `native.${source.toolName}.v1`, sourceDescriptor: describeObservationSource(source) });
                    }
                    catch { /* Native completion facts remain available without an archive. */ }
                    let finalized = false;
                    return {
                        append(text) { if (capture)
                            service.append({ requestSource: 'agent', caller, capture, text }); },
                        finalize(facts) {
                            if (finalized)
                                return;
                            finalized = true;
                            if (!['terminal', 'termination_pending'].includes(facts.executionState)
                                || (facts.outcome !== undefined && (facts.executionState !== 'terminal'
                                    || !['success', 'error', 'timeout', 'cancelled'].includes(facts.outcome))))
                                return;
                            entry.facts = { executionState: facts.executionState, outcome: facts.outcome };
                            if (!capture)
                                return;
                            const ref = service.finalize({ requestSource: 'agent', caller, capture, ...facts });
                            entry.ref = ref;
                            refs.set(ref.id, ref);
                            if (counter && ref.contentHash) {
                                try {
                                    counter.registerNewObservation(ref.id);
                                }
                                catch {
                                    counterUnavailable = true;
                                }
                            }
                        },
                    };
                } };
        },
        projectToolResult,
        getResultProvenance(invocationId) {
            try {
                assertSession(session);
                return provenance.get(invocationId);
            }
            catch {
                provenance.get(invocationId)?.invalidate();
                return undefined;
            }
        },
        finalizeToolResult(invocationId, finalContent) {
            try {
                assertSession(session);
                const receipt = provenance.get(invocationId)?.finalizeHistory(finalContent);
                if (receipt)
                    finalizedProvenance.set(invocationId, receipt);
                return receipt;
            }
            catch {
                provenance.get(invocationId)?.invalidate();
                return undefined;
            }
        },
        getFinalizedToolResult(invocationId) {
            try {
                assertSession(session);
                const receipt = finalizedProvenance.get(invocationId);
                return readFinalizedObservationProvenance(receipt) ? receipt : undefined;
            }
            catch {
                provenance.get(invocationId)?.invalidate();
                return undefined;
            }
        },
        getProjectionDiagnostics() { return Object.freeze({ ...diagnostics, reasons: Object.freeze({ ...diagnostics.reasons }) }); },
        prepareSemanticAnchors(source) {
            assertSession(session);
            if (dependencies.size)
                service.transportPort.validate([...dependencies.values()].flat(), destination.url);
            const messages = structuredClone(source);
            if (recallOnly || !counter || counterUnavailable)
                return messages;
            const seen = new Set();
            for (const message of messages)
                for (const block of message.content) {
                    if (block.type !== 'tool_result')
                        continue;
                    if (seen.has(block.tool_use_id))
                        throw new Error('SOL_PI_SEMANTIC_DUPLICATE_RESULT');
                    seen.add(block.tool_use_id);
                    const proof = readFinalizedObservationProvenance(owner.getFinalizedToolResult(block.tool_use_id));
                    const ref = invocations.get(block.tool_use_id)?.ref;
                    if (!proof || !ref?.contentHash || proof.wholeContent !== block.content)
                        continue;
                    if (proof.ownerGeneration !== restoreGeneration || proof.hostInvocationId !== block.tool_use_id)
                        throw new Error('SOL_PI_PROJECTION_PROVENANCE_CHANGED');
                    const count = counter.read(ref.id);
                    if (count === null || count < 2)
                        continue;
                    const metadata = service.getReferenceMetadata(caller, ref.id);
                    if (JSON.stringify(metadata) !== JSON.stringify(published.get(ref.id)))
                        throw new Error('SOL_PI_PROJECTION_UNPUBLISHED_SOURCE');
                    service.read({ caller, id: ref.id, offset: 0, maxBytes: 64, destination });
                    block.content = `${proof.segments.before}${status(ref)}\n[observation_read id=${ref.id}]${proof.segments.after}`;
                }
            if (dependencies.size)
                service.transportPort.validate([...dependencies.values()].flat(), destination.url);
            return messages;
        },
        async prepareRequest(input) {
            providerPreparationStarted = true;
            if (transportPaused || pendingReturnedHistory)
                throw new Error('SOL_PI_OBSERVATION_AUTHORIZATION_PUBLICATION_PENDING');
            assertSession(session);
            diagnostics.preparedRequests++;
            const messages = structuredClone(input.messages);
            const skipped = (reason) => {
                diagnostics.skippedRequests++;
                diagnostics.reasons[reason] = (diagnostics.reasons[reason] ?? 0) + 1;
                return { messages, projectionStatus: 'skipped', providerDisclosure: prepareDisclosure(input.logicalInvocationId) };
            };
            if (recallOnly)
                return skipped('recall_only');
            if (!counter || counterUnavailable)
                return skipped('counter_unavailable');
            if (!input.tools.some(definition => { const binding = recallDefinitions.get(definition); return binding?.owner === owner && binding.serialized === JSON.stringify(definition); }))
                return skipped('recall_unavailable');
            validateCounterStorage();
            if (!options.capacityProfile)
                return skipped('capacity_profile_unavailable');
            if (!input.requestPreview)
                return skipped('request_preview_unavailable');
            const preview = input.requestPreview;
            const initial = preview(messages, input.tools, input.systemPrompt, input.options);
            if (!initial)
                return skipped('request_preview_unavailable');
            assertCapacityProfileReady(options.capacityProfile, initial.destination, destination.model);
            if (initial.destination !== destination.url)
                throw new Error('SOL_PI_PROJECTION_DESTINATION_CHANGED');
            const profile = options.capacityProfile;
            const budget = getCapacityProfileBudget(profile);
            const parsed = JSON.parse(initial.serializedBody);
            if (parsed.model !== destination.model)
                throw new Error('SOL_PI_PROJECTION_MODEL_CHANGED');
            const explicitOutput = Object.hasOwn(parsed, budget.outputLimitField);
            const outputReserve = explicitOutput ? parsed[budget.outputLimitField] : budget.defaultOutputTokens;
            if (!Number.isSafeInteger(outputReserve) || outputReserve <= 0)
                return skipped('output_reserve_unavailable');
            const observations = [], textById = new Map();
            const resultIds = new Set();
            for (const message of messages)
                for (const block of message.content) {
                    if (block.type !== 'tool_result')
                        continue;
                    if (resultIds.has(block.tool_use_id))
                        return skipped('duplicate_tool_result');
                    resultIds.add(block.tool_use_id);
                    const proof = readFinalizedObservationProvenance(owner.getFinalizedToolResult(block.tool_use_id));
                    const ref = invocations.get(block.tool_use_id)?.ref;
                    if (!proof || !ref?.contentHash || typeof block.content !== 'string' || proof.wholeContent !== block.content)
                        continue;
                    if (proof.ownerGeneration !== restoreGeneration || proof.hostInvocationId !== block.tool_use_id)
                        throw new Error('SOL_PI_PROJECTION_PROVENANCE_CHANGED');
                    const metadata = service.getReferenceMetadata(caller, ref.id);
                    if (JSON.stringify(metadata) !== JSON.stringify(published.get(ref.id)))
                        throw new Error('SOL_PI_PROJECTION_UNPUBLISHED_SOURCE');
                    let text = textById.get(ref.id);
                    if (text === undefined) {
                        let offset = 0;
                        const pages = [];
                        let eof = false;
                        do {
                            const page = service.read({ caller, id: ref.id, offset, maxBytes: 65536, destination });
                            diagnostics.authorizedPages++;
                            if (page.contentHash !== ref.contentHash || page.nextOffset < offset || page.nextOffset > ref.byteLength
                                || (!page.eof && page.nextOffset === offset) || Buffer.byteLength(page.content) !== page.nextOffset - offset)
                                throw new Error('SOL_PI_PROJECTION_INVALID_ARCHIVE_PAGE');
                            pages.push(page.content);
                            offset = page.nextOffset;
                            eof = page.eof;
                        } while (!eof);
                        text = pages.join('');
                        if (offset !== ref.byteLength || Buffer.byteLength(text) !== ref.byteLength)
                            throw new Error('SOL_PI_PROJECTION_INCOMPLETE_ARCHIVE');
                        service.transportPort.validate([...dependencies.values()].flat(), destination.url);
                        textById.set(ref.id, text);
                    }
                    observations.push({ kind: 'native', observationId: ref.id, toolUseId: block.tool_use_id, segments: proof.segments,
                        authorizedText: text, mandatoryStatus: status(ref), reference: `[observation_read id=${ref.id}]`, fullLogicalSendCount: counter.read(ref.id) });
                }
            if (!observations.length)
                return skipped('no_eligible_native_observation');
            const request = { modelId: destination.model, protocolId: 'openai_legacy',
                messages: messages, tools: input.tools, systemPrompt: input.systemPrompt,
                ...(explicitOutput ? { [budget.outputLimitField]: outputReserve } : {}) };
            const count = (candidate) => {
                const built = preview(candidate.messages, candidate.tools, candidate.systemPrompt, input.options);
                if (!built || built.destination !== destination.url)
                    throw new Error('SOL_PI_PROJECTION_BUILDER_CHANGED');
                const measured = measureRequestCapacity(profile, { destination: built.destination, model: destination.model, serializedBody: built.serializedBody });
                if (measured.actualOutputReserve !== outputReserve)
                    throw new Error('SOL_PI_PROJECTION_OUTPUT_RESERVE_CHANGED');
                return measured.inputTokenUpperBound;
            };
            const planned = planObservationRequest({ request, observations, windowTokens: budget.windowTokens,
                outputReserveTokens: outputReserve, safetyMarginTokens: budget.safetyMarginTokens,
                outputLimitField: explicitOutput ? budget.outputLimitField : null,
                ...(!explicitOutput ? { verifiedDefaultOutputReserveTokens: outputReserve } : {}), previewBytes: 4096,
                tokenBound: { modelId: destination.model, protocolId: 'openai_legacy', validationEvidenceId: 'host-capacity-profile', countRequestTokens: count } });
            if (planned.status === 'context_budget_exceeded')
                throw new Error('SOL_PI_CONTEXT_BUDGET_EXCEEDED');
            if (planned.status === 'skipped')
                return skipped(planned.reason);
            const projected = planned.request.messages;
            const final = preview(projected, input.tools, input.systemPrompt, input.options);
            if (!final || final.destination !== destination.url)
                throw new Error('SOL_PI_PROJECTION_BUILDER_CHANGED');
            const measured = measureRequestCapacity(profile, { destination: final.destination, model: destination.model, serializedBody: final.serializedBody });
            if (measured.inputTokenUpperBound !== planned.inputTokenUpperBound || measured.totalTokenUpperBound !== planned.totalTokenUpperBound
                || measured.totalTokenUpperBound > budget.windowTokens)
                throw new Error('SOL_PI_PROJECTION_BUDGET_CHANGED');
            assertSession(session);
            const snapshot = transportDependencies();
            validateTransport(snapshot, destination.url);
            if (published.size !== dependencies.size)
                throw new Error('SOL_PI_OBSERVATION_AUTHORIZATION_PUBLICATION_PENDING');
            const context = createProviderDisclosureContext({ issuer, ancestorAdmission: ancestorBinding(), invocationId: input.logicalInvocationId,
                capacityProfile: profile, expectedSerializedBody: final.serializedBody, destination: destination.url, model: destination.model, dependencies: snapshot,
                ...(planned.fullObservationIds.length ? { fullSend: { counter, observationIds: planned.fullObservationIds } } : {}) });
            contexts.set(context, dependencyGeneration);
            diagnostics.projectedRequests++;
            diagnostics.fullObservationViews += planned.fullObservationIds.length;
            diagnostics.referenceObservationViews += new Set(observations.map(o => o.observationId)).size - planned.fullObservationIds.length;
            diagnostics.unknownFullObservationViews += planned.fullObservationIds.filter(id => observations.some(o => o.observationId === id && o.fullLogicalSendCount === null)).length;
            return { messages: projected, providerDisclosure: context, projectionStatus: 'projected' };
        },
        async read(id, offset, maxBytes) {
            const ref = refs.get(id);
            if (!ref?.contentHash)
                throw new Error('SOL_PI_OBSERVATION_UNAVAILABLE');
            return enqueue(ref, offset, maxBytes);
        },
        async publishCurrentHistory(input) {
            if (!pendingReturnedHistory)
                return;
            return runCompoundObservationPublication(owner, async () => {
                assertSession(session);
                // Strict private-protocol history requires its separate typed continuation
                // custody path. It must never fall through to a raw transcript save.
                if (input.strictPrivateProtocol)
                    throw new Error('SOL_PI_OBSERVATION_AUTHORIZATION_STRICT_CONTINUATION_REQUIRED');
                const generation = pendingReturnedHistory;
                await publication;
                const basis = session.getPublishedHistoryBasis(), snapshot = { ...session.exportSnapshot(), historyDigest: basis };
                try {
                    await options.persist(snapshot);
                    session.notePublishedHistory(snapshot, basis);
                    await publishHostMetadata();
                    assertSession(session);
                    if (pendingReturnedHistory !== generation || computeSessionHistoryDigest(snapshot) !== computeSessionHistoryDigest(session.exportSnapshot()))
                        throw new Error('SOL_PI_OBSERVATION_AUTHORIZATION_HISTORY_CHANGED');
                    if (dependencies.size)
                        service.transportPort.validate([...dependencies.values()].flat(), destination.url);
                    pendingReturnedHistory = 0;
                }
                catch (error) {
                    disclosureFailed = true;
                    issuer.dispose();
                    throw error;
                }
            });
        },
        hasDependencies() { return Boolean(providerAncestor) || dependencies.size > 0 || published.size > 0; },
        ownsDisclosure(context) { return contexts.get(context) === dependencyGeneration; },
        prepareProviderDisclosure: () => prepareDisclosure(),
        dispose() {
            if (disposed)
                return;
            try {
                assertSession(session);
                service.assertConsumerExecution(caller, sessionId, destination);
                closedReadEntry.references = Object.freeze((session.getProtectedObservationClosure()?.observations ?? []).map(ref => Object.freeze(structuredClone(ref))));
            }
            catch {
                closedReadEntry.references = undefined;
            }
            disposed = true;
            service.endConsumerExecution(caller);
            for (const listener of [...disposeListeners]) {
                try {
                    listener();
                }
                catch { /* Continue revoking every descendant. */ }
            }
            disposeListeners.clear();
            for (const port of provenance.values())
                port.invalidate();
            finalizedProvenance.clear();
            issuer.dispose();
        },
    };
    providerAdmissionBinders.set(owner, capability => {
        assertSession(session);
        if (providerAncestor || providerPreparationStarted || providerAdmissionOwners.has(capability) || getProviderAncestorAdmissionBinding(capability).childSessionIdentity !== sessionId)
            throw new Error('SOL_PI_OBSERVATION_AUTHORIZATION_PROVIDER_ADMISSION_MISMATCH');
        service.assertConsumerExecution(caller, sessionId, destination);
        providerAdmissionOwners.set(capability, new WeakRef(owner));
        providerAncestor = capability;
        dependencyGeneration++;
    });
    publicationBarrierBinders.set(owner, barrier => {
        assertSession(session);
        if (publicationBarrier || published.size || pendingReturnedHistory)
            throw new Error('SOL_PI_OBSERVATION_PUBLICATION_BARRIER_ALREADY_FIXED');
        publicationBarrier = barrier;
    });
    compoundPublishers.set(owner, projectToolResult);
    closedReadOwners.set(owner, closedReadAnchor);
    ownerBindings.set(owner, Object.freeze({ service, caller, session, destination, counter,
        async pauseTransport() {
            assertSession(session);
            if (transportPaused)
                throw new Error('SOL_PI_OBSERVATION_AUTHORIZATION_PAUSED');
            transportPaused = true;
            transportDrained = false;
            dependencyGeneration++;
            await issuer.disposeAndDrain();
            transportDrained = true;
        },
        assertTransportPaused() { assertSession(session); if (!transportPaused || !transportDrained)
            throw new Error('SOL_PI_OBSERVATION_AUTHORIZATION_NOT_DRAINED'); },
        drainTransport() { return issuer.disposeAndDrain(); },
        async waitForCurrentTransport() {
            assertSession(session);
            const originalIssuer = issuer;
            await originalIssuer.waitForDrain();
            assertSession(session);
            if (issuer !== originalIssuer)
                throw new Error('SOL_PI_OBSERVATION_TRANSPORT_ROTATED');
        },
        resumeTransport() {
            assertSession(session);
            if (!transportPaused || !transportDrained)
                throw new Error('SOL_PI_OBSERVATION_AUTHORIZATION_NOT_DRAINED');
            const snapshot = [...dependencies.values()].flat();
            if (snapshot.length)
                service.transportPort.validate(snapshot, destination.url);
            issuer = newIssuer();
            transportPaused = false;
            transportDrained = false;
        },
        onDispose(listener) {
            if (disposed) {
                listener();
                return () => { };
            }
            disposeListeners.add(listener);
            return () => { disposeListeners.delete(listener); };
        },
    }));
    projectionBindings.set(owner, { restoreGeneration, invocations, allocatedInvocations, refs, published, provenance, finalizedProvenance, foreignReferences, markReturnedHistory: () => { pendingReturnedHistory++; } });
    return Object.freeze(owner);
}
/** Register only in this owner's private registry. No caller/model destination fields. */
export function createObservationReadTool(owner) {
    const tool = {
        permission: 'safe',
        definition: {
            name: 'observation_read',
            description: '只读取当前会话已授权的 observation 页面。只能使用已返回的 id；严禁用路径、其他会话标识或目的地覆盖授权。offset 为 UTF-8 字节偏移。',
            inputSchema: { type: 'object', properties: { id: { type: 'string' }, offset: { type: 'integer', minimum: 0 },
                    maxBytes: { type: 'integer', minimum: 4, maximum: 65536 } }, required: ['id', 'offset', 'maxBytes'], additionalProperties: false },
        },
        execute: input => owner.read(input.id, input.offset, input.maxBytes),
    };
    recallDefinitions.set(tool.definition, { owner, serialized: JSON.stringify(tool.definition) });
    return Object.freeze(tool);
}
