import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

const mocks = vi.hoisted(() => ({
  listPluginMcpServers: vi.fn(),
  listPluginDependencyStatuses: vi.fn(),
  installPlugin: vi.fn(),
  installPluginDependency: vi.fn(),
  enableComputerUse: vi.fn(),
  restartPluginMcpServers: vi.fn(),
  openPluginDependencyPermissionSettings: vi.fn(),
}));

vi.mock('../../renderer/src/api/bridge', () => ({
  api: {
    getSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }),
    saveSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }),
    getKswarmConfig: vi.fn().mockResolvedValue({ maxConcurrentTasks: 3 }),
    saveKswarmConfig: vi.fn().mockResolvedValue({ maxConcurrentTasks: 3 }),
    listMCPInstalls: vi.fn().mockResolvedValue([]),
    listPluginMcpServers: mocks.listPluginMcpServers,
    listPluginDependencyStatuses: mocks.listPluginDependencyStatuses,
    restartPluginMcpServers: mocks.restartPluginMcpServers,
    openPluginDependencyPermissionSettings: mocks.openPluginDependencyPermissionSettings,
    installPlugin: mocks.installPlugin,
    installPluginDependency: mocks.installPluginDependency,
    enableComputerUse: mocks.enableComputerUse,
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
    mocks.enableComputerUse.mockReset();
    mocks.restartPluginMcpServers.mockReset();
    mocks.openPluginDependencyPermissionSettings.mockReset();
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
    mocks.enableComputerUse.mockResolvedValue({ state: 'ready' });
    mocks.restartPluginMcpServers.mockResolvedValue([]);
    mocks.openPluginDependencyPermissionSettings.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (globalThis as Record<string, unknown>).__APP_VERSION__;
    delete (globalThis as Record<string, unknown>).__APP_BUILD__;
  });

  function renderSettings() {
    render(
      <MemoryRouter>
        <LocaleProvider>
          <DesktopSettings onClose={() => {}} />
        </LocaleProvider>
      </MemoryRouter>,
    );
  }

  it('refreshes plugin MCP servers so late startup registrations become visible', async () => {
    renderSettings();

    await screen.findByRole('button', { name: 'MCP 服务器' });
    fireEvent.click(screen.getByRole('button', { name: 'MCP 服务器' }));

    await screen.findByText('插件 MCP 服务');
    expect(screen.getByText('report-renderer')).toBeInTheDocument();
    expect(screen.queryByText('slide-renderer')).toBeNull();

    await waitFor(() => {
      expect(screen.getByText('slide-renderer')).toBeInTheDocument();
    }, { timeout: 5_000 });
  });

  it('shows a Python version hint banner when a plugin MCP server fails with python_version_too_old', async () => {
    mocks.listPluginMcpServers.mockReset();
    mocks.listPluginMcpServers.mockResolvedValue([
      {
        name: 'slide-renderer',
        pluginName: 'kai-slide-creator',
        toolCount: 0,
        connected: false,
        enabled: true,
        lastError: 'Requires Python >=3.10',
        lastErrorDetail: {
          category: 'python_version_too_old',
          message: 'Requires Python >=3.10',
          requiredVersion: '3.10',
          command: 'python3',
        },
      },
    ]);

    renderSettings();

    await screen.findByRole('button', { name: 'MCP 服务器' });
    fireEvent.click(screen.getByRole('button', { name: 'MCP 服务器' }));

    await screen.findByText('slide-renderer');
    expect(screen.getByText(/需要 Python 3\.10/)).toBeInTheDocument();
    expect(screen.getByText('官网下载')).toBeInTheDocument();
    expect(screen.getByText('brew install python@3.12')).toBeInTheDocument();
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

    renderSettings();

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

  it('renders Computer Use plugin, driver, permission, service connection, and wrapper status separately', async () => {
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

    renderSettings();

    await screen.findByRole('button', { name: 'MCP 服务器' });
    fireEvent.click(screen.getByRole('button', { name: 'MCP 服务器' }));

    await screen.findByText('Computer Use for Mac');
    expect(screen.getByText('插件：已安装')).toBeInTheDocument();
    expect(screen.getByText('CUA Driver：0.1.7')).toBeInTheDocument();
    expect(screen.getByText('权限：已授权')).toBeInTheDocument();
    expect(screen.getByText('服务连接：已连接')).toBeInTheDocument();
    expect(screen.getByText('工具：wrapper 已注册')).toBeInTheDocument();
  });

  it('lets the user open missing permission settings from the dependency card', async () => {
    mocks.listPluginMcpServers.mockReset();
    mocks.listPluginMcpServers.mockResolvedValue([
      { name: 'cua-driver', pluginName: 'cua-computer-use', toolCount: 0, connected: false, enabled: true },
    ]);
    mocks.listPluginDependencyStatuses.mockResolvedValue([
      {
        pluginName: 'cua-computer-use',
        dependencyId: 'cua-driver',
        displayName: 'CUA Driver',
        state: 'needs_permission',
        code: 'permission_accessibility_missing',
        pluginInstalled: true,
        resolvedBinary: '/Users/alice/.local/bin/cua-driver',
        version: '0.2.0',
        canInstall: true,
        canUpdate: true,
        canDiagnose: true,
      },
    ]);

    renderSettings();

    await screen.findByRole('button', { name: 'MCP 服务器' });
    fireEvent.click(screen.getByRole('button', { name: 'MCP 服务器' }));

    await screen.findByText('需要辅助功能权限');
    fireEvent.click(screen.getByRole('button', { name: '打开辅助功能' }));

    await waitFor(() => {
      expect(mocks.openPluginDependencyPermissionSettings).toHaveBeenCalledWith({ permission: 'accessibility' });
    });
  });

  it('lets the user enable Computer Use without exposing MCP wording in the main card', async () => {
    mocks.listPluginMcpServers.mockReset();
    mocks.listPluginMcpServers.mockResolvedValue([
      {
        name: 'cua-driver',
        pluginName: 'cua-computer-use',
        toolCount: 0,
        connected: false,
        enabled: true,
        lastError: 'Plugin dependency is not ready: permission_accessibility_missing',
      },
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
        version: '0.2.0',
        canInstall: true,
        canUpdate: true,
        canDiagnose: true,
      },
    ]);

    renderSettings();

    await screen.findByRole('button', { name: 'MCP 服务器' });
    fireEvent.click(screen.getByRole('button', { name: 'MCP 服务器' }));

    await screen.findByText('服务连接：未连接');
    expect(screen.queryByText('MCP：未连接')).not.toBeInTheDocument();
    expect(screen.queryByText('MCP 未连接')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '启用 Computer Use' }));

    await waitFor(() => {
      expect(mocks.enableComputerUse).toHaveBeenCalledTimes(1);
    });
    expect(mocks.restartPluginMcpServers).not.toHaveBeenCalled();
  });

  it('shows Computer Use as waiting for explicit enablement without implying permissions are granted', async () => {
    mocks.listPluginMcpServers.mockReset();
    mocks.listPluginMcpServers.mockResolvedValue([
      {
        name: 'cua-driver',
        pluginName: 'cua-computer-use',
        toolCount: 0,
        connected: false,
        enabled: false,
        lastError: '等待用户点击连接，避免自动触发 macOS 权限弹窗',
      },
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
        version: '0.2.0',
        canInstall: true,
        canUpdate: true,
        canDiagnose: true,
      },
    ]);

    renderSettings();

    await screen.findByRole('button', { name: 'MCP 服务器' });
    fireEvent.click(screen.getByRole('button', { name: 'MCP 服务器' }));

    await screen.findByText('未启用');
    expect(screen.getByText('权限：启用后验证')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '启用 Computer Use' }));

    await waitFor(() => {
      expect(mocks.enableComputerUse).toHaveBeenCalledTimes(1);
    });
    expect(mocks.restartPluginMcpServers).not.toHaveBeenCalled();
  });
});
