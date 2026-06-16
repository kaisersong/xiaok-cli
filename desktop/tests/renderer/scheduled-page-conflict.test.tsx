import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { ScheduledPage } from '../../renderer/src/components/ScheduledPage';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

const mocks = vi.hoisted(() => ({
  getScheduledTasks: vi.fn(),
  updateScheduledTask: vi.fn(),
  setScheduledTaskStatus: vi.fn(),
  runLoopNow: vi.fn(),
  createThread: vi.fn(),
  createTask: vi.fn(),
  updateThreadTaskId: vi.fn(),
  onReminder: vi.fn(),
  getReminderStatus: vi.fn(),
}));

vi.mock('../../renderer/src/shared/desktop', () => ({
  getDesktopApi: () => ({
    getScheduledTasks: mocks.getScheduledTasks,
    updateScheduledTask: mocks.updateScheduledTask,
    setScheduledTaskStatus: mocks.setScheduledTaskStatus,
  }),
}));

vi.mock('../../renderer/src/api', () => ({
  api: {
    onReminder: mocks.onReminder,
    getReminderStatus: mocks.getReminderStatus,
    runLoopNow: mocks.runLoopNow,
    createThread: mocks.createThread,
    createTask: mocks.createTask,
    updateThreadTaskId: mocks.updateThreadTaskId,
    getThread: vi.fn(),
    listThreads: vi.fn(),
  },
}));

function renderScheduledPage(path = '/automations/schedules') {
  render(
    <LocaleProvider>
      <MemoryRouter initialEntries={[path]}>
        <ScheduledPage embedded />
      </MemoryRouter>
    </LocaleProvider>,
  );
}

