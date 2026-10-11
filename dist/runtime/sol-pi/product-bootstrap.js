import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, lstatSync, realpathSync, readdirSync, existsSync, openSync, closeSync, fstatSync, constants } from 'node:fs';
import { homedir, version as osVersion } from 'node:os';
import { join, resolve, isAbsolute, normalize, dirname } from 'node:path';
import { resolveRuntimeModelBinding } from '../../ai/providers/control-plane.js';
import { MULTI_AGENT_TOOL_NAMES, CHILD_COMMUNICATION_TOOL_NAMES } from '../../ai/tools/multi-agent.js';
import { freezeDeepSeekRecipeCounter } from './deepseek-capacity-profile.js';
import { resolveProductionCapacityProfile } from './capacity-admission.js';
import { validateSemanticPolicy } from './semantic-policy.js';
import { reserveCompoundDomainBytes } from './compound-domain-budget.js';
import { reserveSessionAliasBytes } from '../../ai/runtime/session-store/aliases.js';
import { assertCompoundHostStorage, inspectCompoundHostSources } from './compound-host-storage.js';
import { openCompoundExecutionDomain } from './compound-execution-domain.js';
import { validateOrdinaryChildrenPolicy } from './delegation-policy.js';
import { isRegisteredRecipeManifest, selectRecipeManifestPath } from './recipe-environment-registration.js';
const policies = new WeakMap();
const ENVIRONMENT_ID = 'deepseek-recipe-0.1.1';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function deny(reason) { throw new Error(`SOL_PI_PRODUCT_${reason}`); }
function keys(value, allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)))
        deny('INVALID_POLICY');
}
function text(value, max = 4096) {
    if (typeof value !== 'string' || !value || value.length > max || /[\x00-\x1f\x7f]/.test(value))
        deny('INVALID_POLICY');
}
function line(value) { return Number.isSafeInteger(value) && Number(value) > 0; }
function readJsonFile(file, maxBytes) {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes)
        deny('UNSAFE_FILE');
    const bytes = readFileSync(file);
    if (bytes.length > maxBytes)
        deny('UNSAFE_FILE');
    const parsed = JSON.parse(bytes.toString('utf8'));
    // JSON.parse validates syntax; this second pass rejects ambiguous duplicate keys.
    const frames = [];
    for (const token of bytes.toString('utf8').match(/"(?:[^"\\]|\\.)*"|[{}\[\],:]|[^\s{}\[\],:]+/g) ?? []) {
        if (token === '{')
            frames.push({ keys: new Set(), expectingKey: true });
        else if (token === '[')
            frames.push({ expectingKey: false });
        else if (token === '}' || token === ']')
            frames.pop();
        else if (token === ',') {
            const frame = frames.at(-1);
            if (frame?.keys)
                frame.expectingKey = true;
        }
        else if (token.startsWith('"')) {
            const frame = frames.at(-1);
            if (frame?.keys && frame.expectingKey) {
                const key = JSON.parse(token);
                if (frame.keys.has(key))
                    deny('DUPLICATE_KEY');
                frame.keys.add(key);
                frame.expectingKey = false;
            }
        }
    }
    return { bytes, parsed };
}
function policyOf(value) {
    const policy = value && policies.get(value);
    if (!policy || policy.expiresAt <= Date.now())
        deny('POLICY_EXPIRED_OR_UNTRUSTED');
    return policy;
}
/** Explicit user CLI file only. Never discover this file from a project or model input. */
export function parseObservationPolicyFile(file) {
    const { parsed: input } = readJsonFile(file, 65536);
    keys(input, ['version', 'environmentId', 'model', 'destination', 'localPersistence', 'allowUnclassifiedText', 'allowModelDisclosure', 'allowIncomplete', 'expiresAt', 'readFileScopes', 'bashSources', 'semanticCompaction', 'compoundExecution', 'ordinaryChildren']);
    if (input.version !== 1 || input.environmentId !== ENVIRONMENT_ID || input.model !== 'deepseek-flash'
        || input.localPersistence !== true || input.allowUnclassifiedText !== true || input.allowModelDisclosure !== true || input.allowIncomplete !== false
        || !Number.isSafeInteger(input.expiresAt) || Number(input.expiresAt) <= Date.now() || Number(input.expiresAt) > Date.now() + 7 * 86400000)
        deny('CONSENT_OR_EXPIRY_NOT_READY');
    keys(input.destination, ['provider', 'url']);
    text(input.destination.provider, 256);
    if (!['https://api.deepseek.com/chat/completions', 'https://api.deepseek.com/v1/chat/completions'].includes(String(input.destination.url)))
        deny('DESTINATION_NOT_READY');
    if (!Array.isArray(input.readFileScopes) || !Array.isArray(input.bashSources) || input.readFileScopes.length + input.bashSources.length < 1 || input.readFileScopes.length > 128 || input.bashSources.length > 64)
        deny('INVALID_SOURCES');
    for (const scope of input.readFileScopes) {
        keys(scope, ['filePath', 'startLine', 'endLine']);
        text(scope.filePath);
        if (!isAbsolute(scope.filePath) || normalize(scope.filePath) !== scope.filePath || /[*?\[\]{}]/.test(scope.filePath) || !line(scope.startLine) || scope.endLine !== undefined && (!line(scope.endLine) || scope.endLine < Number(scope.startLine)))
            deny('INVALID_READ_SCOPE');
        const stat = lstatSync(scope.filePath);
        if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(scope.filePath) !== scope.filePath)
            deny('INVALID_READ_SCOPE');
    }
    for (const source of input.bashSources) {
        keys(source, ['command', 'cwd']);
        text(source.command, 8192);
        text(source.cwd);
        if (!isAbsolute(source.cwd) || normalize(source.cwd) !== source.cwd || !lstatSync(source.cwd).isDirectory() || lstatSync(source.cwd).isSymbolicLink() || realpathSync(source.cwd) !== source.cwd)
            deny('INVALID_BASH_SCOPE');
    }
    const token = Object.freeze(Object.create(null));
    const policy = structuredClone(input);
    if (Object.hasOwn(input, 'ordinaryChildren'))
        policy.ordinaryChildren = validateOrdinaryChildrenPolicy(input.ordinaryChildren, Date.now(), Number(input.expiresAt));
    if (Object.hasOwn(input, 'semanticCompaction'))
        policy.semanticCompaction = validateSemanticPolicy(input.semanticCompaction, Date.now(), Number(input.expiresAt));
    if (Object.hasOwn(input, 'compoundExecution')) {
        keys(input.compoundExecution, ['version', 'mode']);
        if (input.compoundExecution.version !== 1 || input.compoundExecution.mode !== 'mechanism-experiment')
            deny('INVALID_COMPOUND_POLICY');
    }
    policies.set(token, policy);
    return token;
}
/** Select the formal model only for this live session. Never persist configuration. */
export function prepareObservationConfig(config, approved) {
    const policy = policyOf(approved);
    const copy = structuredClone(config), id = copy.defaultModelId;
    if (!copy.models?.[id])
        deny('MODEL_NOT_READY');
    copy.models[id].model = policy.model;
    const binding = resolveRuntimeModelBinding(copy);
    if (binding.protocol !== 'openai_legacy' || binding.providerId !== policy.destination.provider
        || `${binding.baseUrl?.replace(/\/$/, '')}/chat/completions` !== policy.destination.url || binding.wireModel !== policy.model)
        deny('CONFIG_DESTINATION_MISMATCH');
    return copy;
}
/** Main-owned review display of the already parsed user grant; never rereads a file. */
export function describeProductObservationPolicy(approved) {
    const policy = policyOf(approved);
    return Object.freeze({ model: policy.model, destination: Object.freeze({ ...policy.destination }), expiresAt: policy.expiresAt,
        ordinaryChildren: policy.ordinaryChildren && Object.freeze({ ...policy.ordinaryChildren, nativeTools: Object.freeze([...policy.ordinaryChildren.nativeTools]) }),
        compoundExecution: policy.compoundExecution && Object.freeze({ ...policy.compoundExecution }),
        semanticCompaction: policy.semanticCompaction && Object.freeze({ ...policy.semanticCompaction, pricing: Object.freeze({ ...policy.semanticCompaction.pricing }) }),
        readFileScopes: Object.freeze(policy.readFileScopes.map(scope => Object.freeze({ ...scope }))),
        bashSources: Object.freeze(policy.bashSources.map(source => Object.freeze({ ...source }))),
        localPersistence: policy.localPersistence, allowUnclassifiedText: policy.allowUnclassifiedText, allowModelDisclosure: policy.allowModelDisclosure });
}
function trustedEnvironment(root) {
    const registered = join(homedir(), '.cache', 'xiaok', 'sol-pi', ENVIRONMENT_ID);
    if (resolve(root) !== registered || realpathSync(root) !== registered)
        deny('ENVIRONMENT_NOT_REGISTERED');
    for (const file of [root, join(root, 'environment.json')]) {
        const stat = lstatSync(file);
        if (stat.isSymbolicLink() || stat.uid !== process.getuid?.() || stat.mode & 0o022)
            deny('ENVIRONMENT_PERMISSIONS');
    }
    const selected = selectRecipeManifestPath(root), selectedStat = lstatSync(selected);
    if (selectedStat.isSymbolicLink() || selectedStat.uid !== process.getuid?.() || selectedStat.mode & 0o022)
        deny('ENVIRONMENT_PERMISSIONS');
    const rootFd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
        const rootIdentity = fstatSync(rootFd);
        const manifestFile = readJsonFile(selected, 2 * 1024 * 1024);
        const selectedDigest = digest(manifestFile.bytes);
        const manifest = manifestFile.parsed;
        if (!isRegisteredRecipeManifest(selectedDigest, manifest.sha256) || manifest.platform !== `${process.platform}-${process.arch}` || manifest.osVersion !== osVersion())
            deny('ENVIRONMENT_MANIFEST');
        const environment = readJsonFile(join(root, 'environment.json'), 65536).parsed;
        keys(environment, ['pythonExecutable', 'sitePackages', 'tokenizerPath', 'wheelPath']);
        for (const key of ['pythonExecutable', 'sitePackages', 'tokenizerPath', 'wheelPath'])
            if (environment[key] !== manifest[key])
                deny('ENVIRONMENT_BINDING');
        // Trusted external registration must be checked BEFORE the factory can spawn Python.
        for (const entry of manifest.files) {
            const stat = lstatSync(entry.path);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o022 || realpathSync(entry.path) !== entry.path || digest(readFileSync(entry.path)) !== entry.sha256)
                deny('ENVIRONMENT_DRIFT');
        }
        for (const entry of manifest.directories)
            if (lstatSync(entry.path).isSymbolicLink() || JSON.stringify(readdirSync(entry.path).sort()) !== JSON.stringify(entry.names))
                deny('ENVIRONMENT_DRIFT');
        for (const entry of manifest.links)
            if (realpathSync(entry.path) !== entry.target)
                deny('ENVIRONMENT_DRIFT');
        for (const path of manifest.absentPaths)
            if (existsSync(path))
                deny('ENVIRONMENT_DRIFT');
        const assertCurrent = () => {
            const held = fstatSync(rootFd), actual = lstatSync(root);
            if (!held.isDirectory() || !actual.isDirectory() || actual.isSymbolicLink() || realpathSync(root) !== registered
                || held.dev !== rootIdentity.dev || held.ino !== rootIdentity.ino || held.uid !== rootIdentity.uid || held.mode !== rootIdentity.mode
                || actual.dev !== held.dev || actual.ino !== held.ino || actual.uid !== held.uid || actual.mode !== held.mode
                || held.uid !== process.getuid?.() || held.mode & 0o022)
                deny('ENVIRONMENT_CHANGED');
            if (selectRecipeManifestPath(root) !== selected)
                deny('ENVIRONMENT_CHANGED');
            const stat = lstatSync(selected);
            if (stat.isSymbolicLink() || stat.uid !== process.getuid?.() || stat.mode & 0o022
                || digest(readJsonFile(selected, 2 * 1024 * 1024).bytes) !== selectedDigest)
                deny('ENVIRONMENT_CHANGED');
        };
        assertCurrent();
        return { environment: environment, manifest, assertCurrent, close() { closeSync(rootFd); } };
    }
    catch (error) {
        closeSync(rootFd);
        throw error;
    }
}
function reserveAllCounters(profileRoot, sessionKey, admitNewOwner = true) {
    const parent = join(profileRoot, 'counters');
    const directories = new Set();
    if (existsSync(parent)) {
        if (!lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink())
            deny('COUNTER_ROOT_UNSAFE');
        for (const name of readdirSync(parent)) {
            const directory = join(parent, name);
            if (!/^[a-f0-9]{64}$/.test(name) || !lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
                deny('COUNTER_ROOT_UNSAFE');
            let bytes = 0;
            for (const file of readdirSync(directory)) {
                const stat = lstatSync(join(directory, file));
                if (!['full-send.json', 'owner.sqlite', 'owner.sqlite-journal'].includes(file) || !stat.isFile() || stat.isSymbolicLink())
                    deny('COUNTER_ROOT_UNSAFE');
                bytes += stat.size;
            }
            if (bytes > 4 * 1024 * 1024)
                deny('COUNTER_QUOTA');
            directories.add(name);
        }
    }
    if (admitNewOwner && sessionKey && !directories.has(sessionKey) && directories.size >= 64)
        deny('COUNTER_QUOTA');
    if (sessionKey)
        directories.add(sessionKey);
    const bytes = directories.size * 4 * 1024 * 1024;
    if (bytes >= 2 * 1024 * 1024 * 1024)
        deny('COUNTER_QUOTA');
    return { bytes, owners: [...directories].sort().join(',') };
}
export async function createProductObservationOwner(input) {
    if (process.platform !== 'darwin' || process.arch !== 'arm64')
        deny('PLATFORM_NOT_READY');
    input = { ...input, hostCwd: input.hostCwd ?? process.cwd() };
    const policy = policyOf(input.policy);
    if ((policy.semanticCompaction || policy.compoundExecution) && (!input.executionPersistence?.store.compareAndSave || !input.executionPersistence.store.onCommit))
        deny(policy.semanticCompaction ? 'SEMANTIC_PERSISTENCE_REQUIRED' : 'COMPOUND_PERSISTENCE_REQUIRED');
    if (input.compoundStorage) {
        const layout = assertCompoundHostStorage(input.compoundStorage);
        if (!policy.compoundExecution || resolve(dirname(input.profileRoot)) !== layout.configRoot || resolve(input.executionPersistence.root) !== layout.canonicalRoot)
            deny('COMPOUND_CANONICAL_ROOT_MISMATCH');
    }
    const initialSessionId = input.session.exportSnapshot().sessionId;
    const initialRestoreGeneration = input.session.getObservationRestoreGeneration();
    if (input.session.getProtectedObservationClosure() || input.session.getMessages().length)
        deny('FRESH_SESSION_REQUIRED');
    if (!Array.isArray(input.credentialSecrets) || input.credentialSecrets.length > 256 || input.credentialSecrets.some(secret => typeof secret !== 'string' || secret.length > 65536))
        deny('INVALID_REDACTOR_SECRETS');
    const secrets = [...new Set(input.credentialSecrets.filter(Boolean))].sort((a, b) => b.length - a.length);
    const secretPattern = secrets.length ? new RegExp(secrets.map(secret => secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g') : undefined;
    const redactor = { version: `known-literal-v1:${randomUUID()}`, redact: (value) => secretPattern ? value.replace(secretPattern, '[REDACTED]') : value };
    const verified = trustedEnvironment(input.environmentRoot);
    try {
        verified.assertCurrent();
        const counterCapability = freezeDeepSeekRecipeCounter({ ...verified.environment, environmentManifest: verified.manifest });
        verified.assertCurrent();
        const destination = { ...policy.destination, model: policy.model };
        const capacityProfile = resolveProductionCapacityProfile({ destination: destination.url, model: destination.model, protocol: 'openai_legacy', profileId: 'generic-openai', counter: counterCapability });
        if (!capacityProfile)
            deny('CAPACITY_NOT_READY');
        // Native imports follow the platform and host deployment qualification gates.
        const [{ createObservationService }, { createFullSendCounter }, { createObservationSessionOwner, createObservationReadTool, describeObservationSource, getObservationSessionOwnerHostBinding }, { createProfileDisclosureLedger }, { createDelegatedObservationExecutionPlan }] = await Promise.all([
            import('./observation-service.js'), import('./full-send-counter.js'), import('./observation-session-owner.js'), import('./profile-disclosure-ledger.js'), import('./delegated-session-owner.js')
        ]);
        policyOf(input.policy);
        if (input.session.getProtectedObservationClosure() || input.session.getMessages().length
            || input.session.exportSnapshot().sessionId !== initialSessionId || input.session.getObservationRestoreGeneration() !== initialRestoreGeneration)
            deny('FRESH_SESSION_REQUIRED');
        const revision = input.permissionManager.getRevision();
        if (!Number.isSafeInteger(revision) || revision < 0)
            deny('INVALID_PERMISSION_REVISION');
        const sessionId = input.session.exportSnapshot().sessionId, generation = randomUUID();
        if (!sessionId || sessionId === 'transient')
            deny('PERSISTENT_SESSION_ID_REQUIRED');
        const sessionKey = digest(sessionId);
        const { ReferenceDeletionReceiptStore, REFERENCE_LIFECYCLE_RESERVED_BYTES } = await import('./reference-lifecycle.js');
        const counterInventory = reserveAllCounters(input.profileRoot, sessionKey);
        const reservedProfileBytes = counterInventory.bytes + REFERENCE_LIFECYCLE_RESERVED_BYTES + reserveCompoundDomainBytes(input.profileRoot, !!policy.compoundExecution) + reserveSessionAliasBytes(join(dirname(input.profileRoot), 'compound-sessions'), !!policy.compoundExecution);
        const receiptStore = new ReferenceDeletionReceiptStore(input.profileRoot);
        let service;
        try {
            service = createObservationService({ profileRoot: input.profileRoot, profileId: 'product-sol-pi-v1', reservedProfileBytes, redactor, resolveReferenceOwner: facts => receiptStore.resolve(facts) });
        }
        catch (error) {
            receiptStore.close();
            throw error;
        }
        let counter;
        let disclosureLedger;
        let owner;
        let unsubscribe;
        let disposed = false;
        let expiryTimer;
        let executionAuthority;
        let semanticCompactionOwner;
        let disposal;
        let compoundDomain;
        const executionAbort = new AbortController();
        let unsubscribeExecution;
        try {
            // The actual observation service owns its cross-process profile lock now.
            const lockedInventory = reserveAllCounters(input.profileRoot, sessionKey, false);
            if (lockedInventory.bytes !== counterInventory.bytes || lockedInventory.owners !== counterInventory.owners)
                deny('COUNTER_INVENTORY_CHANGED');
            const claims = { sessionId, ownerAgentId: generation, scopeId: generation, permissionGeneration: revision, surface: 'ordinary-owner' };
            const user = service.bindCaller({ ...claims, requestSource: 'user' }), caller = service.bindCaller({ ...claims, requestSource: 'agent' });
            const base = { version: 1, revision: 1, scopeId: generation, expiresAt: policy.expiresAt, localPersistence: true, allowUnclassifiedText: true, allowIncomplete: false, destinations: [destination] };
            if (policy.readFileScopes.length)
                service.setArchivePolicy({ caller: user, requestSource: 'user', policy: { ...base, id: `${generation}:read`, sourceAdapterId: 'native.read.v1', sourceDescriptors: [], readFileScopes: policy.readFileScopes } });
            const hostCwd = realpathSync(input.hostCwd ?? process.cwd());
            const sourceDescriptors = policy.bashSources.flatMap(source => [source.cwd, ...(source.cwd === hostCwd ? ['.'] : [])].map(workdir => describeObservationSource({ toolName: 'bash', source: { command: source.command, workdir } })));
            if (sourceDescriptors.length)
                service.setArchivePolicy({ caller: user, requestSource: 'user', policy: { ...base, id: `${generation}:bash`, sourceAdapterId: 'native.bash.v1', sourceDescriptors } });
            let revoked = false;
            const revoke = () => { if (!revoked) {
                revoked = true;
                executionAbort.abort(new DOMException('Execution policy revoked', 'AbortError'));
                void semanticCompactionOwner?.dispose();
                service.revokeCaller({ caller: user, requestSource: 'user', target: caller });
            } };
            unsubscribe = input.permissionManager.onRevisionChanged(revoke);
            const authorityPort = { ...service.transportPort, validate: (...args) => {
                    if (Date.now() >= policy.expiresAt) {
                        revoke();
                        deny('POLICY_EXPIRED');
                    }
                    if (input.permissionManager.getRevision() !== revision) {
                        revoke();
                        deny('PERMISSION_CHANGED');
                    }
                    service.transportPort.validate(...args);
                } };
            const guardedService = new Proxy(service, { get(target, property) {
                    if (property === 'transportPort')
                        return authorityPort;
                    if (property === 'begin')
                        return (capture) => {
                            const source = JSON.parse(capture.sourceDescriptor);
                            if (capture.sourceAdapterId === 'native.read.v1') {
                                if (typeof source.filePath !== 'string')
                                    deny('READ_SOURCE_CHANGED');
                                const stat = lstatSync(source.filePath);
                                if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(source.filePath) !== source.filePath)
                                    deny('READ_SOURCE_CHANGED');
                            }
                            if (capture.sourceAdapterId === 'native.bash.v1' && source.workdir === '.' && realpathSync(process.cwd()) !== hostCwd)
                                deny('BASH_CWD_CHANGED');
                            return target.begin(capture);
                        };
                    return Reflect.get(target, property);
                } });
            counter = createFullSendCounter({ root: join(input.profileRoot, 'counters', sessionKey), sessionId });
            if (policy.ordinaryChildren)
                disclosureLedger = createProfileDisclosureLedger({ service: guardedService, counter });
            const rootCounter = disclosureLedger?.createAccount({ requestSource: 'user', caller, sessionId, destination }) ?? counter;
            owner = createObservationSessionOwner({ service: guardedService, caller, session: input.session, destination, capacityProfile, fullSendCounter: rootCounter, persist: input.persist });
            const childPolicy = policy.ordinaryChildren;
            const childApproval = childPolicy && service.approveDelegation({ requestSource: 'user', caller: user, destination,
                maxDepth: childPolicy.maxDepth, maxChildren: childPolicy.maxChildren, expiresAt: childPolicy.expiresAt,
                sourcePolicyIds: [...(childPolicy.nativeTools.includes('read') && policy.readFileScopes.length ? [`${generation}:read`] : []),
                    ...(childPolicy.nativeTools.includes('bash') && sourceDescriptors.length ? [`${generation}:bash`] : [])] });
            if (input.permissionManager.getRevision() !== revision) {
                revoke();
                deny('PERMISSION_CHANGED');
            }
            const liveOwner = owner, liveCounter = counter;
            if (policy.semanticCompaction || policy.compoundExecution) {
                const { createSessionExecutionAuthority, createSessionExecutionContext } = await import('../../ai/runtime/session-store/execution-authority.js');
                executionAuthority = createSessionExecutionAuthority({ root: input.executionPersistence.root, sessionIdentity: sessionId,
                    hostContext: createSessionExecutionContext({ requestSource: 'user', ownerId: generation, scopeId: generation }) });
                const { createSemanticCompactionOwner } = await import('./semantic-compaction-owner.js');
                semanticCompactionOwner = createSemanticCompactionOwner({ policy: input.policy, session: input.session, observationOwner: liveOwner,
                    store: input.executionPersistence.store, authority: executionAuthority, capacityProfile });
                if (!semanticCompactionOwner)
                    unsubscribeExecution = input.executionPersistence.store.onCommit(snapshot => { if (snapshot.sessionId === sessionId)
                        input.session.updatePersistenceFacts(snapshot); });
                if (input.executionPersistence.initialize || input.compoundStorage) {
                    const lease = await executionAuthority.acquire({ invocationId: `initialize:${generation}`, kind: 'recovery' });
                    try {
                        if (input.compoundStorage)
                            compoundDomain = openCompoundExecutionDomain({ owner: liveOwner, storeRoot: input.executionPersistence.root, lease,
                                inventory: inspectCompoundHostSources(input.compoundStorage) });
                        await input.executionPersistence.initialize?.(input.session.exportSnapshot(), lease);
                    }
                    finally {
                        await lease.releaseAfterDrain();
                    }
                }
            }
            if (Date.now() >= policy.expiresAt) {
                revoke();
                deny('POLICY_EXPIRED');
            }
            if (revoked || input.permissionManager.getRevision() !== revision) {
                revoke();
                deny('PERMISSION_CHANGED');
            }
            verified.assertCurrent();
            expiryTimer = setTimeout(() => {
                try {
                    revoke();
                }
                catch {
                    liveOwner.dispose();
                }
            }, policy.expiresAt - Date.now());
            expiryTimer.unref();
            return Object.freeze({ owner: liveOwner, semanticCompactionOwner, compoundDomain, executionAuthority, executionSignal: executionAbort.signal, recallTool: createObservationReadTool(liveOwner), summary: Object.freeze({ ordinaryChildren: childPolicy && Object.freeze({ ...childPolicy, nativeTools: Object.freeze([...childPolicy.nativeTools]) }), environmentId: ENVIRONMENT_ID, model: policy.model, destination: Object.freeze(destination), expiresAt: policy.expiresAt, semanticCompaction: policy.semanticCompaction, compoundExecution: policy.compoundExecution && Object.freeze({ ...policy.compoundExecution }), readFileScopes: structuredClone(policy.readFileScopes), exactBashSources: policy.bashSources.length, toolSurface: 'native-only', redactorVersion: redactor.version, storageBudget: service.getStorageBudget() }),
                createChildExecutionPlan(child) {
                    if (child.surface !== undefined && child.surface !== 'cli' && child.surface !== 'desktop-managed')
                        deny('CHILD_SURFACE_UNSUPPORTED');
                    if (disposed || revoked || !childPolicy || !childApproval || !disclosureLedger || input.permissionManager.getRevision() !== revision)
                        deny('CHILDREN_NOT_AUTHORIZED');
                    const parentOwner = child.parentOwner ?? liveOwner;
                    const parent = getObservationSessionOwnerHostBinding(parentOwner);
                    if (parent.service !== guardedService || parentOwner.getMode() !== 'active')
                        deny('CHILDREN_NOT_AUTHORIZED');
                    parentOwner.assertSession(parent.session);
                    const childSessionId = child.session.exportSnapshot().sessionId;
                    if (!childSessionId || childSessionId === 'transient' || child.session.getMessages().length || child.session.getProtectedObservationClosure())
                        deny('FRESH_CHILD_REQUIRED');
                    const recipient = service.bindCaller({ sessionId: childSessionId, ownerAgentId: randomUUID(), scopeId: randomUUID(),
                        permissionGeneration: revision, surface: 'ordinary-owner', requestSource: 'agent' });
                    const capability = service.issueDelegationWithApproval({ requestSource: 'agent', caller: parent.caller, approval: childApproval, recipient,
                        observationIds: parent.session.getProtectedObservationClosure()?.observations.map(ref => ref.observationId) ?? [], destination, expiresAt: childPolicy.expiresAt });
                    return createDelegatedObservationExecutionPlan({ parentOwner, service: guardedService, capability, recipient, session: child.session,
                        destination, capacityProfile, disclosureLedger, persist: child.persist, allowedNativeToolNames: [...childPolicy.nativeTools, ...(child.surface === 'desktop-managed'
                                ? childPolicy.maxDepth > 1 ? MULTI_AGENT_TOOL_NAMES : [...CHILD_COMMUNICATION_TOOL_NAMES]
                                : childPolicy.maxDepth > 1 ? ['subagent'] : [])],
                        captureApproval: { approval: childApproval, approver: user }, installChildExecution: child.installChildExecution });
                },
                async prepareMessagePublication(message) {
                    const frozen = Object.freeze({ ...message });
                    const check = () => {
                        if (disposed || revoked || !childPolicy || !childApproval || input.permissionManager.getRevision() !== revision)
                            deny('CHILDREN_NOT_AUTHORIZED');
                        if (getObservationSessionOwnerHostBinding(frozen.sourceOwner).service !== guardedService
                            || getObservationSessionOwnerHostBinding(frozen.recipientOwner).service !== guardedService)
                            deny('CHILDREN_NOT_AUTHORIZED');
                    };
                    check();
                    const { prepareObservationMessagePublication } = await import('./observation-message-publication.js');
                    check();
                    return prepareObservationMessagePublication({ ...frozen, approval: childApproval, assertCurrent() {
                            check();
                            return frozen.assertCurrent();
                        } });
                },
                revoke() { if (!disposed)
                    revoke(); },
                getStatus() {
                    if (!disposed && Date.now() >= policy.expiresAt) {
                        try {
                            revoke();
                        }
                        catch {
                            liveOwner.dispose();
                        }
                    }
                    let ownerMode = 'unavailable';
                    if (!disposed) {
                        try {
                            ownerMode = liveOwner.getMode();
                        }
                        catch { /* Independently disposed owner is unavailable. */ }
                    }
                    return Object.freeze({ revoked: disposed || revoked || ownerMode === 'unavailable' || input.permissionManager.getRevision() !== revision, disposed, ownerMode });
                },
                dispose() {
                    if (disposed)
                        return disposal;
                    disposed = true;
                    executionAbort.abort(new DOMException('Execution owner disposed', 'AbortError'));
                    clearTimeout(expiryTimer);
                    unsubscribe?.();
                    liveOwner.dispose();
                    const close = () => { try {
                        executionAuthority?.dispose();
                        unsubscribeExecution?.();
                    }
                    finally {
                        try {
                            service.endSession({ caller: user, requestSource: 'user' });
                        }
                        finally {
                            try {
                                disclosureLedger?.dispose();
                                liveCounter.dispose();
                            }
                            finally {
                                try {
                                    service.dispose();
                                }
                                finally {
                                    receiptStore.close();
                                }
                            }
                        }
                    } };
                    if (compoundDomain) {
                        disposal = (async () => {
                            await semanticCompactionOwner?.dispose();
                            await compoundDomain.retire({ authority: executionAuthority });
                        })().finally(close);
                        return disposal;
                    }
                    if (semanticCompactionOwner) {
                        disposal = semanticCompactionOwner.dispose().finally(close);
                        return disposal;
                    }
                    close();
                } });
        }
        catch (error) {
            clearTimeout(expiryTimer);
            try {
                unsubscribe?.();
                owner?.dispose();
                await semanticCompactionOwner?.dispose();
                executionAuthority?.dispose();
                unsubscribeExecution?.();
            }
            finally {
                try {
                    disclosureLedger?.dispose();
                    counter?.dispose();
                }
                finally {
                    try {
                        service.dispose();
                    }
                    finally {
                        receiptStore.close();
                    }
                }
            }
            throw error;
        }
    }
    finally {
        verified.close();
    }
}
/** Host deletion/startup event; never opens grants or resumes an observation owner. */
export async function reconcileProductObservationReferences(profileRoot) {
    if (process.platform !== 'darwin' || process.arch !== 'arm64')
        deny('PLATFORM_NOT_READY');
    const [{ createObservationService }, { ReferenceDeletionReceiptStore, REFERENCE_LIFECYCLE_RESERVED_BYTES }] = await Promise.all([import('./observation-service.js'), import('./reference-lifecycle.js')]);
    const receipts = new ReferenceDeletionReceiptStore(profileRoot);
    let service;
    try {
        service = createObservationService({ profileRoot, profileId: 'product-sol-pi-v1', reservedProfileBytes: reserveAllCounters(profileRoot).bytes + REFERENCE_LIFECYCLE_RESERVED_BYTES + reserveCompoundDomainBytes(profileRoot) + reserveSessionAliasBytes(join(dirname(profileRoot), 'compound-sessions')), redactor: { version: 'host-lifecycle-no-capture', redact() { throw new Error('lifecycle_capture_forbidden'); } }, resolveReferenceOwner: facts => receipts.resolve(facts) });
    }
    finally {
        try {
            service?.dispose();
        }
        finally {
            receipts.close();
        }
    }
}
