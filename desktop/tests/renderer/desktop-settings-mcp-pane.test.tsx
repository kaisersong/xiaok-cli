import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

const mocks = vi.hoisted(() => ({
  listPluginMcpServers: vi.fn(),
  listPluginDependencyStatuses: vi.fn(),
  installPlugin: vi.fn(),
  installPluginDependency: vi.fn(),
}));

vi.mock('../../renderer/src/api/bridge', () => ({
  api: {
    getSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }),
    saveSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }),
    listMCPInstalls: vi.fn().mockResolvedValue([]),
    listPluginMcpServers: mocks.listPluginMcpServers,
    listPluginDependencyStatuses: mocks.listPluginDependencyStatuses,
    installPlugin: mocks.installPlugin,
    installPluginDependency: mocks.installPluginDependency,
    updatePluginDependency: vi.fn(),
    diagnosePluginDependency: vi.fn(),
    createMCPInstall: vi.fn(),
    deleteMCPInstall: vi.fn(),
  },
}));

describe('DesktopSettings MCP pane', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__APP_VERSION__ = 'test-version';
    (globalThis as Record<string, unknown>).__APP_BUILD__ = 'test-build';
    mocks.listPluginMcpServers.mockReset();
    mocks.listPluginDependencyStatuses.mockReset();
    mocks.installPlugin.mockReset();
    mocks.installPluginDependency.mockReset();
    mocks.listPluginMcpServers
      .mockResolvedValueOnce([
        { name: 'report-renderer', pluginName: 'kai-report-creator', toolCount: 1, connected: true, enabled: true },
      ])
      .mockResolvedValue([
        { name: 'report-renderer', pluginName: 'kai-report-creator', toolCount: 1, connected: true, enabled: true },
        { name: 'slide-renderer', pluginName: 'kai-slide-creator', toolCount: 1, connected: true, enabled: true },
      ]);
    mocks.listPluginDependencyStatuses.mockResolvedValue([]);
    mocks.installPlugin.mockResolvedValue({ success: true });
    mocks.installPluginDependency.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (globalThis as Record<string, unknown>).__APP_VERSION__;
    delete (globalThis as Record<string, unknown>).__APP_BUILD__;
  });

  it('refreshes plugin MCP servers so late startup registrations become visible', async () => {
    render(
      <LocaleProvider>
        <DesktopSettings onClose={() => {}} />
      </LocaleProvider>,
    );

    await screen.findByRole('button', { name: 'MCP 服务器' });
    fireEvent.click(screen.getByRole('button', { name: 'MCP 服务器' }));

    await screen.findByText('插件 MCP 服务');
    expect(screen.getByText('report-renderer')).toBeInTheDocument();
    expect(screen.queryByText('slide-renderer')).toBeNull();

    await waitFor(() => {
      expect(screen.getByText('slide-renderer')).toBeInTheDocument();
    }, { timeout: 5_000 });
  });

  it('sets up Computer Use by installing the plugin before running the Driver installer', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.listPluginMcpServers.mockResolvedValue([]);
    mocks.listPluginDependencyStatuses.mockResolvedValue([
      {
        pluginName: 'cua-computer-use',
        dependencyId: 'cua-driver',
        displayName: 'CUA Driver',
        state: 'missing',
        code: 'binary_missing',
        pluginInstalled: false,
        canInstall: true,
        canUpdate: false,
        canDiagnose: false,
      },
    ]);

    render(
      <LocaleProvider>
        <DesktopSettings onClose={() => {}} />
      </LocaleProvider>,
    );

    await screen.findByRole('button', { name: 'MCP 服务器' });
    fireEvent.click(screen.getByRole('button', { name: 'MCP 服务器' }));

    await screen.findByText('Computer Use for Mac');
    expect(screen.getByText('需要安装 CUA Driver')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '安装并启用' }));

    await waitFor(() => {
      expect(mocks.installPlugin).toHaveBeenCalledWith('cua-computer-use');
      expect(mocks.installPluginDependency).toHaveBeenCalledWith({
        pluginName: 'cua-computer-use',
        dependencyId: 'cua-driver',
        confirmed: true,
      });
    });
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('renders Computer Use plugin, driver, permission, MCP, and wrapper status separately', async () => {
    mocks.listPluginMcpServers.mockReset();
    mocks.listPluginMcpServers.mockResolvedValue([
      { name: 'cua-driver', pluginName: 'cua-computer-use', toolCount: 1, connected: true, enabled: true },
    ]);
    mocks.listPluginDependencyStatuses.mockResolvedValue([
      {
        pluginName: 'cua-computer-use',
        dependencyId: 'cua-driver',
        displayName: 'CUA Driver',
        state: 'ready',
        code: 'ready',
        pluginInstalled: true,
        resolvedBinary: '/Users/alice/.local/bin/cua-driver',
        version: '0.1.7',
        canInstall: true,
        canUpdate: true,
        canDiagnose: true,
      },
    ]);

    render(
      <LocaleProvider>
        <DesktopSettings onClose={() => {}} />
      </LocaleProvider>,
    );

    await screen.findByRole('button', { name: 'MCP 服务器' });
    fireEvent.click(screen.getByRole('button', { name: 'MCP 服务器' }));

    await screen.findByText('Computer Use for Mac');
    expect(screen.getByText('插件：已安装')).toBeInTheDocument();
    expect(screen.getByText('CUA Driver：0.1.7')).toBeInTheDocument();
    expect(screen.getByText('权限：已授权')).toBeInTheDocument();
    expect(screen.getByText('MCP：已连接')).toBeInTheDocument();
    expect(screen.getByText('工具：wrapper 已注册')).toBeInTheDocument();
  });
});
