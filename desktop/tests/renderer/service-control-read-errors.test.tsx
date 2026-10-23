import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
import { LocaleProvider, useLocale } from '../../renderer/src/contexts/LocaleContext';
const mocks = vi.hoisted(() => ({ read: vi.fn(), restart: vi.fn() }));
vi.mock('../../renderer/src/api/bridge', () => ({ api: {
  getSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }), getKswarmConfig: vi.fn().mockResolvedValue({ maxConcurrentTasks: 3 }),
  getServiceStatus: mocks.read, restartRelatedService: mocks.restart,
} }));
const status = (label = 'Owned KSwarm') => ({ checkedAt: 1, services: [
  { id: 'kswarm', label, running: true, reachable: true, port: 4400, pid: 1, lastError: null },
  { id: 'intent-broker', label: 'Owned Broker', running: true, reachable: true, port: 4318, pid: 2, lastError: null },
] });
function held<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function LocaleControl() { const { setLocale } = useLocale(); return <button type="button" onClick={() => setLocale('en')}>test-locale</button>; }
function mount() { return render(<MemoryRouter><LocaleProvider><LocaleControl /><DesktopSettings onClose={() => {}} /></LocaleProvider></MemoryRouter>); }
beforeEach(() => { localStorage.setItem('xiaok:locale', 'zh'); mocks.read.mockReset().mockResolvedValue(status()); mocks.restart.mockReset().mockResolvedValue(undefined); });
afterEach(() => { cleanup(); localStorage.removeItem('xiaok:locale'); vi.useRealTimers(); });
describe('actual GeneralPane service reads and explicit restart handling', () => {
  it('localizes initial read failure and offers readonly retry', async () => {
    mocks.read.mockRejectedValueOnce(Error('private-sdk-error')); mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('服务状态读取失败'); expect(screen.queryByText('private-sdk-error')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新读取服务状态' })); await screen.findByText('Owned KSwarm'); expect(mocks.read).toHaveBeenCalledTimes(2); expect(mocks.restart).not.toHaveBeenCalled();
  });
  it('keeps last-good rows and retries only a read after refresh failure', async () => {
    mount(); await screen.findByText('Owned KSwarm'); mocks.read.mockRejectedValueOnce(Error('private-read'));
    fireEvent.click(screen.getByRole('button', { name: '重新读取服务状态' })); await screen.findByRole('alert'); expect(screen.getByText('Owned KSwarm')).toBeInTheDocument(); expect(mocks.restart).not.toHaveBeenCalled();
  });
  it('skips busy 10s poll ticks and queues at most one explicit read', async () => {
    vi.useFakeTimers(); const read = held<ReturnType<typeof status>>(); mocks.read.mockReturnValueOnce(read.promise); mount();
    await act(async () => vi.advanceTimersByTime(10_001)); expect(mocks.read).toHaveBeenCalledTimes(1);
    const retry = screen.getByRole('button', { name: '重新读取服务状态' }); fireEvent.click(retry); fireEvent.click(retry); expect(mocks.read).toHaveBeenCalledTimes(1);
    await act(async () => read.resolve(status('held-read'))); expect(mocks.read).toHaveBeenCalledTimes(2); expect(screen.getByText('Owned KSwarm')).toBeInTheDocument(); expect(mocks.restart).not.toHaveBeenCalled();
  });
  it('does not let old read/finally overwrite a newer locale lifetime', async () => {
    const read = held<ReturnType<typeof status>>(); mocks.read.mockReturnValueOnce(read.promise); mount(); fireEvent.click(screen.getByRole('button', { name: 'test-locale' }));
    await screen.findByText('Owned KSwarm'); await act(async () => read.resolve(status('obsolete'))); expect(screen.queryByText('obsolete')).toBeNull(); expect(screen.getByText('Owned KSwarm')).toBeInTheDocument();
  });
  it('prevents same-frame double-click and other-row restart while one action is held', async () => {
    const action = held<void>(); mocks.restart.mockReturnValueOnce(action.promise); mount(); await screen.findByText('Owned KSwarm');
    const first = screen.getByLabelText('restart-service-kswarm'), other = screen.getByLabelText('restart-service-intent-broker'); fireEvent.click(first); fireEvent.click(first); fireEvent.click(other);
    expect(mocks.restart).toHaveBeenCalledExactlyOnceWith('kswarm'); expect(first).toBeDisabled(); expect(other).toBeDisabled();
    await act(async () => action.resolve(undefined)); expect(first).not.toBeDisabled(); expect(other).not.toBeDisabled(); expect(mocks.read).toHaveBeenCalledTimes(2);
  });
  it('preserves unknown restart outcome across readonly recovery without automatic mutation retry', async () => {
    mocks.restart.mockRejectedValueOnce(Error('private-action')); mount(); await screen.findByText('Owned KSwarm'); fireEvent.click(screen.getByLabelText('restart-service-kswarm'));
    expect(await screen.findByRole('alert')).toHaveTextContent('重启操作的结果尚不确定'); expect(screen.queryByText('private-action')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新读取服务状态' })); await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2)); expect(screen.getByRole('alert')).toHaveTextContent('重启操作的结果尚不确定'); expect(mocks.restart).toHaveBeenCalledTimes(1);
  });
  it('keeps a held action through locale changes while rendering its error in the current locale', async () => {
    const action = held<void>(); mocks.restart.mockReturnValueOnce(action.promise); mount(); await screen.findByText('Owned KSwarm'); fireEvent.click(screen.getByLabelText('restart-service-kswarm')); fireEvent.click(screen.getByRole('button', { name: 'test-locale' }));
    await screen.findByText('Owned KSwarm'); expect(screen.getByLabelText('restart-service-intent-broker')).toBeDisabled();
    await act(async () => action.reject(Error('private-action'))); expect(screen.getByRole('alert')).toHaveTextContent('The restart outcome is unknown'); expect(screen.getByLabelText('restart-service-kswarm')).not.toBeDisabled(); expect(mocks.restart).toHaveBeenCalledTimes(1);
  });
  it('does not request a post-action read after the original page unmounts', async () => {
    const action = held<void>(); mocks.restart.mockReturnValueOnce(action.promise); const view = mount(); await screen.findByText('Owned KSwarm'); fireEvent.click(screen.getByLabelText('restart-service-kswarm')); view.unmount();
    await act(async () => action.resolve(undefined)); expect(mocks.read).toHaveBeenCalledTimes(1); expect(mocks.restart).toHaveBeenCalledTimes(1);
  });
});
