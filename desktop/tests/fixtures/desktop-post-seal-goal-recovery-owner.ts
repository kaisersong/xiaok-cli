// Fixed real recovery process. Only the Goal durable commit dependency rejects;
// service authority, host journal recovery and Goal settlement are production.
import { writeSync } from 'node:fs';
import { join } from 'node:path';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { DesktopGoalCoordinator } from '../../electron/desktop-goal-coordinator.js';
import { SqliteGoalStore } from '../../electron/goal-store-sqlite.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';

const [root, taskId] = process.argv.slice(2);
if (!root || !taskId) throw new Error('fixed Goal recovery fixture requires root and taskId');
let commits = 0; let receipts = 0; let runs = 0; let sessions = 0; let prepares = 0; let starts = 0; let cancels = 0;
const failure = Object.assign(new Error('Goal durable commit unavailable'), { code: 'EIO' });
class UnavailableGoalStore extends SqliteGoalStore {
  override commit(input: Parameters<SqliteGoalStore['commit']>[0]): Promise<void> {
    if (input.events.some(event => event.type === 'turn_settled')) { commits++; return Promise.reject(failure); }
    return super.commit(input);
  }
}
const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite'));
const goalStore = new UnavailableGoalStore(join(root, 'goals.sqlite'));
let goal: DesktopGoalCoordinator;
const service = new DesktopMultiAgentService({ store, coordinator: new DesktopExecutionCoordinator(),
  createSession: async () => { sessions++; throw new Error('recovery session replay forbidden'); },
  onRecoveredHostTerminal: async input => { receipts++; await goal.handleRecoveredHostTerminal(input); },
});
const host = new InProcessTaskRuntimeHost({ snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')),
  materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }),
  runner: async () => { runs++; throw new Error('recovery runner replay forbidden'); },
  authorizeDeliveryRecovery: input => service.assertDeliveryRecovery(input),
});
goal = new DesktopGoalCoordinator({ store: goalStore, instanceId: 'real-failed-recovery-owner',
  taskHost: {
    prepareTask: input => { prepares++; return host.prepareTask(input); },
    startTask: id => { starts++; return host.startTask(id); },
    cancelTask: (id, reason) => { cancels++; return host.cancelTask(id, reason); },
  },
  authorizeRecoveredDelivery: input => service.assertDeliveryRecovery(input),
});
try {
  let rejection: unknown;
  try { await service.initialize(host); } catch (error) { rejection = error; }
  if (rejection !== failure) throw new Error(`expected original Goal commit rejection, got ${String(rejection)}`);
  const snapshot = await host.inspectTask(taskId);
  const document = await goalStore.load('post-seal-thread');
  writeSync(1, JSON.stringify({ stage: 'goal-commit-rejected', pid: process.pid, commits, receipts,
    runs, sessions, prepares, starts, cancels, hostStatus: snapshot?.status,
    terminalCount: snapshot?.events.filter(event => event.type === 'task_terminal').length,
    delivery: snapshot?.hostDelivery, goalTurns: document?.turns.length,
    goalStatus: document?.state.status, activation: (await goal.getGoal('post-seal-thread'))?.activation,
  }) + '\n');
} finally {
  await host.drain(); await service.dispose(); goal.disarmAll(); goalStore.close(); store.close();
}
// Natural OS exit, not a forged quiesced row or process.exit() cleanup shortcut.
