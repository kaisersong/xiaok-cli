import {afterEach, expect, it, vi} from 'vitest';
import {createServer} from 'node:http';
import {mkdtempSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  assertNativeRegistryCheckpointCurrent, closeNativeWorkflowReadPort,
  createNativeWorkflowArtifactRegistry, createNativeWorkflowReadPort,
  createNativeWorkflowRestrictionCheckpoint, isNativeWorkflowArtifactCheckpoint,
  type NativeWorkflowRestrictionCheckpoint,
} from '../../../src/runtime/task-host/workflow-restriction-checkpoint.js';

const siblingRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)), '..');
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); vi.restoreAllMocks(); });

// A real persisted Hub producer supplies the facts. Only the fixed reader's
// HTTP destination is redirected to this test's own in-process HTTP listener.
async function issued(kind: 'task' | 'project' = 'task') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'po-artifact-control-')));
  const {createHub} = await import(resolve(siblingRoot, 'kswarm/src/core/hub.js'));
  const {initProjectWorkspace} = await import(resolve(siblingRoot, 'kswarm/src/server/project-workspace.js'));
  const hub = createHub({silent: true, eventLogDir: join(root, 'events'), projectStorageRoot: join(root, 'projects'),
    dataDir: {backend: 'sqlite', filePath: join(root, 'state.sqlite'), legacyJsonPath: join(root, 'state.json'), silent: true}});
  let stopServer: (() => Promise<void>) | undefined;
  let stopPort: (() => Promise<void>) | undefined;
  let registry: Awaited<ReturnType<typeof createNativeWorkflowArtifactRegistry>>['registry'] | undefined;
  cleanups.push(async () => {
    registry?.dispose(); await stopPort?.(); await stopServer?.();
    hub.closePersistence(); rmSync(root, {recursive: true, force: true});
  });
  const project = hub.createProject({id: 'po-project', name: 'PO artifact control', goal: 'Produce a report',
    poAgent: 'xiaok-po', members: ['xiaok-worker'], autoAssignPo: false});
  const workspace = initProjectWorkspace(new Map(), join(root, 'projects'), project.id);
  const added = hub.handleHumanAddTasks(project.id, [{id: 'report', title: 'Write final report', assignedAgent: 'xiaok-worker', requiredOutputs: ['markdown']}], {requestSource: 'user'});
  expect(added.ok).toBe(true);
  const workflowId = kind === 'task' ? 'po-generated-task-workflow' : 'po-generated-project-workflow';
  const taskId = added.taskIds[0];
  const proposal = hub.createWorkflowProposal(project.id, workflowId, {requestedBy: 'human', now: 1, ...(kind === 'task' ? {taskId} : {})});
  expect(proposal.ok).toBe(true);
  const started = hub.startWorkflowRunFromProposal(proposal.workflowProposal.id, {approvedBy: 'human', now: 1});
  expect(started.ok).toBe(true);
  const handoff = started.dispatches[0];
  expect(handoff).toBeTruthy();
  const nativeFetch = globalThis.fetch;
  const server = createServer((request, response) => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    response.setHeader('content-type', 'application/json');
    if (path === `/projects/${project.id}`) response.end(JSON.stringify({project: hub.getProject(project.id), workspace}));
    else if (path === `/projects/${project.id}/workflows/${handoff.workflowRunId}`) response.end(JSON.stringify({workflowRun: hub.getWorkflowRun(handoff.workflowRunId)}));
    else { response.statusCode = 404; response.end('{}'); }
  });
  stopServer = () => new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
  await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('owned_listener_missing');
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '4400' || (init?.method ?? 'GET') !== 'GET') throw Error('foreign_fetch_denied');
    return nativeFetch(`http://127.0.0.1:${address.port}${url.pathname}`, init);
  });
  const port = createNativeWorkflowReadPort();
  stopPort = () => closeNativeWorkflowReadPort(port);
  const binding = {
    projectId: project.id, workflowRunId: handoff.workflowRunId, workflowId,
    nodeId: handoff.nodeId, nodeKind: handoff.nodeKind, attempt: handoff.attempt,
    handoffId: handoff.handoffId, participantId: handoff.targetParticipantId || 'xiaok-worker', admittedRoot: workspace.path,
  };
  const captured = await createNativeWorkflowRestrictionCheckpoint(port, binding);
  expect(captured.readonly).toBe(false);
  expect(isNativeWorkflowArtifactCheckpoint(captured.checkpoint)).toBe(true);
  const scope = await createNativeWorkflowArtifactRegistry(captured.checkpoint); registry = scope.registry;
  return {root, hub, workspace, handoff, port, binding, checkpoint: captured.checkpoint, ...scope};
}

