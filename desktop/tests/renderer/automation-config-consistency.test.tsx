import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AutomationsPage } from '../../renderer/src/components/automations/AutomationsPage';
import { LocaleProvider, useLocale } from '../../renderer/src/contexts/LocaleContext';
const mocks = vi.hoisted(() => ({ overview: vi.fn(), config: vi.fn(), set: vi.fn(), clearLoop: vi.fn(), clearSchedule: vi.fn() }));
vi.mock('../../renderer/src/api/index', () => ({ api: { getAutomationOverviewSnapshot: mocks.overview, getAutomationsConfig: mocks.config, setGlobalBackgroundAutoRun: mocks.set, clearLoopRunHistory: mocks.clearLoop, clearScheduledTaskRunHistory: mocks.clearSchedule } }));
vi.mock('../../renderer/src/components/DesktopSettings', () => ({ LoopsPane: () => null }));
vi.mock('../../renderer/src/components/ScheduledPage', () => ({ ScheduledPage: () => null }));
vi.mock('../../renderer/src/components/automations/LoopConstraintsTab', () => ({ LoopConstraintsTab: () => null }));
const snapshot = (enabled = true) => ({ generatedAt: 1, sourceVersions: { loopStore: 1, timedActionStore: 2 }, globalBackgroundAutoRunEnabled: enabled, totals: { loops: 2, userLoops: 2, schedules: 3, activeSchedules: 3, diagnostics: 0, recentFailures: 0 }, recentFailures: [] });
function LocaleButton() { const { setLocale } = useLocale(); return <button onClick={() => setLocale('en')}>test-locale</button>; }
function mount() { return render(<MemoryRouter><LocaleProvider><LocaleButton /><AutomationsPage /></LocaleProvider></MemoryRouter>); }
beforeEach(() => { localStorage.setItem('xiaok:locale', 'zh'); mocks.overview.mockReset().mockResolvedValue(snapshot()); mocks.config.mockReset().mockResolvedValue({ globalBackgroundAutoRunEnabled: true }); mocks.set.mockReset().mockResolvedValue({ globalBackgroundAutoRunEnabled: false }); mocks.clearLoop.mockReset().mockResolvedValue(undefined); mocks.clearSchedule.mockReset().mockResolvedValue(undefined); });
afterEach(() => { cleanup(); localStorage.removeItem('xiaok:locale'); vi.restoreAllMocks(); });
it('uses one overview owner and keeps failed initial facts unknown with a read-only retry', async () => {
  mocks.overview.mockRejectedValueOnce(Error('private-read')); mount(); expect(await screen.findByRole('alert')).toHaveTextContent('无法读取自动化状态');
  expect(screen.getByText('后台自动运行状态未知')).toBeInTheDocument(); expect(screen.getByRole('button', { name: '启用后台自动运行' })).toBeDisabled(); expect(mocks.config).not.toHaveBeenCalled(); expect(mocks.set).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '刷新自动化状态' })); await screen.findByText('后台自动运行已开启'); expect(mocks.overview).toHaveBeenCalledTimes(2); expect(mocks.set).not.toHaveBeenCalled();
});
it('does not permit a toggle before the first real snapshot settles', async () => {
  let finish!: (value: unknown) => void; mocks.overview.mockReturnValueOnce(new Promise(yes => { finish = yes; })); mount();
  try { expect(screen.getByRole('button', { name: '启用后台自动运行' })).toBeDisabled(); expect(mocks.set).not.toHaveBeenCalled(); } finally { await act(async () => finish(snapshot())); }
  expect(screen.getByRole('button', { name: '暂停后台自动运行' })).not.toBeDisabled(); expect(mocks.config).not.toHaveBeenCalled();
});
it.each([null, {}, { generatedAt: 1 }, { ...snapshot(), sourceVersions: undefined }, { ...snapshot(), generatedAt: NaN }])('does not turn malformed overview %s into enabled/healthy success', async value => {
  mocks.overview.mockResolvedValueOnce(value); mount(); expect(await screen.findByRole('alert')).toHaveTextContent('无法读取自动化状态'); expect(screen.getByText('后台自动运行状态未知')).toBeInTheDocument(); expect(mocks.set).not.toHaveBeenCalled();
});
it.each([undefined, null, {}, { globalBackgroundAutoRunEnabled: 1 }])('preserves last confirmed facts on malformed setter result %s', async value => {
  mocks.set.mockResolvedValueOnce(value); mount(); const button = await screen.findByRole('button', { name: '暂停后台自动运行' }); fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent('后台自动运行设置结果未知'); expect(screen.getByText('后台自动运行已开启')).toBeInTheDocument(); expect(mocks.set).toHaveBeenCalledExactlyOnceWith({ enabled: false });
});
it('catches a rejected mutation without displaying private details or clearing it on a read', async () => {
  mocks.set.mockRejectedValueOnce(Error('private-write')); mount(); fireEvent.click(await screen.findByRole('button', { name: '暂停后台自动运行' })); await screen.findByRole('alert');
  expect(screen.queryByText('private-write')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: '刷新自动化状态' })); await waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(2)); expect(screen.getByRole('alert')).toHaveTextContent('后台自动运行设置结果未知'); expect(mocks.set).toHaveBeenCalledTimes(1);
});
it('keeps one action busy through batched double click and locale, using current failure labels', async () => {
  let fail!: (error: unknown) => void; mocks.set.mockReturnValueOnce(new Promise((_yes, no) => { fail = no; })); mount(); const button = await screen.findByRole('button', { name: '暂停后台自动运行' });
  try { act(() => { fireEvent.click(button); fireEvent.click(button); }); expect(mocks.set).toHaveBeenCalledTimes(1); expect(button).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'test-locale' })); } finally { await act(async () => fail(Error('owned-write'))); }
  expect(screen.getByRole('alert')).toHaveTextContent('Background auto-run update outcome is unknown'); expect(button).not.toBeDisabled();
});
it('does not let a held read replace a later successful setter receipt', async () => {
  let finish!: (value: unknown) => void; mocks.overview.mockResolvedValueOnce(snapshot()).mockReturnValueOnce(new Promise(yes => { finish = yes; })); mount(); const button = await screen.findByRole('button', { name: '暂停后台自动运行' });
  fireEvent.click(screen.getByRole('button', { name: '刷新自动化状态' })); fireEvent.click(button); await screen.findByText('后台自动运行已暂停'); await act(async () => finish(snapshot(true))); expect(screen.getByText('后台自动运行已暂停')).toBeInTheDocument(); expect(mocks.set).toHaveBeenCalledTimes(1);
});
it('retains last-good facts on later read failure and queues at most one explicit reread', async () => {
  let finish!: (value: unknown) => void; mocks.overview.mockResolvedValueOnce(snapshot()).mockReturnValueOnce(new Promise(yes => { finish = yes; })).mockRejectedValueOnce(Error('owned-read'));
  mount(); await screen.findByText('后台自动运行已开启'); const retry = screen.getByRole('button', { name: '刷新自动化状态' }); fireEvent.click(retry); fireEvent.click(retry); fireEvent.click(retry); expect(mocks.overview).toHaveBeenCalledTimes(2); await act(async () => finish(snapshot()));
  expect(await screen.findByRole('alert')).toHaveTextContent('无法读取自动化状态'); expect(mocks.overview).toHaveBeenCalledTimes(3); expect(screen.getByText('后台自动运行已开启')).toBeInTheDocument(); expect(mocks.set).not.toHaveBeenCalled();
});
it('discards late unmounted mutation without any additional read or write', async () => {
  let finish!: (value: unknown) => void; mocks.set.mockReturnValueOnce(new Promise(yes => { finish = yes; })); const view = mount(); fireEvent.click(await screen.findByRole('button', { name: '暂停后台自动运行' })); view.unmount(); await act(async () => finish({ globalBackgroundAutoRunEnabled: false })); expect(mocks.set).toHaveBeenCalledTimes(1); expect(mocks.overview).toHaveBeenCalledTimes(1);
});
