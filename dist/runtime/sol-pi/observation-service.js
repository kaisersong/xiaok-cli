import { AgentSessionState } from '../../ai/runtime/session.js';
import { writeFileAtomicallySync } from '../../utils/atomic-file.js';
import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync } from 'node:fs';
import { join, isAbsolute, normalize } from 'node:path';
const MAX_RECORD = 16 * 1024 * 1024;
const MAX_COLLECTORS = 64 * 1024 * 1024;
const MAX_SESSION = 256 * 1024 * 1024;
const MAX_PROFILE = 2 * 1024 * 1024 * 1024;
const META_LIMIT = 16 * 1024;
const owners = new Set();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export class ObservationQuotaError extends Error {
    code;
    recovery = 'fresh-task';
    retryable = false;
    constructor(code) {
        super(code);
        this.code = code;
        this.name = 'ObservationQuotaError';
    }
}
function deny(reason = 'authorization_denied') {
    if (reason === 'dependency_budget_exceeded' || reason === 'quota_exceeded')
        throw new ObservationQuotaError(`observation_${reason}`);
    throw new Error(`observation_${reason}`);
}
function bounded(value, max = 512) { if (typeof value !== 'string' || !value || value.length > max)
    deny('invalid_metadata'); }
function sourceHash(value) { bounded(value, 65536); return hash(value); }
function same(a, b) { return a.sessionId === b.sessionId && a.ownerAgentId === b.ownerAgentId && a.scopeId === b.scopeId && a.permissionGeneration === b.permissionGeneration && a.surface === b.surface; }
function normalizedFilePath(value) {
    bounded(value, 4096);
    if (!isAbsolute(value) || normalize(value) !== value || /[\x00*?\[\]{}]/.test(value))
        deny('invalid_read_scope');
    return process.platform === 'win32' ? value.toLowerCase() : value;
}
function validLine(value) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1; }
function parseReadRange(toolName, adapter, descriptor) {
    if (toolName !== 'read' || adapter !== 'native.read.v1')
        return undefined;
    try {
        const source = JSON.parse(descriptor);
        if (source?.toolName !== 'read' || !validLine(source.offset) || source.limit !== undefined && !validLine(source.limit))
            return undefined;
        const canonical = JSON.stringify({ toolName: 'read', filePath: source.filePath, offset: source.offset, ...(source.limit === undefined ? {} : { limit: source.limit }) });
        if (canonical !== descriptor || source.limit !== undefined && !Number.isSafeInteger(source.offset + source.limit - 1))
            return undefined;
        return { pathHash: hash(normalizedFilePath(source.filePath)), offset: source.offset, ...(source.limit === undefined ? {} : { limit: source.limit }) };
    }
    catch {
        return undefined;
    }
}
function policyMatchesSource(policy, digest, range) {
    if (policy.sourceDescriptors.includes(digest))
        return true;
    return policy.sourceAdapterId === 'native.read.v1' && range !== undefined && (policy.readFileScopes ?? []).some(scope => scope.filePath === range.pathHash && range.offset >= scope.startLine && (scope.endLine === undefined
        || range.limit !== undefined && range.offset + range.limit - 1 <= scope.endLine));
}
function validateRecoveredEntry(value) {
    const invalid = () => deny('invalid_index');
    const object = (item) => Boolean(item && typeof item === 'object' && !Array.isArray(item));
    const text = (item, max = 512) => typeof item === 'string' && item.length > 0 && item.length <= max;
    const integer = (item, minimum = 0) => typeof item === 'number' && Number.isSafeInteger(item) && item >= minimum;
    if (!object(value))
        invalid();
    const entry = value;
    if (entry.referenceReconciliation !== undefined) {
        const audit = entry.referenceReconciliation;
        if (!object(audit) || Object.keys(audit).sort().join(',') !== 'actorKind,deletionReceiptId,reconciledAt,recoveryEpoch,referenceId' || audit.actorKind !== 'system_reconcile' || !text(audit.deletionReceiptId) || !text(audit.referenceId) || !integer(audit.reconciledAt) || !integer(audit.recoveryEpoch, 1))
            invalid();
    }
    if (Object.keys(entry).some(key => !['ref', 'claims', 'sourceHash', 'sourceAdapterId', 'readRange', 'policyId', 'policyRevision', 'pins', 'tombstone', 'endedAt', 'recoveryUncertain', 'referenceReconciliation'].includes(key))
        || entry.recoveryUncertain !== undefined && entry.recoveryUncertain !== true)
        invalid();
    if (!object(entry.ref) || !object(entry.claims) || !Array.isArray(entry.pins) || entry.pins.some(pin => !text(pin)) || typeof entry.tombstone !== 'boolean'
        || !text(entry.sourceAdapterId) || typeof entry.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sourceHash)
        || entry.endedAt !== undefined && !integer(entry.endedAt))
        invalid();
    if (entry.readRange !== undefined) {
        const range = entry.readRange;
        if (!object(range) || Object.keys(range).some(key => !['pathHash', 'offset', 'limit'].includes(key))
            || typeof range.pathHash !== 'string' || !/^[a-f0-9]{64}$/.test(range.pathHash) || !validLine(range.offset)
            || range.limit !== undefined && (!validLine(range.limit) || !Number.isSafeInteger(Number(range.offset) + Number(range.limit) - 1))
            || entry.sourceAdapterId !== 'native.read.v1' || entry.ref.toolName !== 'read')
            invalid();
    }
    const ref = entry.ref;
    const claims = entry.claims;
    if (Object.keys(claims).length !== 6 || !['sessionId', 'ownerAgentId', 'scopeId'].every(key => text(claims[key]))
        || !integer(claims.permissionGeneration) || !['user', 'agent', 'scheduler'].includes(String(claims.requestSource))
        || !['ordinary-owner', 'room', 'restricted', 'multi-authority'].includes(String(claims.surface)))
        invalid();
    if (Object.keys(ref).some(key => !['version', 'id', 'sessionId', 'invocationId', 'toolName', 'contentHash', 'byteLength', 'complete', 'incompleteReason', 'executionState', 'outcome', 'redactionVersion', 'createdAt', 'revision', 'terminalFactsId', 'terminalFactsHash'].includes(key)))
        invalid();
    if (ref.version !== 1 || !text(ref.id) || !/^[a-f0-9-]{36}$/.test(String(ref.id)) || ref.sessionId !== claims.sessionId
        || !['sessionId', 'invocationId', 'toolName', 'redactionVersion'].every(key => text(ref[key]))
        || !integer(ref.byteLength) || Number(ref.byteLength) > MAX_RECORD || !integer(ref.revision, 1) || !integer(ref.createdAt)
        || typeof ref.complete !== 'boolean' || typeof ref.contentHash !== 'string' || !/^(?:[a-f0-9]{64})?$/.test(ref.contentHash)
        || !['running', 'termination_pending', 'interrupted', 'terminal'].includes(String(ref.executionState)))
        invalid();
    if (ref.complete ? !ref.contentHash || ref.incompleteReason !== undefined : !text(ref.incompleteReason))
        invalid();
    if (!ref.contentHash && ref.byteLength !== 0)
        invalid();
    if ((entry.policyId === undefined) !== (entry.policyRevision === undefined)
        || entry.policyId !== undefined && (!text(entry.policyId) || !integer(entry.policyRevision, 1)))
        invalid();
    if (ref.executionState === 'terminal') {
        if (!['success', 'error', 'cancelled', 'timeout'].includes(String(ref.outcome)) || ref.terminalFactsId !== `${ref.id}:${ref.revision}`
            || typeof ref.terminalFactsHash !== 'string' || !/^[a-f0-9]{64}$/.test(ref.terminalFactsHash)
            || ['cancelled', 'timeout'].includes(String(ref.outcome)) && ref.complete)
            invalid();
    }
    else if (ref.outcome !== undefined || ref.terminalFactsId !== undefined || ref.terminalFactsHash !== undefined || ref.complete)
        invalid();
}
/** Host-only single authority. No renderer or model receives this owner object. */
export function createObservationService(options) {
    bounded(options.profileId);
    bounded(options.redactor.version);
    mkdirSync(options.profileRoot, { recursive: true, mode: 0o700 });
    if (lstatSync(options.profileRoot).isSymbolicLink() || process.platform !== 'win32' && (lstatSync(options.profileRoot).mode & 0o077) !== 0)
        deny('unsafe_root');
    const root = realpathSync(options.profileRoot);
    const dir = join(root, 'observations');
    if (owners.has(root))
        deny('owner_active');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (lstatSync(dir).isSymbolicLink())
        deny('unsafe_root');
    const lockPath = join(root, '.observation-owner.sqlite');
    if (existsSync(lockPath) && lstatSync(lockPath).isSymbolicLink())
        deny('unsafe_root');
    let lock;
    try {
        lock = new Database(lockPath, { timeout: 0 });
        lock.exec('BEGIN EXCLUSIVE');
    }
    catch {
        lock?.close();
        deny('owner_lock_unavailable');
    }
    owners.add(root);
    const now = options.now ?? Date.now;
    const reservedBytes = options.reservedProfileBytes ?? 0;
    if (!Number.isSafeInteger(reservedBytes) || reservedBytes < 0 || reservedBytes >= MAX_PROFILE) {
        lock.close();
        owners.delete(root);
        deny('invalid_limit');
    }
    const limits = { recordBytes: options.limits?.recordBytes ?? MAX_RECORD, collectorBytes: options.limits?.collectorBytes ?? MAX_COLLECTORS, sessionBytes: options.limits?.sessionBytes ?? MAX_SESSION, profileBytes: options.limits?.profileBytes ?? MAX_PROFILE };
    for (const [key, max] of Object.entries({ recordBytes: MAX_RECORD, collectorBytes: MAX_COLLECTORS, sessionBytes: MAX_SESSION, profileBytes: MAX_PROFILE })) {
        if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > max) {
            lock.close();
            owners.delete(root);
            deny('invalid_limit');
        }
    }
    if (reservedBytes >= limits.profileBytes) {
        lock.close();
        owners.delete(root);
        deny('invalid_limit');
    }
    limits.profileBytes -= reservedBytes;
    let disposed = false;
    let collectorBytes = 0;
    let epoch = 1;
    let admission = false;
    let durabilityTainted = false;
    let authorityQuarantined = false;
    const authority = Object.freeze({});
    let authorityId = '';
    const policyFloors = new Map();
    const callers = new WeakMap();
    const scopeGenerations = new Map();
    const scopeKey = (claims) => JSON.stringify([claims.sessionId, claims.ownerAgentId, claims.scopeId]);
    const incarnations = new Map();
    const delegations = new WeakMap();
    const delegatedCallers = new WeakMap();
    const incomingReturns = new WeakMap();
    const delegationApprovals = new WeakMap();
    let delegationApprovalCount = 0;
    const delegationTimers = new Set();
    let delegationCount = 0;
    let delegatedReferenceCount = 0;
    const captures = new WeakMap();
    const active = new Set();
    const records = new Map();
    const policies = new Map();
    const dependencies = new Map();
    const listeners = new Set();
    const pathname = (id, suffix) => { if (!/^[a-f0-9-]{36}$/.test(id))
        deny('invalid_id'); return join(dir, `${id}.${suffix}`); };
    function live() { if (disposed)
        deny('disposed'); if (authorityQuarantined)
        deny('authority_quarantined'); }
    function identity(caller) {
        live();
        const claims = caller && callers.get(caller);
        if (!claims || scopeGenerations.get(scopeKey(claims)) !== claims.permissionGeneration)
            deny();
        const bound = incarnations.get(scopeKey(claims));
        if (bound && bound.permissionGeneration === claims.permissionGeneration) {
            const session = bound.session.deref();
            if (bound.invalid || session && (session.getObservationRestoreGeneration() !== bound.generation || session.exportSnapshot().sessionId !== claims.sessionId))
                deny('stale_session_incarnation');
        }
        return claims;
    }
    function mutate(input, userOnly = false) { const claims = identity(input.caller); if (claims.requestSource !== input.requestSource || userOnly && input.requestSource !== 'user')
        deny('request_source_denied'); if (admission)
        deny('admission_reentrancy'); return claims; }
    function notifyRevocation() { for (const listener of [...listeners]) {
        try {
            listener();
        }
        catch { /* Revocation is committed even if a subscriber fails. */ }
    } }
    function invalidate() { epoch++; dependencies.clear(); notifyRevocation(); }
    function assertExecution(caller) {
        const claims = identity(caller), bound = incarnations.get(scopeKey(claims));
        if (bound && bound.permissionGeneration === claims.permissionGeneration && (bound.ended || !bound.session.deref()))
            deny('consumer_execution_ended');
    }
    function json(value) { const bytes = Buffer.from(JSON.stringify(value)); if (bytes.length > META_LIMIT)
        deny('metadata_budget_exceeded'); return bytes; }
    function atomic(path, bytes) {
        if (usage().total + bytes.length > limits.profileBytes)
            deny('quota_exceeded');
        try {
            writeFileAtomicallySync(path, bytes.toString('utf8'), { requireDirectorySync: true });
        }
        catch (error) {
            durabilityTainted = true;
            throw error;
        }
    }
    function persistAuthority(cleanShutdown) {
        try {
            atomic(join(dir, 'authority.json'), json({ version: 1, authorityId, profileId: options.profileId,
                policyFloors: Object.fromEntries(policyFloors), cleanShutdown }));
        }
        catch (error) {
            // Revocation must abort in-flight sends even when its durable floor fails.
            // Never permit this instance to issue fresh grants after an uncertain write.
            durabilityTainted = true;
            authorityQuarantined = true;
            invalidate();
            throw error;
        }
    }
    function usage() {
        let total = 0;
        const sessions = new Map();
        for (const name of readdirSync(dir)) {
            const path = join(dir, name);
            const stat = lstatSync(path);
            if (!stat.isFile() || stat.isSymbolicLink())
                deny('unsafe_store');
            total += stat.size;
            const entry = records.get(name.slice(0, 36));
            if (entry)
                sessions.set(entry.claims.sessionId, (sessions.get(entry.claims.sessionId) ?? 0) + stat.size);
        }
        return { total, sessions };
    }
    function persist(entry) {
        const bytes = json(entry);
        const used = usage();
        if (used.total + bytes.length > limits.profileBytes || (used.sessions.get(entry.claims.sessionId) ?? 0) + bytes.length > limits.sessionBytes)
            deny('quota_exceeded');
        atomic(pathname(entry.ref.id, 'json'), bytes);
    }
    function terminalBytes(entry) {
        const facts = { version: 1, invocationId: entry.ref.invocationId, scopeId: entry.claims.scopeId, permissionGeneration: entry.claims.permissionGeneration,
            revision: entry.ref.revision, outcome: entry.ref.outcome, terminationConfirmed: true, contentHash: entry.ref.contentHash, byteLength: entry.ref.byteLength, complete: entry.ref.complete };
        return json(facts);
    }
    function terminalRecord(entry) {
        const bytes = terminalBytes(entry);
        entry.ref.terminalFactsId = `${entry.ref.id}:${entry.ref.revision}`;
        entry.ref.terminalFactsHash = hash(bytes);
        const used = usage();
        if (used.total + bytes.length + META_LIMIT > limits.profileBytes || (used.sessions.get(entry.claims.sessionId) ?? 0) + bytes.length + META_LIMIT > limits.sessionBytes)
            deny('quota_exceeded');
        atomic(pathname(entry.ref.id, `terminal-${entry.ref.revision}`), bytes);
    }
    function policyFor(entry) {
        const item = entry.policyId && policies.get(entry.policyId);
        if (!item || !same(item.claims, entry.claims) || item.policy.revision !== entry.policyRevision || item.policy.expiresAt <= now()
            || !item.policy.localPersistence || !item.policy.allowUnclassifiedText || item.policy.sourceAdapterId !== entry.sourceAdapterId
            || !policyMatchesSource(item.policy, entry.sourceHash, entry.readRange))
            return undefined;
        return item.policy;
    }
    function capturePolicy(capture) {
        const grant = delegatedCallers.get(capture.caller);
        try {
            assertExecution(capture.caller);
            if (grant)
                validateGrant(grant);
        }
        catch {
            return undefined;
        }
        return policyFor(capture.record);
    }
    function authorize(caller, id, destination, visited = new Set(), sourceOnly = false) {
        const claims = identity(caller), entry = records.get(id);
        if (claims.surface !== 'ordinary-owner')
            deny('not_ready');
        if (!sourceOnly)
            assertExecution(caller);
        if (!entry || entry.tombstone || entry.recoveryUncertain || !entry.ref.complete || !entry.ref.contentHash || entry.ref.redactionVersion !== options.redactor.version)
            deny('unavailable');
        const primary = delegatedCallers.get(caller);
        if (primary)
            validateGrant(primary);
        // Original source ownership is resolved before incoming edges; a legitimate
        // parent-owned ref must not become cyclic merely because a child returned it.
        if (!same(claims, entry.claims)) {
            if (visited.has(caller) || visited.size >= 32)
                deny('delegation_cycle');
            const next = new Set(visited);
            next.add(caller);
            const candidates = [...(primary ? [primary] : []), ...(incomingReturns.get(caller) ?? [])];
            let authorized = false;
            for (const grant of candidates) {
                if (grant.revisions.get(id) !== entry.ref.revision || grant.destination.provider !== destination.provider
                    || grant.destination.model !== destination.model || grant.destination.url !== destination.url)
                    continue;
                try {
                    validateGrant(grant);
                    authorize(grant.issuer, id, destination, next, true);
                    authorized = true;
                    break;
                }
                catch { /* Another precise grant may remain valid. */ }
            }
            if (!authorized)
                deny('unavailable');
        }
        const policy = policyFor(entry);
        if (!policy || !policy.destinations.some(item => item.provider === destination.provider && item.model === destination.model && item.url === destination.url))
            deny();
        return entry;
    }
    function validateApproval(approval) {
        const claims = identity(approval.caller);
        if (approval.revoked)
            deny('delegation_approval_revoked');
        if (approval.expiresAt <= now())
            deny('delegation_approval_expired');
        for (const expected of approval.policies) {
            const current = policies.get(expected.id);
            if (!current || !same(current.claims, claims) || current.policy.revision !== expected.revision || current.policy.expiresAt < approval.expiresAt)
                deny('delegation_approval_revoked');
        }
    }
    function validateGrant(grant, seen = new Set()) {
        if (seen.has(grant) || seen.size >= 9 || grant.revoked || grant.expiresAt <= now())
            deny('invalid_delegation');
        seen.add(grant);
        identity(grant.issuer);
        identity(grant.recipient);
        if (grant.approval)
            validateApproval(grant.approval);
        const parent = delegatedCallers.get(grant.issuer);
        if (parent)
            validateGrant(parent, seen);
    }
    function issueGrant(input, approval, returning = false) {
        const claims = mutate(input, !approval);
        assertExecution(input.caller);
        const recipient = identity(input.recipient);
        if (claims.surface !== 'ordinary-owner' || recipient.surface !== 'ordinary-owner' || same(claims, recipient))
            deny('not_ready');
        if (!Array.isArray(input.observationIds) || (!approval && !input.observationIds.length) || input.observationIds.length > 4096
            || new Set(input.observationIds).size !== input.observationIds.length || !Number.isSafeInteger(input.expiresAt)
            || input.expiresAt <= now() || input.expiresAt - now() > 86400000 || delegationCount >= 4096 || delegatedReferenceCount + input.observationIds.length > 4096)
            deny('invalid_delegation');
        const parent = delegatedCallers.get(input.caller);
        if (parent)
            validateGrant(parent);
        if (approval) {
            validateApproval(approval);
            if (parent ? parent.approval !== approval : !same(claims, identity(approval.caller)))
                deny('invalid_delegation_approval');
            if (input.expiresAt > approval.expiresAt || input.destination.provider !== approval.destination.provider
                || input.destination.model !== approval.destination.model || input.destination.url !== approval.destination.url
                || !returning && approval.children >= approval.maxChildren)
                deny('invalid_delegation_approval');
        }
        const depth = returning ? (parent?.depth ?? 0) : (parent?.depth ?? 0) + 1;
        if (approval && depth > approval.maxDepth)
            deny('invalid_delegation_approval');
        if (depth > 8 || parent && input.expiresAt > parent.expiresAt)
            deny('invalid_delegation');
        const revisions = new Map();
        for (const id of input.observationIds) {
            const entry = authorize(input.caller, id, input.destination);
            const policy = policyFor(entry);
            if (!policy || input.expiresAt > policy.expiresAt)
                deny('invalid_delegation');
            revisions.set(id, entry.ref.revision);
        }
        const capability = Object.freeze({});
        const grant = { issuer: input.caller, recipient: input.recipient, destination: structuredClone(input.destination), revisions, expiresAt: input.expiresAt, depth, bound: false, revoked: false, approval, returning };
        // Expiry aborts existing in-flight transport leases, in addition to checks at dispatch.
        const timer = setTimeout(() => { delegationTimers.delete(timer); grant.revoked = true; invalidate(); }, Math.max(1, input.expiresAt - now()));
        timer.unref();
        grant.timer = timer;
        delegationTimers.add(timer);
        delegations.set(capability, grant);
        if (approval && !returning)
            approval.children++;
        delegationCount++;
        delegatedReferenceCount += revisions.size;
        return capability;
    }
    function setArchivePolicy(input, inherited = false) {
        const claims = mutate(input, true);
        const policy = structuredClone(input.policy);
        if (claims.surface !== 'ordinary-owner' || policy.version !== 1 || policy.scopeId !== claims.scopeId || !Number.isSafeInteger(policy.revision) || policy.revision < 1 || !Number.isFinite(policy.expiresAt) || policy.expiresAt <= now())
            deny('invalid_policy');
        if ([policy.localPersistence, policy.allowUnclassifiedText, policy.allowIncomplete].some(value => typeof value !== 'boolean'))
            deny('invalid_policy');
        bounded(policy.id);
        bounded(policy.sourceAdapterId);
        if (!Array.isArray(policy.sourceDescriptors) || !Array.isArray(policy.destinations) || policy.readFileScopes !== undefined && !Array.isArray(policy.readFileScopes) || !policy.sourceDescriptors.length && !policy.readFileScopes?.length)
            deny('invalid_policy');
        if (policy.readFileScopes !== undefined) {
            if (policy.sourceAdapterId !== 'native.read.v1')
                deny('invalid_read_scope');
            policy.readFileScopes = policy.readFileScopes.map(scope => {
                if (!scope || Object.keys(scope).some(key => !['filePath', 'startLine', 'endLine'].includes(key)) || !validLine(scope.startLine)
                    || scope.endLine !== undefined && (!validLine(scope.endLine) || scope.endLine < scope.startLine))
                    deny('invalid_read_scope');
                // Only the private inheritance path receives an already normalized selector digest.
                if (inherited) {
                    if (!/^[a-f0-9]{64}$/.test(scope.filePath))
                        deny('invalid_read_scope');
                    return { ...scope };
                }
                const path = normalizedFilePath(scope.filePath);
                // This is an explicit ordinary-owner file selector, not an OS confinement guarantee.
                if (!existsSync(scope.filePath) || lstatSync(scope.filePath).isSymbolicLink() || !lstatSync(scope.filePath).isFile())
                    deny('invalid_read_scope');
                return { filePath: hash(path), startLine: scope.startLine, ...(scope.endLine === undefined ? {} : { endLine: scope.endLine }) };
            });
        }
        policy.sourceDescriptors = inherited ? policy.sourceDescriptors.map(value => { if (!/^[a-f0-9]{64}$/.test(value))
            deny('invalid_source'); return value; }) : policy.sourceDescriptors.map(sourceHash);
        for (const destination of policy.destinations) {
            bounded(destination.provider);
            bounded(destination.model);
            bounded(destination.url, 2048);
            const url = new URL(destination.url);
            if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.href !== destination.url)
                deny('invalid_destination');
        }
        json(policy);
        if (policy.revision < (policyFloors.get(policy.id) ?? 1))
            deny('stale_policy');
        const previous = policies.get(policy.id);
        if (previous && (!same(previous.claims, claims) || policy.revision <= previous.policy.revision))
            deny('stale_policy');
        if (inherited) {
            if (policyFloors.has(policy.id) || policies.has(policy.id))
                deny('stale_policy');
        }
        else
            invalidate();
        policyFloors.set(policy.id, policy.revision);
        policies.delete(policy.id);
        persistAuthority(false);
        policies.set(policy.id, { policy, claims });
    }
    function reclaim() {
        for (const entry of records.values())
            if (!entry.tombstone && entry.endedAt !== undefined && entry.endedAt + 7 * 86400000 < now() && !entry.pins.length) {
                entry.tombstone = true;
                invalidate();
                persist(entry);
                const path = pathname(entry.ref.id, 'body');
                if (existsSync(path))
                    unlinkSync(path);
            }
    }
    // The capability never leaves this service instance or enters caller bindings.
    const referenceRecoveryCapability = Object.freeze({ owner: authority, recoveryEpoch: epoch });
    function reconcileReferences(capability) {
        if (capability !== referenceRecoveryCapability || !options.resolveReferenceOwner)
            return;
        for (const entry of records.values())
            for (const referenceId of [...entry.pins]) {
                if (entry.tombstone || !entry.ref.contentHash || !entry.policyId || !entry.policyRevision)
                    continue;
                const facts = Object.freeze({ authorityId, profileId: options.profileId, sourceSessionId: entry.claims.sessionId, ownerAgentId: entry.claims.ownerAgentId, scopeId: entry.claims.scopeId, permissionGeneration: entry.claims.permissionGeneration, observationId: entry.ref.id, contentHash: entry.ref.contentHash, revision: entry.ref.revision, policyId: entry.policyId, policyRevision: entry.policyRevision, referenceId });
                let resolution;
                try {
                    resolution = options.resolveReferenceOwner(facts);
                }
                catch {
                    continue;
                }
                if (resolution && typeof resolution === 'object' && 'then' in resolution) {
                    void Promise.resolve(resolution).catch(() => { });
                    continue;
                }
                if (!resolution || typeof resolution !== 'object' || resolution.state !== 'deleted' || typeof resolution.deletionReceiptId !== 'string' || !resolution.deletionReceiptId || resolution.deletionReceiptId.length > 512 || !Number.isSafeInteger(resolution.deletedAt) || resolution.deletedAt < 0 || resolution.deletedAt > now())
                    continue;
                const previous = { pins: entry.pins, endedAt: entry.endedAt, audit: entry.referenceReconciliation };
                entry.pins = entry.pins.filter(pin => pin !== referenceId);
                entry.endedAt ??= resolution.deletedAt;
                entry.referenceReconciliation = { actorKind: 'system_reconcile', deletionReceiptId: resolution.deletionReceiptId, referenceId, reconciledAt: now(), recoveryEpoch: capability.recoveryEpoch };
                try {
                    persist(entry);
                }
                catch (error) {
                    entry.pins = previous.pins;
                    entry.endedAt = previous.endedAt;
                    entry.referenceReconciliation = previous.audit;
                    throw error;
                }
            }
    }
    // Private system_reconcile: indexes are never trusted to confer live grants.
    try {
        // Only unpublished regular temporary files may be discarded before identity
        // recovery. Committed indexes/bodies still require the original authority.
        for (const name of readdirSync(dir)) {
            const path = join(dir, name);
            const stat = lstatSync(path);
            if (stat.isSymbolicLink() || !stat.isFile())
                deny('unsafe_store');
            if (name.endsWith('.tmp'))
                unlinkSync(path);
        }
        const identityPath = join(dir, 'authority.json');
        let previousCleanShutdown = true;
        if (existsSync(identityPath)) {
            if (lstatSync(identityPath).isSymbolicLink() || lstatSync(identityPath).size > META_LIMIT)
                deny('invalid_authority');
            const saved = JSON.parse(readFileSync(identityPath, 'utf8'));
            if (saved.profileId !== options.profileId || typeof saved.authorityId !== 'string' || !/^[a-f0-9-]{36}$/.test(saved.authorityId))
                deny('invalid_authority');
            authorityId = saved.authorityId;
            previousCleanShutdown = saved.cleanShutdown === true;
            for (const [id, revision] of Object.entries(saved.policyFloors ?? {})) {
                bounded(id);
                if (!Number.isSafeInteger(revision) || Number(revision) < 1)
                    deny('invalid_authority');
                policyFloors.set(id, Number(revision));
            }
        }
        else {
            if (readdirSync(dir).length)
                deny('authority_missing');
            authorityId = randomUUID();
        }
        if (!previousCleanShutdown) {
            // A failed revocation may have lost R+1. Raise only the rejection floor;
            // no grant is upgraded or restored. The host must explicitly renew it.
            for (const [id, revision] of policyFloors) {
                if (revision >= Number.MAX_SAFE_INTEGER)
                    deny('policy_revision_exhausted');
                policyFloors.set(id, revision + 1);
            }
        }
        // A durably dirty marker must precede every possible archive mutation.
        // A failed post-rename flush cannot later be mistaken for a confirmed commit.
        persistAuthority(false);
        for (const name of readdirSync(dir)) {
            const path = join(dir, name);
            if (lstatSync(path).isSymbolicLink())
                deny('unsafe_store');
            if (name.endsWith('.tmp')) {
                unlinkSync(path);
                continue;
            }
            if (!/^[a-f0-9-]{36}\.json$/.test(name))
                continue;
            if (lstatSync(path).size > META_LIMIT)
                deny('invalid_index');
            const entry = JSON.parse(readFileSync(path, 'utf8'));
            validateRecoveredEntry(entry);
            if (!entry?.ref || name !== `${entry.ref.id}.json` || !Array.isArray(entry.pins) || !entry.claims || typeof entry.tombstone !== 'boolean')
                deny('invalid_index');
            if (!Number.isSafeInteger(entry.ref.byteLength) || entry.ref.byteLength < 0 || entry.ref.byteLength > MAX_RECORD || !Number.isSafeInteger(entry.ref.revision) || entry.ref.revision < 1)
                deny('invalid_index');
            pathname(entry.ref.id, 'json');
            records.set(entry.ref.id, entry);
            // The exclusive profile lock proves the prior storage owner is gone.
            // This is not tool completion or a grant: all recovered disclosures remain
            // quarantined and referenced entries keep every pin.
            if (!previousCleanShutdown && (!entry.recoveryUncertain || entry.endedAt === undefined)) {
                entry.recoveryUncertain = true;
                entry.endedAt ??= now();
                persist(entry);
            }
            if (entry.ref.executionState === 'running') {
                entry.ref = { ...entry.ref, complete: false, incompleteReason: 'interrupted', executionState: 'interrupted', revision: entry.ref.revision + 1 };
                delete entry.ref.outcome;
                persist(entry);
            }
            if (entry.ref.executionState === 'terminal' && !entry.tombstone) {
                const factsPath = pathname(entry.ref.id, `terminal-${entry.ref.revision}`);
                const expected = terminalBytes(entry);
                if (!existsSync(factsPath) || !lstatSync(factsPath).isFile() || lstatSync(factsPath).isSymbolicLink() || lstatSync(factsPath).size > META_LIMIT
                    || hash(readFileSync(factsPath)) !== entry.ref.terminalFactsHash || !readFileSync(factsPath).equals(expected)) {
                    entry.tombstone = true;
                    persist(entry);
                }
            }
            const body = pathname(entry.ref.id, 'body');
            if (entry.tombstone || !entry.ref.contentHash) {
                if (existsSync(body))
                    unlinkSync(body);
            }
            else if (!existsSync(body) || lstatSync(body).size !== entry.ref.byteLength || hash(readFileSync(body)) !== entry.ref.contentHash) {
                entry.tombstone = true;
                persist(entry);
            }
        }
        for (const name of readdirSync(dir))
            if (name.endsWith('.body') && !records.has(name.slice(0, -5)))
                unlinkSync(join(dir, name));
        reconcileReferences(referenceRecoveryCapability);
        reclaim();
    }
    catch (error) {
        owners.delete(root);
        lock.close();
        throw error;
    }
    const transportPort = {
        authority,
        withAdmission(operation) { live(); if (admission)
            deny('admission_reentrancy'); admission = true; try {
            return operation();
        }
        finally {
            admission = false;
        } },
        validate(snapshot, destination) {
            live();
            if (!snapshot.length)
                deny();
            for (const dep of snapshot) {
                const item = dependencies.get(dep.key);
                if (dep.authority !== authority || !item || dep.epoch !== item.epoch || item.epoch !== epoch || item.destination.url !== destination)
                    deny();
                const entry = authorize(item.caller, item.id, item.destination);
                if (entry.ref.revision !== item.revision)
                    deny();
            }
        },
        onRevoke(listener) { live(); listeners.add(listener); return () => listeners.delete(listener); },
    };
    return {
        transportPort,
        /** Host lifecycle event only; no caller or requestSource can mint this capability. */
        reconcileReferenceOwners() { live(); reconcileReferences(referenceRecoveryCapability); reclaim(); },
        getStorageBudget() { live(); return Object.freeze({ profileRoot: root, profileBytes: limits.profileBytes, reservedBytes }); },
        get authorityId() { return authorityId; },
        getReferenceMetadata(caller, id) {
            const claims = identity(caller);
            const entry = records.get(id);
            const delegation = delegatedCallers.get(caller) ?? [...(incomingReturns.get(caller) ?? [])].find(grant => grant.revisions.has(id));
            if (delegation)
                authorize(caller, id, delegation.destination);
            else if (!entry || !same(claims, entry.claims) || entry.tombstone || entry.recoveryUncertain || !entry.ref.complete || !entry.ref.contentHash || !policyFor(entry))
                deny('unavailable');
            if (!entry)
                deny('unavailable');
            return Object.freeze({ authorityId, profileId: options.profileId, sourceSessionId: entry.claims.sessionId, ownerAgentId: entry.claims.ownerAgentId,
                scopeId: entry.claims.scopeId, permissionGeneration: entry.claims.permissionGeneration, observationId: id, contentHash: entry.ref.contentHash,
                revision: entry.ref.revision, policyId: entry.policyId, policyRevision: entry.policyRevision });
        },
        /** Existing recipient rights only. Ending a creator is not a new delegation. */
        assertPublishedSourceRead(input) {
            const source = identity(input.source);
            assertExecution(input.recipient);
            const incarnation = incarnations.get(scopeKey(source));
            if (!incarnation || incarnation.permissionGeneration !== source.permissionGeneration)
                deny('source_incarnation_changed');
            if (!incarnation.ended)
                assertExecution(input.source);
            const primary = delegatedCallers.get(input.source);
            const candidates = [...(primary && primary.issuer === input.recipient ? [primary] : []),
                ...[...(incomingReturns.get(input.recipient) ?? [])].filter(grant => grant.issuer === input.source)];
            if (!candidates.some(grant => {
                try {
                    validateGrant(grant);
                    return grant.bound && grant.destination.provider === input.destination.provider
                        && grant.destination.model === input.destination.model && grant.destination.url === input.destination.url;
                }
                catch {
                    return false;
                }
            }))
                deny('returned_read_not_authorized');
            const recipientGrant = delegatedCallers.get(input.recipient);
            if (recipientGrant)
                validateGrant(recipientGrant);
            for (const id of input.observationIds) {
                authorize(input.source, id, input.destination, new Set(), true);
                authorize(input.recipient, id, input.destination);
            }
        },
        assertClosedSourceRead(input) {
            const source = identity(input.source), incarnation = incarnations.get(scopeKey(source));
            if (!incarnation?.ended)
                deny('source_not_ended');
            this.assertPublishedSourceRead(input);
        },
        bindCaller(claims) {
            live();
            for (const value of [claims.sessionId, claims.ownerAgentId, claims.scopeId])
                bounded(value);
            if (!['user', 'agent', 'scheduler'].includes(claims.requestSource) || !['ordinary-owner', 'room', 'restricted', 'multi-authority'].includes(claims.surface) || !Number.isSafeInteger(claims.permissionGeneration) || claims.permissionGeneration < 0)
                deny();
            const key = scopeKey(claims);
            const generation = scopeGenerations.get(key);
            if (generation !== undefined && claims.permissionGeneration < generation)
                deny('stale_scope');
            if (generation !== undefined && claims.permissionGeneration > generation)
                invalidate();
            scopeGenerations.set(key, claims.permissionGeneration);
            const token = Object.freeze({});
            callers.set(token, structuredClone(claims));
            return token;
        },
        bindConsumerIncarnation(caller, session) {
            const claims = identity(caller), key = scopeKey(claims);
            if (!(session instanceof AgentSessionState) || session.exportSnapshot().sessionId !== claims.sessionId)
                deny('invalid_consumer');
            const existing = incarnations.get(key);
            if (existing?.permissionGeneration === claims.permissionGeneration) {
                if (existing.ended || existing.session.deref() !== session || existing.generation !== session.getObservationRestoreGeneration())
                    deny('stale_session_incarnation');
                return;
            }
            if (!existing && incarnations.size >= 4096)
                deny('incarnation_quota_exceeded');
            existing?.unsubscribe();
            const bound = { session: new WeakRef(session), generation: session.getObservationRestoreGeneration(), permissionGeneration: claims.permissionGeneration, invalid: false, ended: false, unsubscribe: () => { } };
            bound.unsubscribe = session.onObservationRestoreGeneration(() => { bound.invalid = true; invalidate(); });
            incarnations.set(key, bound);
        },
        endConsumerExecution(caller) {
            const claims = callers.get(caller);
            if (!claims)
                return;
            const bound = incarnations.get(scopeKey(claims));
            if (!bound || bound.permissionGeneration !== claims.permissionGeneration || bound.ended)
                return;
            bound.ended = true;
            notifyRevocation();
        },
        assertConsumerSession(caller, sessionId) {
            const claims = identity(caller);
            if (claims.sessionId !== sessionId || claims.surface !== 'ordinary-owner')
                deny('invalid_consumer');
        },
        /** Host provider admission must validate an execution even with zero archived references. */
        assertConsumerExecution(caller, sessionId, destination) {
            assertExecution(caller);
            const claims = identity(caller), grant = delegatedCallers.get(caller);
            if (claims.sessionId !== sessionId || claims.surface !== 'ordinary-owner')
                deny('invalid_consumer');
            if (grant) {
                validateGrant(grant);
                if (grant.destination.provider !== destination.provider || grant.destination.model !== destination.model || grant.destination.url !== destination.url)
                    deny('invalid_delegation');
            }
        },
        inspectDelegation(input) {
            const parent = identity(input.parentCaller), recipient = identity(input.recipient);
            const grant = delegations.get(input.capability);
            if (!grant || grant.revoked || grant.expiresAt <= now() || grant.recipient !== input.recipient || recipient.sessionId !== input.sessionId
                || !same(parent, identity(grant.issuer)) || delegatedCallers.get(input.parentCaller) !== delegatedCallers.get(grant.issuer)
                || grant.destination.provider !== input.destination.provider || grant.destination.model !== input.destination.model || grant.destination.url !== input.destination.url)
                deny('invalid_delegation');
            validateGrant(grant);
            return Object.freeze([...grant.revisions].map(([id, revision]) => {
                const entry = authorize(grant.issuer, id, grant.destination);
                if (entry.ref.revision !== revision)
                    deny('invalid_delegation');
                return Object.freeze(structuredClone(entry.ref));
            }));
        },
        getDelegatedReferences(caller, sessionId, destination) {
            const claims = identity(caller), grant = delegatedCallers.get(caller);
            if (!grant)
                return undefined;
            validateGrant(grant);
            if (claims.sessionId !== sessionId)
                deny('invalid_delegation');
            return Object.freeze([...grant.revisions.keys()].map(id => Object.freeze(structuredClone(authorize(caller, id, destination).ref))));
        },
        approveDelegation(input) {
            const claims = mutate(input, true);
            assertExecution(input.caller);
            if (claims.surface !== 'ordinary-owner' || delegatedCallers.has(input.caller) || delegationApprovalCount >= 256
                || !Number.isSafeInteger(input.maxDepth) || input.maxDepth < 1 || input.maxDepth > 8
                || !Number.isSafeInteger(input.maxChildren) || input.maxChildren < 1 || input.maxChildren > 256
                || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now() || input.expiresAt - now() > 86400000)
                deny('invalid_delegation_approval');
            if (input.sourcePolicyIds !== undefined && (!Array.isArray(input.sourcePolicyIds) || input.sourcePolicyIds.length > 256
                || input.sourcePolicyIds.some(id => typeof id !== 'string') || new Set(input.sourcePolicyIds).size !== input.sourcePolicyIds.length))
                deny('invalid_delegation_approval');
            const sourcePolicies = [...policies.values()].filter(item => (input.sourcePolicyIds === undefined || input.sourcePolicyIds.includes(item.policy.id)) && same(item.claims, claims) && item.policy.localPersistence && item.policy.allowUnclassifiedText
                && item.policy.expiresAt >= input.expiresAt && item.policy.destinations.some(dest => dest.provider === input.destination.provider && dest.model === input.destination.model && dest.url === input.destination.url)).map(item => structuredClone(item.policy));
            if (input.sourcePolicyIds === undefined ? !sourcePolicies.length : sourcePolicies.length !== input.sourcePolicyIds.length)
                deny('invalid_delegation_approval');
            const approval = { caller: input.caller, destination: structuredClone(input.destination), maxDepth: input.maxDepth, maxChildren: input.maxChildren, expiresAt: input.expiresAt, children: 0, policies: sourcePolicies, revoked: false };
            const token = Object.freeze({});
            delegationApprovals.set(token, approval);
            delegationApprovalCount++;
            return token;
        },
        issueDelegationWithApproval(input) {
            const approval = delegationApprovals.get(input.approval);
            if (!approval)
                deny('invalid_delegation_approval');
            return issueGrant(input, approval);
        },
        inheritDelegatedArchivePolicies(input) {
            mutate(input, true);
            const approval = delegationApprovals.get(input.approval), grant = delegations.get(input.capability);
            if (!approval || approval.caller !== input.caller || !grant || grant.approval !== approval || delegatedCallers.get(input.recipient) !== grant)
                deny('invalid_delegation_approval');
            validateGrant(grant);
            if (grant.inheritedPolicies)
                deny('policies_already_inherited');
            grant.inheritedPolicies = true;
            const claims = identity(input.recipient);
            const user = Object.freeze({});
            callers.set(user, { ...claims, requestSource: 'user' });
            for (const policy of approval.policies)
                setArchivePolicy({ requestSource: 'user', caller: user,
                    policy: { ...structuredClone(policy), id: randomUUID(), scopeId: claims.scopeId, revision: 1, expiresAt: Math.min(policy.expiresAt, grant.expiresAt) } }, true);
        },
        issueDelegationReturn(input) {
            mutate(input);
            const approval = delegationApprovals.get(input.approval), primary = delegatedCallers.get(input.caller);
            if (!approval || !primary || primary.approval !== approval || input.recipient !== primary.issuer || !input.observationIds.length)
                deny('invalid_delegation_return');
            return issueGrant({ ...input, expiresAt: input.expiresAt ?? Math.min(primary.expiresAt, approval.expiresAt) }, approval, true);
        },
        issueDelegationMessage(input) {
            mutate(input);
            const approval = delegationApprovals.get(input.approval);
            if (!approval || !Array.isArray(input.observationIds))
                deny('invalid_delegation_message');
            const target = identity(input.recipient), targetGrant = delegatedCallers.get(input.recipient), sourceGrant = delegatedCallers.get(input.caller);
            if (targetGrant) {
                validateGrant(targetGrant);
                if (targetGrant.approval !== approval)
                    deny('invalid_delegation_message');
            }
            else if (!same(target, identity(approval.caller)))
                deny('invalid_delegation_message');
            const expiresAt = Math.min(approval.expiresAt, targetGrant?.expiresAt ?? Infinity, sourceGrant?.expiresAt ?? Infinity);
            if (input.expiresAt !== undefined && input.expiresAt > expiresAt)
                deny('invalid_delegation_message');
            // This adds a read-only material edge between existing consumers, not a new execution child.
            return issueGrant({ ...input, expiresAt: input.expiresAt ?? expiresAt }, approval, true);
        },
        validateDelegationMessage(input) {
            identity(input.issuer);
            identity(input.recipient);
            assertExecution(input.issuer);
            assertExecution(input.recipient);
            const grant = delegations.get(input.capability);
            if (!grant || !grant.returning || !grant.bound || grant.issuer !== input.issuer || grant.recipient !== input.recipient
                || grant.destination.provider !== input.destination.provider || grant.destination.model !== input.destination.model
                || grant.destination.url !== input.destination.url)
                deny('invalid_delegation_message');
            validateGrant(grant);
            const recipientGrant = delegatedCallers.get(input.recipient);
            if (recipientGrant) {
                validateGrant(recipientGrant);
                if (recipientGrant.approval !== grant.approval)
                    deny('invalid_delegation_message');
            }
            for (const id of grant.revisions.keys())
                authorize(grant.issuer, id, grant.destination);
        },
        attachDelegationReturn(input) {
            identity(input.recipient);
            const grant = delegations.get(input.capability);
            if (!grant || !grant.returning || grant.bound || grant.recipient !== input.recipient)
                deny('invalid_delegation_return');
            validateGrant(grant);
            for (const id of grant.revisions.keys())
                authorize(grant.issuer, id, grant.destination);
            let incoming = incomingReturns.get(input.recipient);
            if (!incoming) {
                incoming = new Set();
                incomingReturns.set(input.recipient, incoming);
            }
            incoming.add(grant);
            grant.bound = true;
        },
        issueDelegation(input) { return issueGrant(input); },
        bindDelegatedCaller(input) {
            const claims = identity(input.recipient);
            const grant = delegations.get(input.capability);
            if (!grant || grant.returning || grant.bound || grant.revoked || grant.recipient !== input.recipient || grant.expiresAt <= now())
                deny('invalid_delegation');
            validateGrant(grant);
            for (const id of grant.revisions.keys()) {
                const entry = authorize(grant.issuer, id, grant.destination);
                if (entry.ref.revision !== grant.revisions.get(id))
                    deny('invalid_delegation');
            }
            const caller = Object.freeze({});
            callers.set(caller, structuredClone(claims));
            delegatedCallers.set(caller, grant);
            grant.bound = true;
            return caller;
        },
        revokeDelegation(input) {
            mutate(input, true);
            const grant = delegations.get(input.capability);
            if (!grant || (grant.issuer !== input.caller && grant.approval?.caller !== input.caller))
                deny('invalid_delegation');
            grant.revoked = true;
            if (grant.timer) {
                clearTimeout(grant.timer);
                delegationTimers.delete(grant.timer);
            }
            invalidate();
        },
        revokeDelegationApproval(input) {
            mutate(input, true);
            const approval = delegationApprovals.get(input.approval);
            if (!approval || approval.caller !== input.caller)
                deny('invalid_delegation_approval');
            approval.revoked = true;
            invalidate();
        },
        setArchivePolicy(input) { setArchivePolicy(input); },
        revokePolicy(input) { const claims = mutate(input, true); const item = policies.get(input.policyId); if (!item || !same(item.claims, claims))
            deny(); invalidate(); policies.delete(input.policyId); policyFloors.set(input.policyId, item.policy.revision + 1); persistAuthority(false); },
        begin(input) {
            const claims = mutate(input);
            if (claims.surface !== 'ordinary-owner')
                deny('not_ready');
            assertExecution(input.caller);
            const grant = delegatedCallers.get(input.caller);
            if (grant)
                validateGrant(grant);
            bounded(input.invocationId);
            bounded(input.toolName);
            bounded(input.sourceAdapterId);
            const digest = sourceHash(input.sourceDescriptor);
            const readRange = parseReadRange(input.toolName, input.sourceAdapterId, input.sourceDescriptor);
            const item = [...policies.values()].find(value => same(value.claims, claims) && value.policy.sourceAdapterId === input.sourceAdapterId && policyMatchesSource(value.policy, digest, readRange) && value.policy.expiresAt > now() && value.policy.localPersistence && value.policy.allowUnclassifiedText);
            const id = randomUUID();
            const record = { claims, sourceHash: digest, sourceAdapterId: input.sourceAdapterId, ...(readRange ? { readRange } : {}), policyId: item?.policy.id, policyRevision: item?.policy.revision, pins: [], tombstone: false,
                ref: { version: 1, id, sessionId: claims.sessionId, invocationId: input.invocationId, toolName: input.toolName, contentHash: '', byteLength: 0, complete: false, incompleteReason: 'capture_running', executionState: 'running', redactionVersion: options.redactor.version, createdAt: now(), revision: 1 } };
            reclaim();
            const used = usage();
            if (used.total + META_LIMIT * 2 > limits.profileBytes || (used.sessions.get(claims.sessionId) ?? 0) + META_LIMIT * 2 > limits.sessionBytes)
                deny('quota_exceeded');
            persist(record);
            records.set(id, record);
            const token = Object.freeze({});
            const capture = { caller: input.caller, record, chunks: [], bytes: 0, allowed: Boolean(item), reason: item ? undefined : 'archive_policy_denied', finalized: false };
            captures.set(token, capture);
            active.add(capture);
            return token;
        },
        append(input) {
            mutate(input);
            const capture = captures.get(input.capture);
            if (!capture || capture.caller !== input.caller || capture.finalized)
                deny('invalid_capture');
            if (!capture.allowed || capture.reason)
                return;
            if (!capturePolicy(capture)) {
                capture.allowed = false;
                capture.reason = 'archive_policy_denied';
                collectorBytes -= capture.bytes;
                capture.bytes = 0;
                capture.chunks = [];
                return;
            }
            if (typeof input.text !== 'string')
                deny('invalid_chunk');
            const size = Buffer.byteLength(input.text);
            if (capture.bytes + size > limits.recordBytes || collectorBytes + size > limits.collectorBytes) {
                capture.reason = 'output_budget_exceeded';
                return;
            }
            const bytes = Buffer.from(input.text);
            capture.chunks.push(bytes);
            capture.bytes += bytes.length;
            collectorBytes += bytes.length;
        },
        finalize(input) {
            mutate(input);
            const capture = captures.get(input.capture);
            if (!capture || capture.caller !== input.caller)
                deny('invalid_capture');
            if (capture.finalized) {
                if (capture.record.tombstone)
                    deny('archive_unavailable');
                return structuredClone(capture.record.ref);
            }
            const record = capture.record;
            const policy = capturePolicy(capture);
            // Actual terminal facts take precedence over optional caller annotations.
            // Invalid annotations are fixed metadata, never echoed (they may be secrets).
            const suppliedReason = input.incompleteReason === undefined ? undefined
                : typeof input.incompleteReason === 'string' && ['output_budget_exceeded', 'collector_unavailable', 'timeout', 'cancelled', 'termination_unconfirmed', 'terminated_for_elevation', 'extraction_completeness_unverified', 'interrupted'].includes(input.incompleteReason)
                    ? input.incompleteReason : 'invalid_incomplete_reason';
            const terminalReason = input.executionState !== 'terminal' ? 'termination_unconfirmed'
                : input.outcome === 'timeout' || input.outcome === 'cancelled' ? input.outcome : undefined;
            const reason = terminalReason ?? (!capture.allowed || !policy ? 'archive_policy_denied' : capture.reason ?? suppliedReason);
            let body;
            let failure = reason;
            // V1 has no qualified partial-output redactor: consent cannot make a
            // truncated known secret safe. Keep only metadata and the original outcome.
            try {
                if (capture.allowed && policy && !reason) {
                    const text = options.redactor.redact(Buffer.concat(capture.chunks, capture.bytes).toString('utf8'));
                    if (typeof text !== 'string')
                        deny('redaction_unverifiable');
                    body = Buffer.from(text);
                    if (body.length > limits.recordBytes) {
                        body = undefined;
                        failure = 'output_budget_exceeded';
                    }
                }
            }
            catch {
                body = undefined;
                failure = 'redaction_unverifiable';
            }
            finally {
                collectorBytes -= capture.bytes;
                capture.bytes = 0;
                capture.chunks = [];
                capture.finalized = true;
                active.delete(capture);
            }
            if (!['terminal', 'termination_pending', 'interrupted'].includes(input.executionState) || input.executionState === 'terminal' && !['success', 'error', 'cancelled', 'timeout'].includes(input.outcome ?? ''))
                deny('invalid_terminal_facts');
            const used = usage();
            if (body && (used.total + body.length + META_LIMIT > limits.profileBytes || (used.sessions.get(record.claims.sessionId) ?? 0) + body.length + META_LIMIT > limits.sessionBytes)) {
                body = undefined;
                failure = 'quota_exceeded';
            }
            record.ref = { ...record.ref, complete: !failure && Boolean(body), incompleteReason: failure, executionState: input.executionState, outcome: input.executionState === 'terminal' ? input.outcome : undefined, revision: record.ref.revision + 1, contentHash: body ? hash(body) : '', byteLength: body?.length ?? 0 };
            try {
                if (input.executionState === 'terminal')
                    terminalRecord(record);
                if (body)
                    atomic(pathname(record.ref.id, 'body'), body);
                persist(record);
            }
            catch {
                record.tombstone = true;
                invalidate();
                throw new Error('observation_archive_unavailable');
            }
            return structuredClone(record.ref);
        },
        reviseTerminal(input) {
            const claims = mutate(input);
            const entry = records.get(input.id);
            if (!entry || !same(entry.claims, claims) || entry.tombstone || !['success', 'error', 'cancelled', 'timeout'].includes(input.outcome))
                deny();
            invalidate();
            entry.ref = { ...entry.ref, executionState: 'terminal', outcome: input.outcome, revision: entry.ref.revision + 1,
                ...(['cancelled', 'timeout'].includes(input.outcome) ? { complete: false, incompleteReason: input.outcome } : {}) };
            // A later termination confirmation never retroactively repairs incomplete collection.
            try {
                terminalRecord(entry);
                persist(entry);
            }
            catch {
                entry.tombstone = true;
                throw new Error('observation_archive_unavailable');
            }
            return structuredClone(entry.ref);
        },
        revokeCaller(input) {
            const claims = mutate(input, true);
            const target = identity(input.target);
            if (!same(claims, target))
                deny();
            invalidate();
            callers.delete(input.target);
        },
        read(input) {
            const entry = authorize(input.caller, input.id, input.destination);
            const { offset, maxBytes } = input;
            if (!Number.isSafeInteger(offset) || offset < 0 || offset > entry.ref.byteLength || !Number.isSafeInteger(maxBytes) || maxBytes < 4 || maxBytes > 65536)
                deny('invalid_page');
            const path = pathname(input.id, 'body');
            if (!existsSync(path) || lstatSync(path).isSymbolicLink() || lstatSync(path).size !== entry.ref.byteLength || entry.ref.byteLength > limits.recordBytes)
                deny('unavailable');
            const bytes = readFileSync(path);
            if (hash(bytes) !== entry.ref.contentHash)
                deny('unavailable');
            if (offset < bytes.length && (bytes[offset] & 0xc0) === 0x80)
                deny('invalid_utf8_offset');
            let end = Math.min(bytes.length, offset + maxBytes);
            while (end < bytes.length && (bytes[end] & 0xc0) === 0x80)
                end--;
            if (end === offset && offset < bytes.length)
                deny('invalid_page');
            let key;
            for (const [candidate, dep] of dependencies) {
                if (dep.id === input.id && dep.revision === entry.ref.revision && dep.caller === input.caller && dep.epoch === epoch
                    && dep.destination.provider === input.destination.provider && dep.destination.model === input.destination.model && dep.destination.url === input.destination.url) {
                    key = candidate;
                    break;
                }
            }
            if (!key) {
                if (dependencies.size >= 4096)
                    deny('dependency_budget_exceeded');
                key = randomUUID();
                dependencies.set(key, { id: input.id, revision: entry.ref.revision, caller: input.caller, destination: structuredClone(input.destination), epoch });
            }
            return { content: bytes.subarray(offset, end).toString('utf8'), nextOffset: end, eof: end === bytes.length, contentHash: entry.ref.contentHash, complete: entry.ref.complete, dependencies: Object.freeze([Object.freeze({ authority, key, epoch })]) };
        },
        clear(input) { const claims = mutate(input, true); const entry = records.get(input.id); if (!entry || !same(entry.claims, claims))
            deny(); entry.tombstone = true; invalidate(); persist(entry); const path = pathname(input.id, 'body'); if (existsSync(path))
            unlinkSync(path); },
        pin(input) {
            const claims = mutate(input);
            bounded(input.referenceId);
            const entry = records.get(input.id);
            const delegation = delegatedCallers.get(input.caller) ?? [...(incomingReturns.get(input.caller) ?? [])].find(grant => grant.revisions.has(input.id));
            if (delegation) {
                authorize(input.caller, input.id, delegation.destination);
                if (input.referenceId !== `session:${claims.sessionId}`)
                    deny();
            }
            else if (!entry || !same(entry.claims, claims))
                deny();
            if (!entry || entry.tombstone || !entry.ref.contentHash)
                deny();
            if (!entry.pins.includes(input.referenceId)) {
                entry.pins.push(input.referenceId);
                try {
                    persist(entry);
                }
                catch (error) {
                    entry.pins.pop();
                    throw error;
                }
            }
        },
        unpin(input) { const claims = mutate(input); const entry = records.get(input.id); if (!entry || !same(entry.claims, claims))
            deny(); entry.pins = entry.pins.filter(value => value !== input.referenceId); persist(entry); },
        endSession(input) { const claims = mutate(input); for (const entry of records.values())
            if (same(entry.claims, claims)) {
                entry.endedAt ??= now();
                persist(entry);
            } reclaim(); },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            invalidate();
            // If this final marker itself fails, all preceding archive writes were
            // already confirmed. Never attempt it after any earlier uncertain write.
            if (!durabilityTainted) {
                try {
                    persistAuthority(true);
                }
                catch { /* Keep the durable dirty marker when possible. */ }
            }
            for (const capture of active) {
                capture.chunks = [];
                capture.bytes = 0;
            }
            for (const timer of delegationTimers)
                clearTimeout(timer);
            delegationTimers.clear();
            for (const bound of incarnations.values())
                bound.unsubscribe();
            incarnations.clear();
            active.clear();
            policies.clear();
            dependencies.clear();
            listeners.clear();
            owners.delete(root);
            lock.close();
        },
    };
}
