import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { SidebarComponent } from '../../renderer/src/components/Sidebar';

const mockApi = vi.hoisted(() => ({
  listThreads: vi.fn(),
  getThread: vi.fn(),
  createThread: vi.fn(),
  updateThreadTaskId: vi.fn(),
  deleteThread: vi.fn(),
  updateThreadTitle: vi.fn(),
  getUpdateStatus: vi.fn(),
  checkForUpdates: vi.fn(),
  quitAndInstall: vi.fn(),
  onUpdateStatus: vi.fn(),
}));

const mockKSwarmState = vi.hoisted(() => ({
  projects: [] as Array<{ id: string; name: string; status: string }>,
}));

vi.mock('../../renderer/src/api', () => ({
  api: mockApi,
}));

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => ({ projects: mockKSwarmState.projects }),
}));

vi.mock('../../renderer/src/contexts/LocaleContext', () => ({
  useLocale: () => ({
    t: {
      sidebarNewTask: '新建任务',
      sidebarScheduled: '定时任务',
      sidebarProjects: '项目',
      sidebarSearch: '搜索...',
      sidebarRecent: '最近',
      sidebarNoResults: '没有结果',
      sidebarNoRecent: '暂无记录',
      sidebarRename: '重命名',
      untitled: '未命名',
    },
  }),
}));

const mockThreadList = vi.hoisted(() => ({
  threads: [] as unknown[],
  removeThread: vi.fn(),
  updateTitle: vi.fn(),
  loading: false,
}));

vi.mock('../../renderer/src/contexts/thread-list', () => ({
  useThreadList: () => mockThreadList,
}));

function renderSidebar(status: {
  checking: boolean;
  available: boolean;
  downloading: boolean;
  downloaded: boolean;
  installing?: boolean;
  progress: number;
  version?: string;
  currentVersion?: string;
  error?: string;
}, initialEntry = '/', threads: unknown[] = []) {
  mockThreadList.threads = threads;
  mockApi.listThreads.mockResolvedValue(threads);
  mockApi.getThread.mockResolvedValue(null);
  mockApi.createThread.mockResolvedValue({
    id: 'created-thread',
    title: null,
    currentTaskId: null,
    taskIds: [],
  });
  mockApi.updateThreadTaskId.mockResolvedValue(undefined);
  mockApi.getUpdateStatus.mockResolvedValue(status);
  mockApi.onUpdateStatus.mockReturnValue(() => {});
  mockApi.checkForUpdates.mockResolvedValue(undefined);
  mockApi.quitAndInstall.mockResolvedValue(undefined);

  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SidebarComponent onOpenSettings={() => {}} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  localStorage.clear();
  mockKSwarmState.projects = [];
  Object.defineProperty(window, 'xiaokDesktop', {
    value: undefined,
    configurable: true,
  });
});

