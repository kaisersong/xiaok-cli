import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { SidebarComponent } from '../../renderer/src/components/Sidebar';

const mockApi = vi.hoisted(() => ({
  listThreads: vi.fn(),
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

function renderSidebar(status: {
  checking: boolean;
  available: boolean;
  downloading: boolean;
  downloaded: boolean;
  progress: number;
  version?: string;
}, initialEntry = '/') {
  mockApi.listThreads.mockResolvedValue([]);
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
  vi.clearAllMocks();
  localStorage.clear();
  mockKSwarmState.projects = [];
});

describe('Sidebar update reminder', () => {
  it('shows a clear upgrade reminder next to settings and starts update when clicked', async () => {
    renderSidebar({
      checking: false,
      available: true,
      downloading: false,
      downloaded: false,
      progress: 0,
      version: '1.3.1',
    });

    const button = await screen.findByRole('button', { name: '升级到 1.3.1' });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);

    await waitFor(() => {
      expect(mockApi.checkForUpdates).toHaveBeenCalledTimes(1);
    });
  });

  it('shows an install reminder when the update has been downloaded', async () => {
    renderSidebar({
      checking: false,
      available: true,
      downloading: false,
      downloaded: true,
      progress: 100,
      version: '1.3.1',
    });

    const button = await screen.findByRole('button', { name: '安装 1.3.1' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockApi.quitAndInstall).toHaveBeenCalledTimes(1);
    });
  });

  it('shows download progress while an update is downloading', async () => {
    renderSidebar({
      checking: false,
      available: true,
      downloading: true,
      downloaded: false,
      progress: 42,
      version: '1.3.1',
    });

    expect(await screen.findByText('42%')).toBeInTheDocument();
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
});
