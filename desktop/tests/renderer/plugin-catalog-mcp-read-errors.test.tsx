import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
const reads = vi.hoisted(() => ({ servers: vi.fn(), dependencies: vi.fn(), install: vi.fn() }));
vi.mock('../../renderer/src/api/bridge', () => ({ api: { getSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }), saveSkillDebugConfig: vi.fn(), getKswarmConfig: vi.fn().mockResolvedValue({ maxConcurrentTasks: 3 }), saveKswarmConfig: vi.fn(), listMCPInstalls: vi.fn().mockResolvedValue([]), listPluginMcpServers: reads.servers, listPluginDependencyStatuses: reads.dependencies, installPlugin: reads.install } }));
const server = (name: string) => ({ name, pluginName: 'owned-plugin', toolCount: 2, connected: true, enabled: true });
beforeEach(() => { vi.useFakeTimers(); (globalThis as Record<string, unknown>).__APP_VERSION__ = 'owned'; (globalThis as Record<string, unknown>).__APP_BUILD__ = 'owned'; reads.servers.mockReset(); reads.dependencies.mockReset().mockResolvedValue([]); reads.install.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
async function open() {
  render(<MemoryRouter><LocaleProvider><DesktopSettings onClose={() => {}} /></LocaleProvider></MemoryRouter>);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  fireEvent.click(screen.getByRole('button', { name: 'MCP 服务器' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}
it('retains the last good server and dependency facts while the single existing timer reports and recovers a read failure', async () => {
  reads.servers.mockResolvedValue([server('owned-server')]);
  reads.dependencies.mockResolvedValue([{ pluginName: 'owned-plugin', dependencyId: 'owned-dep', displayName: 'Owned dependency', state: 'missing', code: 'binary_missing', canInstall: false, canUpdate: false, canDiagnose: false }]);
  await open(); expect(screen.getByText('owned-server')).toBeInTheDocument(); expect(screen.getByText('Owned dependency')).toBeInTheDocument();
  reads.servers.mockRejectedValue(Error('plugin_catalog_projection_unavailable')); reads.dependencies.mockRejectedValue(Error('owned_io_failure'));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByRole('alert')).toHaveTextContent('插件目录暂时不可用'); expect(screen.getByText('owned-server')).toBeInTheDocument(); expect(screen.getByText('Owned dependency')).toBeInTheDocument();
  reads.servers.mockResolvedValue([server('owned-latest')]); reads.dependencies.mockResolvedValue([]);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByText('owned-latest')).toBeInTheDocument(); expect(screen.queryByRole('alert')).toBeNull(); expect(reads.install).not.toHaveBeenCalled();
});
it('allows a held read longer than the two-second timer to finish without starvation or overlapping reads', async () => {
  let release!: (value: ReturnType<typeof server>[]) => void;
  reads.servers.mockReturnValue(new Promise(resolve => { release = resolve; }));
  await open(); await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(reads.servers).toHaveBeenCalledTimes(1); expect(reads.dependencies).toHaveBeenCalledTimes(1);
  await act(async () => { release([server('owned-after-long-read')]); });
  expect(screen.getByText('owned-after-long-read')).toBeInTheDocument(); expect(screen.queryByRole('alert')).toBeNull();
});
