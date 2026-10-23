import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

const mocks = vi.hoisted(() => ({
  getUpdateStatus: vi.fn(), quitAndInstall: vi.fn(), checkForUpdates: vi.fn(), onUpdateStatus: vi.fn<(listener: (status: unknown) => void) => () => void>(() => () => {}),
}));
vi.mock('../../renderer/src/api/bridge', () => ({ api: {
  getSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }),
  getKswarmConfig: vi.fn().mockResolvedValue({ maxConcurrentTasks: 3 }),
  getUpdateStatus: mocks.getUpdateStatus, quitAndInstall: mocks.quitAndInstall,
  onUpdateStatus: mocks.onUpdateStatus, checkForUpdates: mocks.checkForUpdates,
} }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });


describe('actual About update read failures', () => {
  it('reports unavailable initial update facts instead of current-version success', async () => {
    Object.assign(globalThis, { __APP_VERSION__: '1.5.2', __APP_BUILD__: 'fixture' });
    mocks.getUpdateStatus.mockRejectedValueOnce(Error('owned_read_failure'));
    render(<MemoryRouter><LocaleProvider><DesktopSettings onClose={() => {}} /></LocaleProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '关于' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('当前版本')).not.toBeInTheDocument();
    expect(mocks.quitAndInstall).not.toHaveBeenCalled();
  });
  it('preserves known downloaded facts after an explicit readonly refresh rejects', async () => {
    Object.assign(globalThis, { __APP_VERSION__: '1.5.2', __APP_BUILD__: 'fixture' });
    mocks.getUpdateStatus.mockResolvedValueOnce({ checking: false, available: true, downloading: false, downloaded: true, progress: 100, version: 'owned-next' });
    render(<MemoryRouter><LocaleProvider><DesktopSettings onClose={() => {}} /></LocaleProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '关于' }));
    expect(await screen.findByText('更新已就绪')).toBeInTheDocument();
    // First expose the refresh affordance via a harmless failed command.
    mocks.quitAndInstall.mockRejectedValueOnce(Error('owned_unknown_install'));
    fireEvent.click(screen.getByRole('button', { name: /重启.*安装|安装.*重启/ }));
    await screen.findByRole('alert');
    mocks.getUpdateStatus.mockRejectedValueOnce(Error('owned_read_failure'));
    fireEvent.click(screen.getByRole('button', { name: '刷新更新状态' }));
    await waitFor(() => expect(mocks.getUpdateStatus).toHaveBeenCalledTimes(2));
    expect(screen.getByText('更新已就绪')).toBeInTheDocument();
    expect(mocks.quitAndInstall).toHaveBeenCalledTimes(1);
  });
  it('ignores a held initial read after a newer Main status event', async () => {
    Object.assign(globalThis, { __APP_VERSION__: '1.5.2', __APP_BUILD__: 'fixture' });
    let release!: (status: unknown) => void;
    mocks.getUpdateStatus.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    render(<MemoryRouter><LocaleProvider><DesktopSettings onClose={() => {}} /></LocaleProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '关于' }));
    await waitFor(() => expect(mocks.onUpdateStatus).toHaveBeenCalled());
    const listener = mocks.onUpdateStatus.mock.calls.at(-1)?.[0] as unknown as (status: unknown) => void;
    await act(async () => listener({ checking: false, available: true, downloading: false, downloaded: true, progress: 100, version: 'owned-newer' }));
    expect(screen.getByText('更新已就绪')).toBeInTheDocument();
    await act(async () => release({ checking: false, available: false, downloading: false, downloaded: false, progress: 0, version: 'old-read' }));
    expect(screen.getByText('更新已就绪')).toBeInTheDocument();
    expect(screen.queryByText('当前版本')).not.toBeInTheDocument();
  });

});