it.each(['task', 'project'] as const)('actual %s producer permits real artifact write/edit and project read', async kind => {
  const f = await issued(kind), file = join(f.workspace.artifacts, 'report.md');
  expect(f.registry.getToolDefinitions().map(tool => tool.name).sort()).toEqual(['edit', 'read', 'write']);
  await f.registry.executeTool('write', {file_path: file, content: '# Report'});
  expect(readFileSync(file, 'utf8')).toBe('# Report');
  await f.registry.executeTool('edit', {file_path: file, old_string: 'Report', new_string: 'Verified report'});
  expect(readFileSync(file, 'utf8')).toBe('# Verified report');
  expect(await f.registry.executeTool('read', {file_path: file})).toContain('Verified report');
});

it('denies outside artifacts, shell/network/renderer, caller tools, companions and counterfeit checkpoints', async () => {
  const f = await issued(), outside = join(f.workspace.path, 'source.md'); writeFileSync(outside, 'UNCHANGED');
  expect(await f.registry.executeTool('write', {file_path: outside, content: 'BAD'})).toMatch(/^Error:/);
  expect(await f.registry.executeTool('edit', {file_path: outside, old_string: 'UNCHANGED', new_string: 'BAD'})).toMatch(/^Error:/);
  expect(readFileSync(outside, 'utf8')).toBe('UNCHANGED');
  for (const name of ['bash', 'web_fetch', 'computer_use', 'tool_search', 'skill_install']) {
    expect(await f.registry.executeTool(name, {})).toMatch(/Error:|not found|unknown/i);
  }
  let effects = 0;
  const injected = {permission: 'safe' as const, definition: {name: 'write', description: 'counterfeit', inputSchema: {type: 'object' as const, properties: {}}}, async execute() { effects++; return 'BAD'; }};
  expect(() => f.registry.registerTool(injected)).toThrow('workflow_stored_restrictions_denied');
  expect(() => f.registry.registerTool({...injected, definition: {...injected.definition, name: 'parent'}, companionTools: [injected]})).toThrow();
  expect(() => f.registry.registerDeferredTool(injected.definition)).toThrow();
  expect(() => f.registry.forkForObservation([], ['read'])).toThrow();
  expect(effects).toBe(0);
  await expect(createNativeWorkflowArtifactRegistry(Object.freeze({}) as NativeWorkflowRestrictionCheckpoint)).rejects.toThrow('workflow_stored_restrictions_denied');
});

it.each(['policy', 'attempt', 'handoff', 'participant', 'cancelled'] as const)('real durable %s mutation after prepare refuses the original dispatch', async mutation => {
  const f = await issued(), file = join(f.workspace.artifacts, 'report.md'); writeFileSync(file, 'ORIGINAL');
  const prepared = await f.registry.prepareToolInvocation('write', {file_path: file, content: 'BAD'});
  if (typeof prepared === 'string') throw Error(`unexpected_prepare_denial:${prepared}`);
  const run = f.hub.getWorkflowRun(f.handoff.workflowRunId), node = run.nodes.find((value: {id: string}) => value.id === f.handoff.nodeId);
  if (mutation === 'policy') run.spec.permissions.allowWrite = false;
  if (mutation === 'attempt') node.attempt++;
  if (mutation === 'handoff') node.runtime.handoffId += '-changed';
  if (mutation === 'participant') node.assignedAgent = 'other-worker';
  if (mutation === 'cancelled') run.status = 'cancelled';
  f.hub.persistState();
  await expect(f.registry.executePreparedTool(prepared)).rejects.toThrow('workflow_stored_restrictions_denied');
  expect(readFileSync(file, 'utf8')).toBe('ORIGINAL');
});

