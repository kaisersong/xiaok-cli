import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { SidebarComponent } from '../../renderer/src/components/Sidebar';

const tasks = vi.hoisted(() => [
  { id: 'sync', name: 'Docs sync', frequency: 'interval', threadId: 'thread-sync' },
  { id: 'daily', name: 'Daily news', frequency: 'daily', threadId: 'thread-daily' },
]);
vi.mock('../../renderer/src/shared/desktop', () => ({ getDesktopApi: () => ({ getScheduledTasks: async () => tasks }) }));
vi.mock('../../renderer/src/api', () => ({ api: {
  getUpdateStatus: vi.fn().mockResolvedValue({ checking: false, available: false, downloading: false, downloaded: false, progress: 0 }),
  onUpdateStatus: () => () => {},
} }));
vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({ useKSwarm: () => ({ projects: [] }) }));
vi.mock('../../renderer/src/contexts/thread-list', () => ({ useThreadList: () => ({ threads: [], removeThread: vi.fn(), updateTitle: vi.fn(), setThreadGtdBucket: vi.fn() }) }));
afterEach(() => { cleanup(); localStorage.clear(); });

it('uses the current conversation for selection independently of unread and hover', async () => {
  localStorage.setItem('xiaok:scheduled-unread', JSON.stringify({ sync: 1 }));
  render(<MemoryRouter initialEntries={['/t/thread-daily']}><LocaleProvider><SidebarComponent /></LocaleProvider></MemoryRouter>);
  const daily = await screen.findByRole('button', { name: /Daily news/ });
  const sync = screen.getByRole('button', { name: /Docs sync/ });
  expect(daily).toHaveAttribute('aria-current', 'page');
  expect(daily.className).toContain('cursor-pointer');
  expect(daily.className).toContain('bg-[var(--c-bg-card)]');
  expect(sync).not.toHaveAttribute('aria-current');
  fireEvent.click(sync);
  await waitFor(() => expect(sync).toHaveAttribute('aria-current', 'page'));
  expect(daily).not.toHaveAttribute('aria-current');
  expect(JSON.parse(localStorage.getItem('xiaok:scheduled-unread')!)).toEqual({});
  fireEvent.click(daily);
  await waitFor(() => expect(daily).toHaveAttribute('aria-current', 'page'));
  expect(sync).not.toHaveAttribute('aria-current');
});
