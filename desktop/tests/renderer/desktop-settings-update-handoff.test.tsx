import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

const mocks = vi.hoisted(() => ({
  getUpdateStatus: vi.fn(), quitAndInstall: vi.fn(),
}));
vi.mock('../../renderer/src/api/bridge', () => ({ api: {
  getSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }),
  getKswarmConfig: vi.fn().mockResolvedValue({ maxConcurrentTasks: 3 }),
  getUpdateStatus: mocks.getUpdateStatus, quitAndInstall: mocks.quitAndInstall,
  onUpdateStatus: vi.fn(() => () => {}), checkForUpdates: vi.fn().mockResolvedValue(undefined),
} }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('real About update pane', () => {
  it('offers manual recovery instead of reinstall when downloaded handoff is unconfirmed', async () => {
    Object.assign(globalThis, { __APP_VERSION__: '1.5.2', __APP_BUILD__: 'fixture' });
    mocks.getUpdateStatus.mockResolvedValue({ checking: false, available: true, downloading: false,
      downloaded: true, installing: false, progress: 100, version: '1.5.3', error: 'update_install_handoff_unconfirmed' });
    render(<MemoryRouter><LocaleProvider><DesktopSettings onClose={() => {}} /></LocaleProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '关于' }));
    expect(await screen.findByText('安装交接未确认')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /重启.*安装|安装.*重启/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /前往 GitHub 下载/ })).toHaveAttribute('href', 'https://github.com/kaisersong/xiaok-cli/releases/latest');
    expect(screen.queryByText('update_install_handoff_unconfirmed')).not.toBeInTheDocument();
    expect(screen.getAllByText(/尚未确认系统接管安装，后台仍可能继续/)).toHaveLength(1);
    expect(mocks.quitAndInstall).not.toHaveBeenCalled();
  });
});
