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

vi.mock('../../renderer/src/api', () => ({
  api: mockApi,
}));

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => ({ projects: [] }),
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
}) {
  mockApi.listThreads.mockResolvedValue([]);
  mockApi.getUpdateStatus.mockResolvedValue(status);
  mockApi.onUpdateStatus.mockReturnValue(() => {});
  mockApi.checkForUpdates.mockResolvedValue(undefined);
  mockApi.quitAndInstall.mockResolvedValue(undefined);

  render(
    <MemoryRouter>
      <SidebarComponent onOpenSettings={() => {}} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
});
