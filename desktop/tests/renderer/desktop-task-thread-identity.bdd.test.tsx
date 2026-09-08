import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ThreadRecord } from '../../renderer/src/api/types';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { ScheduledPage, type ScheduledTask } from '../../renderer/src/components/ScheduledPage';
import { WelcomePage } from '../../renderer/src/components/WelcomePage';

const mocks = vi.hoisted(() => ({
  createThread: vi.fn(), createTask: vi.fn(), createTaskWithFiles: vi.fn(), updateThreadTaskId: vi.fn(),
  selectMaterials: vi.fn(), listSkills: vi.fn(), getModelConfig: vi.fn(),
  getAutomationOverviewSnapshot: vi.fn(), getScheduledTasks: vi.fn(),
  getThread: vi.fn(), listThreads: vi.fn(), onReminder: vi.fn(), getReminderStatus: vi.fn(), runLoopNow: vi.fn(),
}));
vi.mock('../../renderer/src/api', () => ({ api: mocks }));
vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => ({ projects: [], projectsLoaded: true }),
}));
vi.mock('../../renderer/src/shared/desktop', async importOriginal => ({
  ...await importOriginal<typeof import('../../renderer/src/shared/desktop')>(),
  getDesktopApi: () => ({ getScheduledTasks: mocks.getScheduledTasks }),
}));

// Real WelcomePage + ChatInput and ScheduledPage handlers/DOM. Only their external
// API boundary is controlled here; native IDB/preload/SQLite/spawn live in the
// independent welcome Electron E2E. Do not reimplement identity or linking rules.
const CREATED_ID = '25c622e7-8269-4e30-9cbe-57f69b717e1a';
const EXISTING_ID = '6210235a-901f-4894-ab6a-2c0860c5f8ad';
const TASK_ID = 'task_identity_created';
const PROMPT = '检查两个子任务的真实进展';