describe('Sidebar update reminder', () => {
  it('keeps top navigation aligned with the titlebar controls', async () => {
    renderSidebar({
      checking: false,
      available: false,
      downloading: false,
      downloaded: false,
      progress: 0,
    });

    expect(await screen.findByRole('button', { name: '新建任务' })).toBeInTheDocument();
    expect(document.querySelector('aside')).toHaveStyle({ paddingTop: '2px' });
  });

  it('opens a popover with a version comparison when the reminder is clicked', async () => {
    renderSidebar({
      checking: false,
      available: true,
      downloading: false,
      downloaded: false,
      progress: 0,
      version: '1.3.1',
      currentVersion: '1.3.0',
    });

    const button = await screen.findByRole('button', { name: '升级到 1.3.1' });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);

    expect(await screen.findByText('v1.3.0')).toBeInTheDocument();
    expect(screen.getByText('v1.3.1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /前往 GitHub 下载/ })).toBeInTheDocument();
  });

  it('opens the GitHub releases page when the download button is clicked', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    renderSidebar({
      checking: false,
      available: true,
      downloading: false,
      downloaded: false,
      progress: 0,
      version: '1.3.1',
      currentVersion: '1.3.0',
    });

    const button = await screen.findByRole('button', { name: '升级到 1.3.1' });
    fireEvent.click(button);

    const downloadButton = await screen.findByRole('button', { name: /前往 GitHub 下载/ });
    fireEvent.click(downloadButton);

    expect(openSpy).toHaveBeenCalledWith(
      'https://github.com/kaisersong/xiaok-cli/releases/latest',
      '_blank',
      'noopener,noreferrer',
    );

    openSpy.mockRestore();
  });

  it('never triggers auto check or install from the reminder (ad-hoc signing safe)', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    renderSidebar({
      checking: false,
      available: true,
      downloading: false,
      downloaded: true,
      progress: 100,
      version: '1.3.1',
      currentVersion: '1.3.0',
    });

    const button = await screen.findByRole('button', { name: '升级到 1.3.1' });
    fireEvent.click(button);

    const downloadButton = await screen.findByRole('button', { name: /前往 GitHub 下载/ });
    fireEvent.click(downloadButton);

    expect(mockApi.checkForUpdates).not.toHaveBeenCalled();
    expect(mockApi.quitAndInstall).not.toHaveBeenCalled();
  });

  it('shows a quiet manual download hint when update checks do not complete', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    renderSidebar({
      checking: false,
      available: false,
      downloading: false,
      downloaded: false,
      progress: 0,
      currentVersion: '1.4.0',
      error: 'Cannot find latest-mac.yml',
    });

    const button = await screen.findByRole('button', { name: '检查更新未完成' });
    expect(button.className).not.toContain('border-amber');
    expect(button.className).not.toContain('bg-amber');
    expect(button.querySelector('svg')).toBeNull();

    fireEvent.click(button);

    expect(await screen.findAllByText('检查更新未完成')).toHaveLength(2);
    expect(screen.queryByText('更新检查失败')).not.toBeInTheDocument();
    expect(screen.getByText('v1.4.0')).toBeInTheDocument();
    expect(screen.getByText(/Cannot find latest-mac.yml/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /前往 GitHub 下载/ }));
    expect(openSpy).toHaveBeenCalledWith(
      'https://github.com/kaisersong/xiaok-cli/releases/latest',
      '_blank',
      'noopener,noreferrer',
    );

    openSpy.mockRestore();
  });

  it('lists scheduled tasks without a three-row nested scroll container on scheduled page', async () => {
    localStorage.setItem('xiaok:scheduled-tasks', JSON.stringify([
      { id: 'task-1', name: '定时任务 1', frequency: '每天' },
      { id: 'task-2', name: '定时任务 2', frequency: '每天' },
      { id: 'task-3', name: '定时任务 3', frequency: '每天' },
      { id: 'task-4', name: '定时任务 4', frequency: '每天' },
      { id: 'task-5', name: '定时任务 5', frequency: '每天' },
    ]));

    renderSidebar({
      checking: false,
      available: false,
      downloading: false,
      downloaded: false,
      progress: 0,
    }, '/scheduled');

    const lastTask = await screen.findByText('定时任务 5');
    const list = lastTask.closest('button')?.parentElement;

    expect(screen.getByText('定时任务 1')).toBeInTheDocument();
    expect(list).toBeTruthy();
    expect(list?.className).not.toContain('max-h-');
    expect(list?.className).not.toContain('overflow-y-auto');
  });

  it('lists active projects without a capped nested scroll container on projects page', async () => {
    mockKSwarmState.projects = [
      { id: 'project-1', name: '项目 1', status: 'active' },
      { id: 'project-2', name: '项目 2', status: 'planning' },
      { id: 'project-3', name: '项目 3', status: 'review' },
      { id: 'project-4', name: '项目 4', status: 'delivered' },
      { id: 'project-5', name: '项目 5', status: 'active' },
    ];

    renderSidebar({
      checking: false,
      available: false,
      downloading: false,
      downloaded: false,
      progress: 0,
    }, '/projects');

    const lastProject = await screen.findByText('项目 5');
    const list = lastProject.closest('button')?.parentElement;

    expect(screen.getByText('项目 1')).toBeInTheDocument();
    expect(list).toBeTruthy();
    expect(list?.className).not.toContain('max-h-');
    expect(list?.className).not.toContain('overflow-y-auto');
  });

  it('keeps sidebar project id and status hidden until the delayed hover details appear', async () => {
    mockKSwarmState.projects = [
      { id: 'proj-123e4567-e89b-42d3-a456-426614174000', name: '同名项目', status: 'active' },
      { id: 'proj-223e4567-e89b-42d3-a456-426614174001', name: '同名项目', status: 'planning' },
    ];

    renderSidebar({
      checking: false,
      available: false,
      downloading: false,
      downloaded: false,
      progress: 0,
    }, '/projects');

    const firstProjectButton = (await screen.findAllByText('同名项目'))[0].closest('button');
    expect(firstProjectButton).toBeTruthy();
    expect(screen.getAllByText('同名项目')).toHaveLength(2);
    expect(screen.queryByText('#123e4567')).not.toBeInTheDocument();
    expect(screen.queryByText('#223e4567')).not.toBeInTheDocument();
    expect(screen.queryByText('active')).not.toBeInTheDocument();
    expect(screen.queryByText('planning')).not.toBeInTheDocument();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    vi.useFakeTimers();
    fireEvent.mouseEnter(firstProjectButton!);
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('active');
    expect(screen.getByRole('tooltip')).toHaveTextContent('同名项目');
    expect(screen.getByRole('tooltip')).toHaveTextContent('proj-123e4567-e89b-42d3-a456-426614174000');

    fireEvent.mouseLeave(firstProjectButton!);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows delayed hover details for scheduled task instances', async () => {
    localStorage.setItem('xiaok:scheduled-tasks', JSON.stringify([
      {
        id: 'scheduled-task-1',
        name: '定时任务实例',
        frequency: '每天',
        threadId: 'thread-scheduled-1',
        runtimeTaskId: 'runtime-scheduled-1',
      },
    ]));

    renderSidebar({
      checking: false,
      available: false,
      downloading: false,
      downloaded: false,
      progress: 0,
    }, '/scheduled');

    const scheduledButton = (await screen.findByText('定时任务实例')).closest('button');
    expect(scheduledButton).toBeTruthy();
    expect(screen.queryByText('scheduled-task-1')).not.toBeInTheDocument();
    expect(screen.queryByText('thread-scheduled-1')).not.toBeInTheDocument();
    expect(screen.queryByText('runtime-scheduled-1')).not.toBeInTheDocument();

    vi.useFakeTimers();
    fireEvent.mouseEnter(scheduledButton!);
    act(() => {
      vi.advanceTimersByTime(500);
    });

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('定时任务实例');
    expect(tooltip).toHaveTextContent('每天');
    expect(tooltip).toHaveTextContent('scheduled-task-1');
    expect(tooltip).toHaveTextContent('thread-scheduled-1');
    expect(tooltip).toHaveTextContent('runtime-scheduled-1');
  });

  it('shows delayed hover details for recent tasks', async () => {
    renderSidebar({
      checking: false,
      available: false,
      downloading: false,
      downloaded: false,
      progress: 0,
    }, '/', [
      {
        id: 'thread-recent-1',
        title: '最近会话标题',
        status: 'running',
        mode: 'work',
        createdAt: 1,
        updatedAt: 2,
        starred: false,
        gtdBucket: null,
        pinnedAt: null,
        currentTaskId: 'task-current-1',
        taskIds: ['task-current-1', 'task-previous-1'],
      },
    ]);

    const recentButton = (await screen.findByText('最近会话标题')).closest('[role="button"]');
    expect(recentButton).toBeTruthy();
    expect(screen.queryByText('thread-recent-1')).not.toBeInTheDocument();
    expect(screen.queryByText('task-current-1')).not.toBeInTheDocument();

    vi.useFakeTimers();
    fireEvent.mouseEnter(recentButton!);
    act(() => {
      vi.advanceTimersByTime(500);
    });

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('最近会话标题');
    expect(tooltip).toHaveTextContent('running');
    expect(tooltip).toHaveTextContent('thread-recent-1');
    expect(tooltip).toHaveTextContent('task-current-1');
    expect(tooltip).toHaveTextContent('task-previous-1');
  });

  it('cancels sidebar project details when hover leaves before the delay', async () => {
    mockKSwarmState.projects = [
      { id: 'proj-123e4567-e89b-42d3-a456-426614174000', name: '同名项目', status: 'active' },
    ];

    renderSidebar({
      checking: false,
      available: false,
      downloading: false,
      downloaded: false,
      progress: 0,
    }, '/projects');

    const projectButton = (await screen.findByText('同名项目')).closest('button');
    expect(projectButton).toBeTruthy();

    vi.useFakeTimers();
    fireEvent.mouseEnter(projectButton!);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.mouseLeave(projectButton!);
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('keeps scheduled tasks and projects capped as compact summaries on the main page', async () => {
    localStorage.setItem('xiaok:scheduled-tasks', JSON.stringify([
      { id: 'task-1', name: '主界面定时任务 1', frequency: '每天' },
      { id: 'task-2', name: '主界面定时任务 2', frequency: '每天' },
      { id: 'task-3', name: '主界面定时任务 3', frequency: '每天' },
      { id: 'task-4', name: '主界面定时任务 4', frequency: '每天' },
    ]));
    mockKSwarmState.projects = [
      { id: 'project-1', name: '主界面项目 1', status: 'active' },
      { id: 'project-2', name: '主界面项目 2', status: 'planning' },
      { id: 'project-3', name: '主界面项目 3', status: 'review' },
      { id: 'project-4', name: '主界面项目 4', status: 'delivered' },
    ];

    renderSidebar({
      checking: false,
      available: false,
      downloading: false,
      downloaded: false,
      progress: 0,
    }, '/');

    const scheduledList = (await screen.findByText('主界面定时任务 4')).closest('button')?.parentElement;
    const projectList = (await screen.findByText('主界面项目 4')).closest('button')?.parentElement;

    expect(scheduledList?.className).toContain('max-h-[90px]');
    expect(scheduledList?.className).toContain('overflow-y-auto');
    expect(projectList?.className).toContain('max-h-[150px]');
    expect(projectList?.className).toContain('overflow-y-auto');
  });

  it('keeps every runtime thread for a scheduled task out of the recent list and shows the scheduled entry', async () => {
    const oldThread = {
      id: 'thread-old-dream',
      title: 'Dream',
      currentTaskId: 'task_old',
      taskIds: ['task_old'],
      createdAt: 1,
      updatedAt: 1,
    };
    const latestThread = {
      id: 'thread-latest-dream',
      title: 'Dream',
      currentTaskId: 'task_new',
      taskIds: ['task_new'],
      createdAt: 3,
      updatedAt: 3,
    };
    const normalThread = {
      id: 'thread-normal',
      title: '普通任务',
      currentTaskId: null,
      taskIds: [],
      createdAt: 2,
      updatedAt: 2,
    };
    localStorage.setItem('xiaok:scheduled-tasks', JSON.stringify([
      {
        id: 'scheduled-dream',
        name: 'Dream',
        frequency: 'daily',
        threadId: 'thread-old-dream',
        runtimeTaskId: 'task_old',
      },
    ]));
    mockApi.getThread.mockImplementation(async (id: string) => {
      if (id === oldThread.id) return oldThread;
      if (id === latestThread.id) return latestThread;
      if (id === normalThread.id) return normalThread;
      return null;
    });
    Object.defineProperty(window, 'xiaokDesktop', {
      value: {
        getScheduledTasks: vi.fn(async () => [
          {
            id: 'scheduled-dream',
            name: 'Dream',
            frequency: 'daily',
            status: 'active',
            createdAt: 1,
            updatedAt: 3,
            runtimeTaskId: 'task_new',
          },
        ]),
        getTimedActionRuns: vi.fn(async () => [
          { runtimeTaskId: 'task_new', startedAt: 300 },
          { runtimeTaskId: 'task_old', startedAt: 100 },
        ]),
      },
      configurable: true,
    });

    renderSidebar({
      checking: false,
      available: false,
      downloading: false,
      downloaded: false,
      progress: 0,
    }, '/', [latestThread, normalThread, oldThread]);

    expect(await screen.findByText('Dream')).toBeInTheDocument();
    expect(await screen.findByTestId('thread-item-thread-normal')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId('thread-item-thread-old-dream')).toBeNull();
      expect(screen.queryByTestId('thread-item-thread-latest-dream')).toBeNull();
    });
  });
});
