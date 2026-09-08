import { contextBridge, ipcRenderer } from 'electron';
import { createPreloadApi } from '../../electron/preload-api';
import { installationFailure, taskA, taskB } from './goal-attachment-idb-data';

const observed: string[] = [];
const desktop = createPreloadApi({
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on(channel, listener) {
    observed.push(`on:${channel}`);
    // The only injected failure. A normal IPC rejection is asynchronous and
    // cannot stand in for this local listener-installation throw.
    if (channel === `desktop:taskEvent:${taskB}` && process.env.XIAOK_U11_THROW_SUBSCRIBE === '1') {
      observed.push('throw:B'); throw new Error(installationFailure);
    }
    ipcRenderer.on(channel, listener);
  },
  off(channel, listener) { observed.push(`off:${channel}`); ipcRenderer.off(channel, listener); },
});
// The fixture exposes the unmodified production methods used by this flow.
// Unrelated multi-agent/settings capabilities are absent, not stubbed allowed.
contextBridge.exposeInMainWorld('xiaokDesktop', {
  getGoal: desktop.getGoal, createGoal: desktop.createGoal,
  onGoalChanged: desktop.onGoalChanged, onGoalTaskPrepared: desktop.onGoalTaskPrepared,
  ackGoalTaskAttached: desktop.ackGoalTaskAttached, setGoalUserQueuePending: desktop.setGoalUserQueuePending,
  subscribeTask: desktop.subscribeTask, recoverTask: desktop.recoverTask, cancelTask: desktop.cancelTask,
});
contextBridge.exposeInMainWorld('u11Native', {
  noteCommitted: (taskId: string) => { observed.push(`idb:committed:${taskId}`); },
  configure: (threadId: string) => ipcRenderer.invoke('fixture:configure', { threadId }),
  emitLiveEvent: (taskId: string) => ipcRenderer.invoke('fixture:emitLiveEvent', taskId),
  mainMetrics: () => ipcRenderer.invoke('fixture:metrics'),
  localMetrics: () => ({ observed: [...observed],
    aListeners: ipcRenderer.listenerCount(`desktop:taskEvent:${taskA}`),
    bListeners: ipcRenderer.listenerCount(`desktop:taskEvent:${taskB}`) }),
});
