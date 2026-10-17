// Real recovery fixture. Model transport and test account home are controlled;
// durable queue, boot ownership, snapshots, SQLite and physical PID are real.
import {join} from 'node:path';
import {DesktopMultiAgentStore} from '../../electron/desktop-multi-agent-store.js';
import {DesktopMultiAgentService} from '../../electron/desktop-multi-agent-service.js';
import {DesktopExecutionCoordinator} from '../../electron/desktop-execution-coordinator.js';
import {InProcessTaskRuntimeHost} from '../../../src/runtime/task-host/task-runtime-host.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';

      const root = process.argv[2]; const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite'), { bootId: 'old-boot' });
      const coordinator = new DesktopExecutionCoordinator(); let childId;
      const service = new DesktopMultiAgentService({ store, coordinator, createSession: async () => ({
        run: async () => new Promise(() => {}), suspend: async () => {}, dispose: async () => {},
      }) });
      const host = new InProcessTaskRuntimeHost({ snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')),
        materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }),
        runner: input => service.runRoot(input, async context => {
          childId = (await service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'crash-spawn', taskName: 'crash', message: 'first' })).targetAgentId;
          await service.followup({ actor: context.actor, requestSource: 'agent', operationId: 'crash-followup', target: childId, message: 'not replayed' });
        }), authorizePreparation: (id, marker) => service.assertHostPreparation(id, marker), assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot),
        decideCancellation: (snapshot, reason) => service.decideHostCancellation(snapshot, reason), getExecutionPolicy: () => ({ deliveryRepair: 'explicit' }),
      });
      await service.initialize(host);
      const task = await service.prepareRoot(host, 'thread', { prompt: 'source A', materials: [] }); await host.startTask(task.taskId); await host.drain();
      process.stdout.write(JSON.stringify({ childId, sourceTaskId: task.taskId }) + '\n');
      setInterval(() => {}, 1000);
    