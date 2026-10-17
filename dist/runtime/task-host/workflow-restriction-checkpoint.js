import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
const ports = new WeakMap();
const checkpoints = new WeakMap();
const registryBindings = new WeakMap();
function denied() { throw Error('workflow_stored_restrictions_denied'); }
/** Concrete fixed HTTP reader only. This does not attest a Main instance or mint a grant. */
export function createNativeWorkflowReadPort() {
    if (arguments.length !== 0)
        denied();
    const port = Object.freeze(Object.create(null));
    ports.set(port, { closed: false, pending: new Set(), controllers: new Set() });
    return port;
}
export function closeNativeWorkflowReadPort(port) {
    const entry = ports.get(port);
    if (!entry)
        denied();
    if (entry.drain)
        return entry.drain;
    let resolveDrain;
    entry.drain = new Promise(resolve => { resolveDrain = resolve; });
    entry.closed = true;
    const pending = [...entry.pending];
    for (const controller of entry.controllers)
        controller.abort();
    void Promise.allSettled(pending).then(() => resolveDrain());
    return entry.drain;
}
export function assertNativeWorkflowReadPort(port) { const entry = ports.get(port); if (!entry || entry.closed)
    denied(); }
function record(value) { if (!value || typeof value !== 'object' || Array.isArray(value))
    denied(); return value; }
function str(value) { if (typeof value !== 'string' || !value || value.length > 4096)
    denied(); return value; }
async function get(port, path) {
    assertNativeWorkflowReadPort(port);
    if (!/^\/projects\/[^/]+(?:\/workflows\/[^/]+)?$/.test(path))
        denied();
    const entry = ports.get(port);
    const controller = new AbortController();
    entry.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 30_000);
    const task = Promise.resolve().then(async () => {
        let response;
        let lastError;
        for (const base of ['http://127.0.0.1:4400', 'http://localhost:4400']) {
            assertNativeWorkflowReadPort(port);
            controller.signal.throwIfAborted();
            try {
                response = await fetch(base + path, { method: 'GET', redirect: 'error', signal: controller.signal });
                break;
            }
            catch (error) {
                lastError = error;
                assertNativeWorkflowReadPort(port);
                controller.signal.throwIfAborted();
            }
        }
        assertNativeWorkflowReadPort(port);
        controller.signal.throwIfAborted();
        if (!response)
            throw lastError;
        if (!response.ok || response.redirected)
            denied();
        const value = record(await response.json());
        assertNativeWorkflowReadPort(port);
        controller.signal.throwIfAborted();
        return value;
    });
    entry.pending.add(task);
    try {
        return await task;
    }
    finally {
        clearTimeout(timer);
        entry.controllers.delete(controller);
        entry.pending.delete(task);
    }
}
function categories(value) { if (value === null || value === undefined)
    return null; const permission = record(value); if (permission.toolCategories === undefined)
    return null; if (!Array.isArray(permission.toolCategories) || permission.toolCategories.some((x) => typeof x !== 'string'))
    denied(); return [...new Set(permission.toolCategories)].sort(); }
