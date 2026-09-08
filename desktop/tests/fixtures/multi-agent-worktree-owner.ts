// Real process fixture. Only the model transport is controlled; allocation,
// scoped spawn, managed session, host, journal and boot ownership are production.
import { join } from 'node:path';
import { writeSync } from 'node:fs';
import { DesktopMultiAgentRuntime } from '../../electron/desktop-multi-agent-runtime.js';
import { DesktopMultiAgentWorktrees } from '../../electron/desktop-multi-agent-worktrees.js';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { DesktopCapabilityCatalog } from '../../electron/desktop-multi-agent-capabilities.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { createSkillCatalog } from '../../../src/ai/skills/loader.js';
import type { ModelAdapter, ToolExecutionContext } from '../../../src/types.js';
import type { MultiAgentManagedResource } from '../../shared/multi-agent-types.js';

const [root, cleanupPolicy, checkpoint = 'running'] = process.argv.slice(2);
if (!root || !['keep', 'delete'].includes(cleanupPolicy)
  || !['running', 'planned-before-allocation', 'git-created-before-allocated'].includes(checkpoint)) throw new Error('invalid test fixture arguments');
const cwd = join(root, 'repo'); const dataRoot = join(root, 'data');
const store = new DesktopMultiAgentStore(join(dataRoot, 'groups.sqlite'), { bootId: 'crashed-worktree-owner' });
const coordinator = new DesktopExecutionCoordinator();
const worktrees = new DesktopMultiAgentWorktrees({ store });
let runtime!: DesktopMultiAgentRuntime;
const service = new DesktopMultiAgentService({ store, coordinator, worktrees, createSession: input => runtime.createSession(input) });
runtime = new DesktopMultiAgentRuntime({ service, worktrees });
service.registerThread({ threadId: 'thread', profileId: 'profile', workspaceId: 'workspace', cwd });
const materialRegistry = new MaterialRegistry({ workspaceRoot: join(dataRoot, 'materials'), maxBytes: 1024 });
const catalog = new DesktopCapabilityCatalog();
let notifyModelStarted!: () => void;
const modelStarted = new Promise<void>(resolve => { notifyModelStarted = resolve; });
let modelRequests = 0; let childId = ''; let groupId = ''; let rootTaskId = '';
function pauseAtResourceCheckpoint(resource: MultiAgentManagedResource): never {
  // Only pause a real dependency boundary. The production allocator, Git and
  // journal are not replaced, and the parent independently reads their state.
  writeSync(1, JSON.stringify({ ready: true, checkpoint, childId: resource.agentId, groupId: resource.groupId,
    taskId: rootTaskId, modelRequests, resource: store.resources(resource.groupId).find(row => row.resourceId === resource.resourceId),
    agent: store.getAgent(resource.groupId, resource.agentId) }) + '\n');
  const stopped = new Int32Array(new SharedArrayBuffer(4));
  for (;;) Atomics.wait(stopped, 0, 0);
}
const putResource = store.putResource.bind(store);
store.putResource = (resource, control) => {
  if (checkpoint === 'git-created-before-allocated' && resource.state === 'allocated') pauseAtResourceCheckpoint(resource);
  putResource(resource, control);
  if (checkpoint === 'planned-before-allocation' && resource.state === 'planned') pauseAtResourceCheckpoint(resource);
};
const adapter: Pick<ModelAdapter, 'stream'> = { async *stream() {
  modelRequests++; notifyModelStarted();
  yield { type: 'text', delta: 'CHILD_PROCESS_IS_RUNNING' };
  await new Promise<void>(() => {});
} };
const host = new InProcessTaskRuntimeHost({ snapshotStore: new FileTaskSnapshotStore(join(dataRoot, 'tasks')), materialRegistry,
  authorizePreparation: (taskId, marker) => service.assertHostPreparation(taskId, marker),
  assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot),
  decideCancellation: (snapshot, reason) => service.decideHostCancellation(snapshot, reason),
  getExecutionPolicy: () => ({ deliveryRepair: 'explicit' }),
  runner: input => service.runRoot(input, async context => {
    groupId = context.groupId; rootTaskId = input.taskId;
    const scope = runtime.bindRoot(context, { adapter, catalog, policy: catalog.snapshotPolicy(), workspaceId: 'workspace', materialIds: [],
      permissionRevision: 0, registryOptions: { autoMode: true }, materials: [], materialRegistry,
      skillCatalog: createSkillCatalog(undefined, cwd), dataRoot, systemPrompt: 'Test root',
      agents: [{ name: 'worktree-owner', systemPrompt: 'Stay active', isolation: 'worktree', cleanup: cleanupPolicy as 'keep' | 'delete' }],
      emitRuntimeEvent: input.emitRuntimeEvent,
    });
    try {
      const toolContext: ToolExecutionContext = { taskId: input.taskId, toolInvocationId: 'actual-worktree-spawn', signal: context.signal,
        messages: [], systemPrompt: 'Test root', toolDefinitions: scope.registry.getToolDefinitions(), session: {
          sessionId: input.sessionId, cwd, createdAt: Date.now(), updatedAt: Date.now(), lineage: [input.sessionId],
          messages: [], usage: { inputTokens: 0, outputTokens: 0 }, compactions: [], memoryRefs: [], approvalRefs: [], backgroundJobRefs: [],
        } };
      const result = await scope.registry.executeTool('spawn_agent', { task_name: 'working_child', message: 'Wait until process exits', agent: 'worktree-owner' },
        toolContext);
      childId = JSON.parse(result).targetAgentId;
      if (!childId) throw new Error(`real spawn failed: ${result}`);
      await input.emitRuntimeEvent({ type: 'receipt_emitted', sessionId: input.sessionId, turnId: context.turnId,
        intentId: 'intent', stepId: 'step', note: 'Root completed; child remains active' });
    } finally { scope.dispose(); }
  }),
});
await service.initialize(host);
const task = await service.prepareRoot(host, 'thread', { prompt: 'Start the worktree child', materials: [] });
await host.startTask(task.taskId); await host.drain(); await modelStarted;
process.stdout.write(JSON.stringify({ ready: true, checkpoint, childId, groupId, taskId: task.taskId, modelRequests,
  resource: store.resources(groupId)[0], agent: store.getAgent(groupId, childId) }) + '\n');
// An explicit crash is the test boundary; do not turn this into graceful cleanup.
setInterval(() => {}, 1000);