describe('ScheduledPage stale schedule edits', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('xiaok:locale', 'zh');
    mocks.onReminder.mockReturnValue(() => undefined);
    mocks.getReminderStatus.mockResolvedValue({ activeReminders: [] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('刷新最新计划并提示用户，而不是用旧编辑覆盖并保存', async () => {
    const openedTask = {
      id: 'schedule-1',
      name: '每日检查',
      description: '旧描述',
      prompt: '旧 prompt',
      frequency: 'daily',
      scheduleConfig: { hour: 9, minute: 0 },
      status: 'active',
      userApprovedAuto: true,
      createdAt: 1_000,
      updatedAt: 2_000,
      automationStoreVersion: 7,
    };
    const latestTask = {
      ...openedTask,
      name: '已经被别处修改',
      description: '新描述',
      prompt: '外部 prompt',
      scheduleConfig: { hour: 10, minute: 30 },
      updatedAt: 3_000,
      automationStoreVersion: 8,
    };

    mocks.getScheduledTasks
      .mockResolvedValueOnce([openedTask])
      .mockResolvedValueOnce([latestTask]);
    mocks.updateScheduledTask.mockResolvedValue({
      ok: false,
      code: 'stale_automation_view',
      recoverable: true,
      message: 'This automation changed elsewhere. Review the latest values before saving again.',
      sourceVersions: { timedActionStore: 8 },
      current: latestTask,
    });

    renderScheduledPage();

    await screen.findByText('每日检查');
    fireEvent.click(screen.getByTitle('编辑'));
    fireEvent.change(screen.getByDisplayValue('每日检查'), {
      target: { value: '旧视图覆盖' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(mocks.updateScheduledTask).toHaveBeenCalledWith(expect.objectContaining({
        id: 'schedule-1',
        name: '旧视图覆盖',
        expectedUpdatedAt: 2_000,
        expectedAutomationStoreVersion: 7,
      }));
    });

    expect(await screen.findByText('已经被别处修改')).toBeTruthy();
    expect(screen.queryByText('旧视图覆盖')).toBeNull();
    expect(screen.getByText('此计划已在其他地方更新，已刷新最新内容。请重新检查后再保存。')).toBeTruthy();
  });

  it('编辑 Loop 计划时不要求 prompt，也不会把 prompt 写回计划', async () => {
    const loopSchedule = {
      id: 'loop-schedule-1',
      name: 'Weekly Loop',
      description: 'Runs a markdown loop.',
      prompt: '',
      executorKind: 'loop',
      loopId: 'user-loop-1',
      frequency: 'daily',
      scheduleConfig: { hour: 9, minute: 30 },
      status: 'active',
      userApprovedAuto: true,
      createdAt: 1_000,
      updatedAt: 2_000,
      automationStoreVersion: 7,
    };
    const updatedLoopSchedule = {
      ...loopSchedule,
      name: 'Weekday Loop',
      frequency: 'weekdays',
      updatedAt: 3_000,
      automationStoreVersion: 8,
    };

    mocks.getScheduledTasks
      .mockResolvedValueOnce([loopSchedule])
      .mockResolvedValueOnce([updatedLoopSchedule]);
    mocks.updateScheduledTask.mockResolvedValue(updatedLoopSchedule);

    renderScheduledPage();

    await screen.findByText('Weekly Loop');
    fireEvent.click(screen.getByTitle('编辑'));
    fireEvent.change(screen.getByDisplayValue('Weekly Loop'), {
      target: { value: 'Weekday Loop' },
    });

    const save = screen.getByRole('button', { name: '保存' });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);

    await waitFor(() => {
      expect(mocks.updateScheduledTask).toHaveBeenCalledWith(expect.objectContaining({
        id: 'loop-schedule-1',
        name: 'Weekday Loop',
        expectedUpdatedAt: 2_000,
        expectedAutomationStoreVersion: 7,
      }));
    });
    expect(mocks.updateScheduledTask.mock.calls[0][0]).not.toHaveProperty('prompt');
    expect(await screen.findByText('Weekday Loop')).toBeTruthy();
  });

  it('按 loopId query 打开时只显示该循环绑定的计划', async () => {
    mocks.getScheduledTasks.mockResolvedValue([
      {
        id: 'loop-schedule-1',
        name: '目标循环计划',
        description: 'Runs target loop.',
        prompt: '',
        executorKind: 'loop',
        loopId: 'user-loop-1',
        frequency: 'daily',
        scheduleConfig: { hour: 9, minute: 0 },
        status: 'active',
        userApprovedAuto: false,
        createdAt: 1_000,
        updatedAt: 2_000,
      },
      {
        id: 'loop-schedule-2',
        name: '其他循环计划',
        description: 'Runs other loop.',
        prompt: '',
        executorKind: 'loop',
        loopId: 'user-loop-2',
        frequency: 'daily',
        scheduleConfig: { hour: 10, minute: 0 },
        status: 'active',
        userApprovedAuto: false,
        createdAt: 1_000,
        updatedAt: 2_000,
      },
      {
        id: 'agent-schedule-1',
        name: '普通定时任务',
        description: 'Runs an agent task.',
        prompt: 'Do work',
        executorKind: 'agent_task',
        frequency: 'daily',
        scheduleConfig: { hour: 11, minute: 0 },
        status: 'active',
        userApprovedAuto: true,
        createdAt: 1_000,
        updatedAt: 2_000,
      },
    ]);

    renderScheduledPage('/automations/schedules?loopId=user-loop-1');

    expect(await screen.findByText('目标循环计划')).toBeTruthy();
    expect(screen.queryByText('其他循环计划')).toBeNull();
    expect(screen.queryByText('普通定时任务')).toBeNull();
  });

  it('手动运行 Loop 计划时调用 Loop runner，而不是创建空 prompt 的普通任务', async () => {
    const loopSchedule = {
      id: 'loop-schedule-1',
      name: 'Weekly Loop',
      description: 'Runs a markdown loop.',
      prompt: '',
      executorKind: 'loop',
      loopId: 'user-loop-1',
      frequency: 'daily',
      scheduleConfig: { hour: 9, minute: 30 },
      status: 'active',
      userApprovedAuto: true,
      createdAt: 1_000,
      updatedAt: 2_000,
      automationStoreVersion: 7,
    };

    mocks.getScheduledTasks.mockResolvedValue([loopSchedule]);
    mocks.runLoopNow.mockResolvedValue({
      status: 'success',
      run: {
        id: 'run-1',
        loopId: 'user-loop-1',
        status: 'success',
        trigger: { kind: 'manual' },
        evidenceIds: ['ev-1'],
        startedAt: 3_000,
        finishedAt: 4_000,
        updatedAt: 4_000,
      },
    });

    renderScheduledPage();

    await screen.findByText('Weekly Loop');
    fireEvent.click(screen.getByRole('button', { name: '运行' }));

    await waitFor(() => {
      expect(mocks.runLoopNow).toHaveBeenCalledWith('user-loop-1');
    });
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.createThread).not.toHaveBeenCalled();
  });

  it('暂停 Loop 计划时写回 main process 的 TimedAction 状态', async () => {
    const loopSchedule = {
      id: 'loop-schedule-1',
      name: 'Weekly Loop',
      description: 'Runs a markdown loop.',
      prompt: '',
      executorKind: 'loop',
      loopId: 'user-loop-1',
      frequency: 'daily',
      scheduleConfig: { hour: 9, minute: 30 },
      status: 'active',
      userApprovedAuto: true,
      createdAt: 1_000,
      updatedAt: 2_000,
      automationStoreVersion: 7,
    };
    const pausedLoopSchedule = {
      ...loopSchedule,
      status: 'paused',
      nextRunAt: undefined,
      updatedAt: 3_000,
      automationStoreVersion: 8,
    };

    mocks.getScheduledTasks
      .mockResolvedValueOnce([loopSchedule])
      .mockResolvedValueOnce([pausedLoopSchedule]);
    mocks.setScheduledTaskStatus.mockResolvedValue(pausedLoopSchedule);

    renderScheduledPage();

    await screen.findByText('Weekly Loop');
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));

    await waitFor(() => {
      expect(mocks.setScheduledTaskStatus).toHaveBeenCalledWith('loop-schedule-1', 'paused');
    });
    expect(await screen.findByText('已暂停')).toBeTruthy();
  });
});