function restriction(value) {
    if (value === null || value === undefined)
        return { readonly: false, requiresReadonlyOrSuccessor: false };
    const permission = record(value);
    const booleans = ['allowWrite', 'allowShell', 'allowNetwork', 'allowRenderer'];
    const allowed = new Set([...booleans, 'toolCategories', 'deniedCommandIds', 'deniedCommands']);
    if (Object.keys(permission).some(key => !allowed.has(key)))
        denied();
    for (const key of booleans)
        if (permission[key] !== undefined && typeof permission[key] !== 'boolean')
            denied();
    const kinds = categories(permission);
    const readOnlyCategory = kinds?.length === 1 && kinds[0] === 'read_project_state';
    const legacyWriteCategory = kinds?.length === 2 && kinds[0] === 'read_project_state' && kinds[1] === 'write_artifact';
    if (kinds && !readOnlyCategory && !legacyWriteCategory)
        denied();
    for (const key of ['deniedCommandIds', 'deniedCommands'])
        if (permission[key] !== undefined && (!Array.isArray(permission[key]) || permission[key].some((item) => typeof item !== 'string')))
            denied();
    const readonly = !!readOnlyCategory || booleans.every(key => permission[key] === false);
    // Mixed restrictive policies require the artifact-only/fine-grained successor.
    // Until that exists, never silently leave an explicitly denied capability live.
    return { readonly, requiresReadonlyOrSuccessor: booleans.some(key => permission[key] === false) || ['deniedCommandIds', 'deniedCommands'].some(key => permission[key]?.length) };
}
const builtinWorkflowSources = Object.freeze({ builtin: 'project-diagnose', 'builtin-smoke': 'agent-review-smoke', po_generated: 'po-generated-task-workflow', po_generated_project: 'po-generated-project-workflow' });
async function facts(port, binding) {
    const project = await get(port, `/projects/${encodeURIComponent(binding.projectId)}`);
    const projectData = record(project.project), workspace = record(project.workspace);
    if (projectData.id !== binding.projectId)
        denied();
    const root = realpathSync(str(workspace.path));
    if (projectData.workFolder !== undefined && projectData.workFolder !== null && realpathSync(str(projectData.workFolder)) !== root)
        denied();
    if (binding.admittedRoot && realpathSync(binding.admittedRoot) !== root)
        denied();
    const result = await get(port, `/projects/${encodeURIComponent(binding.projectId)}/workflows/${encodeURIComponent(binding.workflowRunId)}`);
    const run = record(result.workflowRun);
    if (run.id !== binding.workflowRunId || run.projectId !== binding.projectId || run.workflowId !== binding.workflowId || run.status !== 'running' || !Array.isArray(run.nodes))
        denied();
    const matches = run.nodes.filter((node) => node?.id === binding.nodeId);
    if (matches.length !== 1)
        denied();
    const node = record(matches[0]), runtime = record(node.runtime);
    if (node.kind !== binding.nodeKind || node.status !== 'running' || node.attempt !== binding.attempt || !Number.isSafeInteger(node.attempt) || node.attempt < 1 || runtime.runId !== run.id || runtime.handoffId !== binding.handoffId || runtime.participantId !== binding.participantId || node.assignedAgent !== binding.participantId)
        denied();
    let nodePermission;
    let specPermission = null;
    let specNodePermission = null;
    let sourceIdentity;
    if (run.source === 'script_generated') {
        if (run.spec !== null || typeof run.scriptSource !== 'string' || !run.scriptSource.trim() || typeof run.scriptHash !== 'string' || !/^[a-f0-9]{64}$/.test(run.scriptHash))
            denied();
        const source = run.scriptSource.trim().replace(/^```(?:js|javascript)?\s*\n([\s\S]*?)\n```$/i, (_all, body) => body.trim());
        if (createHash('sha256').update(source).digest('hex') !== run.scriptHash)
            denied();
        const meta = record(run.scriptMeta), input = record(node.input), script = record(input.script);
        if (meta.name !== run.workflowId || script.workflowId !== run.workflowId || script.workflowRunId !== run.id || script.scriptHash !== run.scriptHash || script.nodeId !== node.id)
            denied();
        nodePermission = input.permissions;
        sourceIdentity = { source: run.source, scriptHash: run.scriptHash, meta };
    }
    else if (Object.hasOwn(builtinWorkflowSources, run.source) && builtinWorkflowSources[run.source] === run.workflowId) {
        const spec = record(run.spec);
        if (spec.id !== run.workflowId || !Array.isArray(spec.phases))
            denied();
        const nodes = spec.phases.flatMap((phase) => Array.isArray(phase?.nodes) ? phase.nodes : []).filter((candidate) => candidate?.id === node.id);
        if (nodes.length !== 1)
            denied();
        const specNode = record(nodes[0]);
        if ((specNode.kind === 'agent' ? 'agent_task' : specNode.kind) !== node.kind)
            denied();
        specPermission = spec.permissions;
        specNodePermission = specNode.permissions;
        nodePermission = node.permissions;
        sourceIdentity = { source: run.source, specId: spec.id, specNodeKind: specNode.kind };
    }
    else
        denied();
    const restrictions = [run.permissions, specPermission, specNodePermission, nodePermission].map(restriction);
    const readonly = node.kind === 'review' || restrictions.some(value => value.readonly);
    if (!readonly && restrictions.some(value => value.requiresReadonlyOrSuccessor))
        denied();
    const fingerprint = createHash('sha256').update(JSON.stringify({ binding, root, sourceIdentity, permissions: [run.permissions ?? null, specPermission ?? null, specNodePermission ?? null, nodePermission ?? null], assignedAgent: node.assignedAgent, participantId: runtime.participantId })).digest('hex');
    return { root, readonly, fingerprint };
}
export async function createNativeWorkflowRestrictionCheckpoint(port, input) { assertNativeWorkflowReadPort(port); const binding = Object.freeze({ ...input }); for (const key of ['projectId', 'workflowRunId', 'workflowId', 'nodeId', 'nodeKind', 'handoffId', 'participantId'])
    str(binding[key]); if (!Number.isSafeInteger(binding.attempt) || binding.attempt < 1)
    denied(); const current = await facts(port, binding); const checkpoint = Object.freeze(Object.create(null)); checkpoints.set(checkpoint, { port, binding, ...current }); return { checkpoint, readonly: current.readonly, root: current.root }; }
export function bindNativeWorkflowRestrictionCheckpoint(registry, checkpoint) { if (!checkpoints.has(checkpoint) || registryBindings.has(registry))
    denied(); registryBindings.set(registry, checkpoint); }
export async function assertNativeRegistryCheckpointCurrent(registry) { const checkpoint = registryBindings.get(registry); if (!checkpoint)
    return; const stored = checkpoints.get(checkpoint); if (!stored)
    denied(); const current = await facts(stored.port, stored.binding); if (current.fingerprint !== stored.fingerprint || current.readonly !== stored.readonly || current.root !== stored.root)
    denied(); }
