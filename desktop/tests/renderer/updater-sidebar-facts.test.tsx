import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
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
  onUpdateStatus: vi.fn<(listener: (status: any) => void) => () => void>(),
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

const mockThreadList = vi.hoisted(() => ({
  threads: [] as unknown[],
  removeThread: vi.fn(),
  updateTitle: vi.fn(),
  loading: false,
}));

vi.mock('../../renderer/src/contexts/thread-list', () => ({
  useThreadList: () => mockThreadList,
}));

function LocationProbe() { return <output data-testid="sidebar-location">{useLocation().pathname}</output>; }

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
      <LocaleProvider>
        <SidebarComponent onOpenSettings={() => {}} />
        <LocationProbe />
      </LocaleProvider>
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

describe('Sidebar updater facts failure and ordering', () => {
  it('shows initial read failure without inventing an update-success state', async () => {
    mockApi.getUpdateStatus.mockRejectedValueOnce(Error('owned_read_failure'));
    renderSidebar({ checking: false, available: false, downloading: false, downloaded: false, progress: 0 });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /升级到/ })).not.toBeInTheDocument();
    expect(mockApi.quitAndInstall).not.toHaveBeenCalled();
  });
  it('keeps newer downloaded facts when the held initial read completes', async () => {
    let release!: (status: unknown) => void;
    mockApi.getUpdateStatus.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    renderSidebar({ checking: false, available: false, downloading: false, downloaded: false, progress: 0 });
    await waitFor(() => expect(mockApi.onUpdateStatus).toHaveBeenCalled());
    const listener = mockApi.onUpdateStatus.mock.calls.at(-1)![0];
    await act(async () => listener({ checking: false, available: true, downloading: false, downloaded: true, progress: 100, version: 'owned-newer' }));
    expect(screen.getByRole('button', { name: '升级到 owned-newer' })).toBeInTheDocument();
    await act(async () => release({ checking: false, available: false, downloading: false, downloaded: false, progress: 0 }));
    expect(screen.getByRole('button', { name: '升级到 owned-newer' })).toBeInTheDocument();
  });
});