it('pins artifacts identity rather than accepting a moved cwd, and revokes on dispose', async () => {
  const f = await issued(), directory = f.workspace.artifacts, moved = `${directory}-original`, outside = join(f.root, 'outside'); mkdirSync(outside);
  renameSync(directory, moved); symlinkSync(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(f.registry.executeTool('write', {file_path: join(directory, 'report.md'), content: 'BAD'})).rejects.toThrow('workflow_stored_restrictions_denied');
  rmSync(directory); renameSync(moved, directory);
  f.registry.dispose(); await expect(assertNativeRegistryCheckpointCurrent(f.registry)).rejects.toThrow('workflow_stored_restrictions_denied');
});

it('retains traversal and static symlink-escape denials with the real file tools', async () => {
  const f = await issued(), outside = join(f.workspace.path, 'source.md'); writeFileSync(outside, 'ORIGINAL');
  expect(await f.registry.executeTool('write', {file_path: '../source.md', content: 'BAD'})).toMatch(/^Error:/);
  const link = join(f.workspace.artifacts, 'escape');
  symlinkSync(f.root, link, process.platform === 'win32' ? 'junction' : 'dir');
  expect(await f.registry.executeTool('write', {file_path: join(link, 'outside.md'), content: 'BAD'})).toMatch(/^Error:/);
  expect(readFileSync(outside, 'utf8')).toBe('ORIGINAL');
});

it('refuses a reentrant replacement without evaluating the attacker definition, and invalidates prepared work after unregister', async () => {
  const f = await issued(), file = join(f.workspace.artifacts, 'report.md'); writeFileSync(file, 'ORIGINAL');
  const prepared = await f.registry.prepareToolInvocation('write', {file_path: file, content: 'BAD'});
  if (typeof prepared === 'string') throw Error(`unexpected_prepare_denial:${prepared}`);
  const original = f.registry.getRegisteredTool('write');
  if (!original) throw Error('original_write_missing');
  let getterReads = 0;
  const reentrant = {...original, get definition() { getterReads++; f.registry.registerTool(original); return original.definition; }};
  expect(() => f.registry.registerTool(reentrant)).toThrow('workflow_stored_restrictions_denied');
  expect(getterReads).toBe(0);
  expect(f.registry.getRegisteredTool('write')).toBe(original);
  f.registry.unregisterTool('write');
  expect(() => f.registry.registerTool(original)).toThrow('workflow_stored_restrictions_denied');
  await expect(f.registry.executePreparedTool(prepared)).rejects.toThrow('workflow_stored_restrictions_denied');
  expect(readFileSync(file, 'utf8')).toBe('ORIGINAL');
});

it.each(['write-denied', 'readonly', 'shell-enabled', 'unknown-key', 'denied-command'] as const)('does not admit a fresh PO checkpoint with %s persisted policy', async mutation => {
  const f = await issued(), run = f.hub.getWorkflowRun(f.handoff.workflowRunId);
  if (mutation === 'write-denied') run.permissions.allowWrite = false;
  if (mutation === 'readonly') run.spec.permissions.toolCategories = ['read_project_state'];
  if (mutation === 'shell-enabled') run.spec.permissions.allowShell = true;
  if (mutation === 'unknown-key') run.spec.permissions.futureAuthority = true;
  if (mutation === 'denied-command') run.spec.permissions.deniedCommandIds = ['write'];
  f.hub.persistState();
  await expect(createNativeWorkflowRestrictionCheckpoint(f.port, f.binding)).rejects.toThrow('workflow_stored_restrictions_denied');
});

it('revokes the real registry when the workflow read owner closes', async () => {
  const f = await issued(); await closeNativeWorkflowReadPort(f.port);
  await expect(f.registry.executeTool('write', {file_path: join(f.workspace.artifacts, 'report.md'), content: 'BAD'})).rejects.toThrow('workflow_stored_restrictions_denied');
});
