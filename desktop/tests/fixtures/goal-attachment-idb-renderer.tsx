import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ChatShell } from '../../renderer/src/components/ChatShell';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { api } from '../../renderer/src/api/bridge';
import { taskA } from './goal-attachment-idb-data';

declare global {
  interface Window {
    u11Native: { configure(threadId: string): Promise<void>; emitLiveEvent(taskId: string): Promise<void>; noteCommitted(taskId: string): void;
      mainMetrics(): Promise<{ ack: number; create: number; cancel: number; subscriptions: string[]; recoveries: string[]; requestIds: string[] }>;
      localMetrics(): { observed: string[]; aListeners: number; bListeners: number } };
    u11Renderer: { threadId: string; updates: Array<{ taskId: string; phase: 'begin' | 'committed' }>;
      readThread(): ReturnType<typeof api.getThread> };
  }
}
async function bootstrap() {
  localStorage.setItem('xiaok:locale', 'zh');
  let threadId = localStorage.getItem('U11-threadId');
  if (!threadId) {
    const thread = await api.createThread({ title: 'U11 native IDB conversation' });
    threadId = thread.id;
    await api.updateThreadTaskId(threadId, taskA);
    localStorage.setItem('U11-threadId', threadId);
  }
  await window.u11Native.configure(threadId);
  const id = threadId;
  const updates: Window['u11Renderer']['updates'] = [];
  const actualUpdate = api.updateThreadTaskId;
  api.updateThreadTaskId = async (owner, taskId) => {
    updates.push({ taskId, phase: 'begin' });
    await actualUpdate(owner, taskId); // Actual get/put/readwrite transaction.
    updates.push({ taskId, phase: 'committed' });
    window.u11Native.noteCommitted(taskId);
  };
  window.u11Renderer = { threadId: id, updates, readThread: () => api.getThread(id) };
  createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[
    { pathname: `/t/${id}`, state: { createGoal: true } },
  ]}><LocaleProvider><Routes><Route path="/t/:taskId" element={<ChatShell />} /></Routes></LocaleProvider></MemoryRouter>);
}
void bootstrap().catch(error => { console.error(error); document.body.textContent = String(error); });
