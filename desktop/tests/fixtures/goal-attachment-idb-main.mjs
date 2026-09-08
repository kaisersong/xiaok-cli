import { app, BrowserWindow, ipcMain } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mutation, snapshot, taskA, taskB } from './goal-attachment-idb-data.ts';

// Test-owned fixed backend data. No TaskRuntimeHost, SQLite, allocator or model
// is claimed here. IPC, preload, renderer bridge, helper and Chromium IDB are real.
const directory = dirname(fileURLToPath(import.meta.url));
app.setPath('userData', process.env.XIAOK_U11_PROFILE);
let threadId, currentGoal = null, attached = false;
const metrics = { ack: 0, create: 0, cancel: 0, subscriptions: [], recoveries: [], requestIds: [] };
ipcMain.handle('fixture:configure', (_event, input) => { threadId = input.threadId; });
ipcMain.handle('fixture:metrics', () => structuredClone(metrics));
ipcMain.handle('fixture:emitLiveEvent', (event, taskId) => {
  if (![taskA, taskB].includes(taskId)) throw new Error('fixture_wrong_task');
  // A is already post-seal: its real host tail can fail verification, but
  // cannot start asking fresh model questions. B is an ordinary live control.
  event.sender.send(`desktop:taskEvent:${taskId}`, taskId === taskA
    ? { type: 'error', message: `${taskA} late delivery failure` }
    : { type: 'needs_user', question: { taskId, questionId: `${taskId}-late-question`, kind: 'freeform', prompt: `${taskId} live question` } });
});
ipcMain.handle('desktop:goal:get', () => currentGoal);
ipcMain.handle('desktop:goal:create', (_event, input) => {
  if (input.threadId !== threadId) throw new Error('fixture_wrong_thread');
  if (typeof input.requestId !== 'string') throw new Error('fixture_missing_request_id');
  metrics.requestIds.push(input.requestId);
  metrics.create += 1;
  const result = mutation(threadId, input.requestId); currentGoal = result.goal; return result;
});
ipcMain.handle('desktop:goal:ackTaskAttached', (_event, input) => {
  metrics.ack += 1;
  if (input.threadId !== threadId || input.attachmentId !== 'U11-attachment-B') throw new Error('fixture_wrong_attachment');
  attached = true;
});
ipcMain.handle('desktop:goal:setUserQueuePending', () => {});
ipcMain.handle('desktop:subscribeTask', (_event, input) => { metrics.subscriptions.push(input.taskId); });
ipcMain.handle('desktop:recoverTask', (_event, input) => {
  if (![taskA, taskB].includes(input.taskId)) throw new Error('fixture_wrong_task');
  metrics.recoveries.push(input.taskId); return { snapshot: snapshot(threadId, input.taskId, attached) };
});
ipcMain.handle('desktop:cancelTask', () => { metrics.cancel += 1; });
// Do not top-level await readiness: Electron must finish the ESM entry first.
void app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1200, height: 820, show: true,
    webPreferences: { preload: join(directory, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadFile(join(directory, 'index.html'));
});
app.on('window-all-closed', () => app.quit());