function thread(id = CREATED_ID): ThreadRecord {
  return { id, title: 'Identity test', status: 'idle', mode: 'chat', createdAt: 1, updatedAt: 1,
    starred: false, gtdBucket: 'inbox', pinnedAt: null, currentTaskId: null, taskIds: [] };
}
function schedule(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return { id: 'identity-schedule', name: 'Identity schedule', description: '', prompt: PROMPT,
    frequency: 'manual', status: 'active', createdAt: 1, updatedAt: 1, ...overrides };
}
function LocationDump() {
  const location = useLocation();
  return <output data-testid="identity-location">{JSON.stringify({ path: location.pathname, state: location.state })}</output>;
}
function renderWelcome() {
  return render(<MemoryRouter initialEntries={['/']}><LocaleProvider><Routes>
    <Route path="/" element={<WelcomePage />} /><Route path="/t/:threadId" element={<LocationDump />} />
  </Routes></LocaleProvider></MemoryRouter>);
}
async function renderSchedule(item: ScheduledTask) {
  mocks.getScheduledTasks.mockResolvedValue([item]);
  // After a successful manual run, ScheduledPage refreshes/aggregates the
  // already-linked task. These known thread snapshots model that API read; a
  // false null would manufacture an unrelated new-thread recovery call.
  mocks.getThread.mockImplementation(async (id: string) => [CREATED_ID, EXISTING_ID].includes(id)
    ? { ...thread(id), currentTaskId: TASK_ID, taskIds: [TASK_ID] } : null);
  render(<MemoryRouter initialEntries={['/automations/schedules']}><LocaleProvider><Routes>
    <Route path="/automations/schedules" element={<ScheduledPage embedded />} />
    <Route path="/t/:threadId" element={<LocationDump />} />
  </Routes></LocaleProvider></MemoryRouter>);
  await screen.findByText(item.name);
}
async function submitWelcome(withFiles = false) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: PROMPT } });
  if (withFiles) {
    fireEvent.click(screen.getByRole('button', { name: '添加附件' }));
    await screen.findByText('report.txt');
  }
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
}
async function expectRoute(id = CREATED_ID) {
  const location = await screen.findByTestId('identity-location');
  expect(JSON.parse(location.textContent!).path).toBe(`/t/${id}`);
}
function expectIdentity(input: unknown, id: string) {
  // Exact existing context shape: no history replay, no renderer-minted grant,
  // group, agent, workspace or profile authority.
  expect(input).toMatchObject({ context: { threadId: id } });
  expect((input as { context?: unknown }).context).toEqual({ threadId: id });
}

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); localStorage.setItem('xiaok:locale', 'zh');
  mocks.createThread.mockResolvedValue(thread());
  mocks.createTask.mockResolvedValue({ taskId: TASK_ID });
  mocks.createTaskWithFiles.mockResolvedValue({ taskId: TASK_ID });
  mocks.updateThreadTaskId.mockResolvedValue(undefined);
  mocks.selectMaterials.mockResolvedValue({ filePaths: ['D:\\reports\\report.txt'] });
  mocks.listSkills.mockResolvedValue([]);
  mocks.getModelConfig.mockRejectedValue(new Error('model-config-outside-identity-scope'));
  mocks.getThread.mockResolvedValue(null); mocks.listThreads.mockResolvedValue([]);
  mocks.onReminder.mockReturnValue(() => undefined);
  mocks.getReminderStatus.mockResolvedValue({ activeReminders: [] });
  mocks.getScheduledTasks.mockResolvedValue([]);
  mocks.getAutomationOverviewSnapshot.mockResolvedValue({ generatedAt: 1,
    sourceVersions: { loopStore: 0, timedActionStore: 0 }, globalBackgroundAutoRunEnabled: true,
    totals: { loops: 0, userLoops: 0, schedules: 0, activeSchedules: 0, diagnostics: 0, recentFailures: 0 }, recentFailures: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

describe('Welcome first task uses the actual newly-created display thread', () => {
  it('W1: actual text submit has the same thread ID at create, link and navigation', async () => {
    renderWelcome(); await submitWelcome(); await expectRoute();
    expect(mocks.createThread).toHaveBeenCalledExactlyOnceWith({ title: PROMPT });
    expect(mocks.createTask).toHaveBeenCalledTimes(1);
    expect(mocks.createTask.mock.calls[0][0]).toMatchObject({ prompt: PROMPT, materials: [] });
    expect(mocks.updateThreadTaskId).toHaveBeenCalledExactlyOnceWith(CREATED_ID, TASK_ID);
    expect(mocks.createTaskWithFiles).not.toHaveBeenCalled();
    expectIdentity(mocks.createTask.mock.calls[0][0], CREATED_ID);
  });

  it('W2: actual attachment selection preserves Windows paths and the same thread identity', async () => {
    renderWelcome(); await submitWelcome(true); await expectRoute();
    expect(mocks.selectMaterials).toHaveBeenCalledTimes(1);
    expect(mocks.createTaskWithFiles).toHaveBeenCalledTimes(1);
    expect(mocks.createTaskWithFiles.mock.calls[0][0]).toMatchObject({ prompt: PROMPT, filePaths: ['D:\\reports\\report.txt'] });
    expect(mocks.updateThreadTaskId).toHaveBeenCalledExactlyOnceWith(CREATED_ID, TASK_ID);
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(JSON.parse(screen.getByTestId('identity-location').textContent!).state.initialFiles)
      .toEqual([{ filePath: 'D:\\reports\\report.txt', name: 'report.txt' }]);
    expectIdentity(mocks.createTaskWithFiles.mock.calls[0][0], CREATED_ID);
  });

  it('W3: a pending real createThread boundary cannot launch a task before that ID arrives', async () => {
    let resolve!: (value: ThreadRecord) => void;
    mocks.createThread.mockReturnValue(new Promise<ThreadRecord>(done => { resolve = done; }));
    renderWelcome(); await submitWelcome();
    await waitFor(() => expect(mocks.createThread).toHaveBeenCalledTimes(1));
    expect(mocks.createTask).not.toHaveBeenCalled(); expect(mocks.updateThreadTaskId).not.toHaveBeenCalled();
    resolve(thread(EXISTING_ID)); await expectRoute(EXISTING_ID);
    expect(mocks.createTask).toHaveBeenCalledTimes(1);
    expectIdentity(mocks.createTask.mock.calls[0][0], EXISTING_ID);
  });

  it('W4: createThread rejection leaves the draft and does not launch/link/navigate', async () => {
    mocks.createThread.mockRejectedValue(new Error('idb-create-failed'));
    renderWelcome(); await submitWelcome();
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeEnabled());
    expect(mocks.createThread).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox')).toHaveValue(PROMPT);
    expect(mocks.createTask).not.toHaveBeenCalled(); expect(mocks.createTaskWithFiles).not.toHaveBeenCalled();
    expect(mocks.updateThreadTaskId).not.toHaveBeenCalled(); expect(screen.queryByTestId('identity-location')).toBeNull();
  });

  it.each([false, true])('W5: rejected task creation withFiles=%s never manufactures a link or retries', async withFiles => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    (withFiles ? mocks.createTaskWithFiles : mocks.createTask).mockRejectedValue(new Error('permission_revoked'));
    renderWelcome(); await submitWelcome(withFiles); await expectRoute();
    expect(withFiles ? mocks.createTaskWithFiles : mocks.createTask).toHaveBeenCalledTimes(1);
    expect(withFiles ? mocks.createTask : mocks.createTaskWithFiles).not.toHaveBeenCalled();
    expect(mocks.updateThreadTaskId).not.toHaveBeenCalled();
    expect(JSON.parse(screen.getByTestId('identity-location').textContent!).state.initialPrompt).toBe(PROMPT);
  });

  it('W6: Goal quick action only opens its form, without creating an ordinary task', async () => {
    renderWelcome(); fireEvent.click(screen.getByRole('button', { name: '/goal 创建 Goal' }));
    await expectRoute();
    expect(JSON.parse(screen.getByTestId('identity-location').textContent!).state).toEqual({ createGoal: true });
    expect(mocks.createThread).toHaveBeenCalledTimes(1);
    expect(mocks.createTask).not.toHaveBeenCalled(); expect(mocks.createTaskWithFiles).not.toHaveBeenCalled();
    expect(mocks.updateThreadTaskId).not.toHaveBeenCalled();
  });
});

describe('Scheduled manual legacy calls keep their selected display-thread identity', () => {
  it('S1: existing-thread run creates and links in that thread without creating another thread', async () => {
    await renderSchedule(schedule({ threadId: EXISTING_ID }));
    fireEvent.click(screen.getByRole('button', { name: '运行' })); await expectRoute(EXISTING_ID);
    expect(mocks.createThread).not.toHaveBeenCalled(); expect(mocks.createTask).toHaveBeenCalledTimes(1);
    expect(mocks.createTask.mock.calls[0][0]).toMatchObject({ prompt: expect.stringContaining(PROMPT), materials: [] });
    expect(mocks.updateThreadTaskId).toHaveBeenCalledExactlyOnceWith(EXISTING_ID, TASK_ID);
    expectIdentity(mocks.createTask.mock.calls[0][0], EXISTING_ID);
  });

  it('S2: first manual run binds the newly-created thread at its first task call', async () => {
    await renderSchedule(schedule());
    fireEvent.click(screen.getByRole('button', { name: '运行' })); await expectRoute();
    expect(mocks.createThread).toHaveBeenCalledExactlyOnceWith({ title: 'Identity schedule' });
    expect(mocks.createTask).toHaveBeenCalledTimes(1);
    expect(mocks.updateThreadTaskId).toHaveBeenCalledExactlyOnceWith(CREATED_ID, TASK_ID);
    expectIdentity(mocks.createTask.mock.calls[0][0], CREATED_ID);
  });

  it('S3: the existing legacy fallback uses its new ID, never the failed old thread ID', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.createTask.mockRejectedValueOnce(new Error('thread_not_found')).mockResolvedValueOnce({ taskId: TASK_ID });
    await renderSchedule(schedule({ threadId: EXISTING_ID }));
    fireEvent.click(screen.getByRole('button', { name: '运行' })); await expectRoute();
    expect(mocks.createThread).toHaveBeenCalledTimes(1); expect(mocks.createTask).toHaveBeenCalledTimes(2);
    expect(mocks.updateThreadTaskId).toHaveBeenCalledExactlyOnceWith(CREATED_ID, TASK_ID);
    expectIdentity(mocks.createTask.mock.calls[0][0], EXISTING_ID);
    expectIdentity(mocks.createTask.mock.calls[1][0], CREATED_ID);
  });

  it('S4: new thread creation failure does not issue a task, update a link, or navigate', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.createThread.mockRejectedValue(new Error('idb-create-failed'));
    await renderSchedule(schedule()); fireEvent.click(screen.getByRole('button', { name: '运行' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '运行' })).toBeEnabled());
    expect(mocks.createThread).toHaveBeenCalledTimes(1); expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.updateThreadTaskId).not.toHaveBeenCalled(); expect(screen.queryByTestId('identity-location')).toBeNull();
  });

  it('S3b: link failure retains the legacy two-create fallback but uses each actual old/new thread ID', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.createTask.mockResolvedValueOnce({ taskId: 'task_first_started' }).mockResolvedValueOnce({ taskId: TASK_ID });
    mocks.updateThreadTaskId.mockRejectedValueOnce(new Error('thread_not_found')).mockResolvedValue(undefined);
    await renderSchedule(schedule({ threadId: EXISTING_ID }));
    fireEvent.click(screen.getByRole('button', { name: '运行' })); await expectRoute();
    expect(mocks.createThread).toHaveBeenCalledTimes(1); expect(mocks.createTask).toHaveBeenCalledTimes(2);
    expect(mocks.updateThreadTaskId.mock.calls).toEqual([[EXISTING_ID, 'task_first_started'], [CREATED_ID, TASK_ID]]);
    expectIdentity(mocks.createTask.mock.calls[0][0], EXISTING_ID);
    expectIdentity(mocks.createTask.mock.calls[1][0], CREATED_ID);
  });

  it('S5: first task admission failure does not manufacture a successful link or retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.createTask.mockRejectedValue(new Error('permission_revoked'));
    await renderSchedule(schedule()); fireEvent.click(screen.getByRole('button', { name: '运行' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '运行' })).toBeEnabled());
    expect(mocks.createTask).toHaveBeenCalledTimes(1); expect(mocks.createThread).toHaveBeenCalledTimes(1);
    expect(mocks.updateThreadTaskId).not.toHaveBeenCalled(); expect(screen.queryByTestId('identity-location')).toBeNull();
  });

  it.each(['success', 'already_running', 'failed'] as const)('S6: Loop %s remains on runLoopNow, never ordinary task creation', async status => {
    mocks.runLoopNow.mockResolvedValue({ status });
    await renderSchedule(schedule({ executorKind: 'loop', loopId: 'actual-loop' }));
    fireEvent.click(screen.getByRole('button', { name: '运行' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '运行' })).toBeEnabled());
    expect(mocks.runLoopNow).toHaveBeenCalledExactlyOnceWith('actual-loop');
    expect(mocks.createThread).not.toHaveBeenCalled(); expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.updateThreadTaskId).not.toHaveBeenCalled(); expect(screen.queryByTestId('identity-location')).toBeNull();
  });
});
