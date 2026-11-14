import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

// 工具管理「电脑操作」区：复用既有依赖安装/更新 IPC，不提供任何路径填写。
// 安全 gate（requestSource/confirmation/platform）在 main 侧，这里验证 renderer
// 只通过白名单 preload API 传 pluginName/dependencyId/confirmed。

const mocks = vi.hoisted(() => ({
  getConnectorsConfig: vi.fn(),
  saveConnectorsConfig: vi.fn(),
  listConnectorRuntimes: vi.fn(),
  testConnectorProvider: vi.fn(),
  controlYzjCliAuth: vi.fn(),
  getYzjCliAuthState: vi.fn(),
  listPluginDependencyStatuses: vi.fn(),
  listPluginMcpServers: vi.fn(),
  installPluginDependency: vi.fn(),
  updatePluginDependency: vi.fn(),
  cancelPluginDependencyTask: vi.fn(),
  installPlugin: vi.fn(),
  enableComputerUse: vi.fn(),
  openPluginDependencyPermissionSettings: vi.fn(),
}));

vi.mock('../../renderer/src/shared/desktop', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../renderer/src/shared/desktop')>(),
  getDesktopApi: () => mocks,
}));

vi.mock('../../renderer/src/api/bridge', () => ({
  api: {
    getConnectorsConfig: mocks.getConnectorsConfig,
    saveConnectorsConfig: mocks.saveConnectorsConfig,
    listConnectorRuntimes: mocks.listConnectorRuntimes,
    testConnectorProvider: mocks.testConnectorProvider,
    getSystemOneConfig: vi.fn().mockResolvedValue({
      configured: false, keySource: 'none', keyEnvVar: null,
      baseUrl: 'https://api.typesafe.ai', model: 'jev-latest', apiKeyMasked: null,
    }),
    saveSystemOneConfig: vi.fn(),
    getSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }),
    saveSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }),
    getKswarmConfig: vi.fn().mockResolvedValue({ maxConcurrentTasks: 3 }),
    saveKswarmConfig: vi.fn().mockResolvedValue({ maxConcurrentTasks: 3 }),
    listMCPInstalls: vi.fn().mockResolvedValue([]),
    listPluginMcpServers: mocks.listPluginMcpServers,
    listPluginDependencyStatuses: mocks.listPluginDependencyStatuses,
    installPluginDependency: mocks.installPluginDependency,
    updatePluginDependency: mocks.updatePluginDependency,
    cancelPluginDependencyTask: mocks.cancelPluginDependencyTask,
    installPlugin: mocks.installPlugin,
    enableComputerUse: mocks.enableComputerUse,
    openPluginDependencyPermissionSettings: mocks.openPluginDependencyPermissionSettings,
  },
}));

function cuaDependency(overrides: Record<string, unknown> = {}) {
  return {
    pluginName: 'cua-computer-use',
    dependencyId: 'cua-driver',
    displayName: 'CUA Driver',
    pluginInstalled: true,
    state: 'missing',
    code: 'binary_missing',
    canInstall: true,
    canUpdate: true,
    canDiagnose: false,
    ...overrides,
  };
}

function cuaServer(overrides: Record<string, unknown> = {}) {
  return {
    name: 'cua-driver',
    pluginName: 'cua-computer-use',
    toolCount: 10,
    connected: false,
    enabled: true,
    ...overrides,
  };
}

function connectorsSnapshot() {
  return {
    config: {
      search: { provider: 'duckduckgo' as const },
      fetch: { provider: 'basic' as const },
    },
    loadStatus: 'ok' as const,
    providers: [
      { provider_name: 'duckduckgo', runtime_state: 'ready' as const },
      { provider_name: 'basic', runtime_state: 'ready' as const },
    ],
  };
}

describe('DesktopSettings tools pane computer use section', () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).__APP_VERSION__ = 'test-version';
    (globalThis as Record<string, unknown>).__APP_BUILD__ = 'test-build';
    mocks.getConnectorsConfig.mockReset().mockResolvedValue(connectorsSnapshot());
    mocks.saveConnectorsConfig.mockReset();
    mocks.listConnectorRuntimes.mockReset();
    mocks.testConnectorProvider.mockReset();
    mocks.controlYzjCliAuth.mockReset().mockResolvedValue({ phase: 'signedOut', revision: 1 });
    mocks.getYzjCliAuthState.mockReset();
    mocks.listPluginDependencyStatuses.mockReset().mockResolvedValue([]);
    mocks.listPluginMcpServers.mockReset().mockResolvedValue([]);
    mocks.installPluginDependency.mockReset().mockResolvedValue({ success: true });
    mocks.updatePluginDependency.mockReset().mockResolvedValue({ success: true });
    mocks.cancelPluginDependencyTask.mockReset().mockResolvedValue({ cancelling: true });
    mocks.installPlugin.mockReset().mockResolvedValue({ success: true });
    mocks.enableComputerUse.mockReset().mockResolvedValue({ state: 'ready', mcpConnected: true, wrapperReady: true });
    mocks.openPluginDependencyPermissionSettings.mockReset().mockResolvedValue(undefined);
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    confirmSpy.mockRestore();
    alertSpy.mockRestore();
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

  async function openToolsTab() {
    fireEvent.click(await screen.findByRole('button', { name: '工具管理' }));
    await screen.findByText('搜索 Provider');
  }

  it('offers one-click download when the driver is missing and the plugin is installed', async () => {
    mocks.listPluginDependencyStatuses.mockResolvedValue([cuaDependency()]);
    renderSettings();
    await openToolsTab();

    const install = await screen.findByRole('button', { name: '下载并安装' });
    expect(screen.getByText('未安装 CUA Driver')).toBeInTheDocument();
    // 没有任何路径输入框。
    expect(screen.queryByLabelText(/driver.*path|路径/i)).toBeNull();

    fireEvent.click(install);
    await waitFor(() => {
      expect(mocks.installPluginDependency).toHaveBeenCalledWith({
        pluginName: 'cua-computer-use',
        dependencyId: 'cua-driver',
        confirmed: true,
      });
    });
    expect(confirmSpy).toHaveBeenCalled();
  });

  it('requires confirmation before installing', async () => {
    confirmSpy.mockReturnValue(false);
    mocks.listPluginDependencyStatuses.mockResolvedValue([cuaDependency()]);
    renderSettings();
    await openToolsTab();

    fireEvent.click(await screen.findByRole('button', { name: '下载并安装' }));
    expect(mocks.installPluginDependency).not.toHaveBeenCalled();
  });

  it('installs the plugin first when it is not deployed yet', async () => {
    mocks.listPluginDependencyStatuses.mockResolvedValue([cuaDependency({ pluginInstalled: false })]);
    renderSettings();
    await openToolsTab();

    fireEvent.click(await screen.findByRole('button', { name: '安装并启用' }));
    await waitFor(() => {
      expect(mocks.installPlugin).toHaveBeenCalledWith('cua-computer-use');
      expect(mocks.installPluginDependency).toHaveBeenCalledWith({
        pluginName: 'cua-computer-use',
        dependencyId: 'cua-driver',
        confirmed: true,
      });
    });
    const pluginOrder = mocks.installPlugin.mock.invocationCallOrder[0]!;
    const depOrder = mocks.installPluginDependency.mock.invocationCallOrder[0]!;
    expect(pluginOrder).toBeLessThan(depOrder);
  });

  it('shows update and enable actions when ready but MCP is disconnected', async () => {
    mocks.listPluginDependencyStatuses.mockResolvedValue([
      cuaDependency({ state: 'ready', code: 'ready', version: '0.31.0', resolvedBinary: '/Users/test/.local/bin/cua-driver' }),
    ]);
    mocks.listPluginMcpServers.mockResolvedValue([cuaServer({ connected: false })]);
    renderSettings();
    await openToolsTab();

    expect(await screen.findByText(/0\.31\.0/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '更新' }));
    await waitFor(() => {
      expect(mocks.updatePluginDependency).toHaveBeenCalledWith({
        pluginName: 'cua-computer-use',
        dependencyId: 'cua-driver',
        confirmed: true,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '启用 Computer Use' }));
    await waitFor(() => {
      expect(mocks.enableComputerUse).toHaveBeenCalled();
    });
  });

  it('hides enable when MCP is already connected', async () => {
    mocks.listPluginDependencyStatuses.mockResolvedValue([
      cuaDependency({ state: 'ready', code: 'ready', version: '0.31.0', resolvedBinary: '/Users/test/.local/bin/cua-driver' }),
    ]);
    mocks.listPluginMcpServers.mockResolvedValue([cuaServer({ connected: true })]);
    renderSettings();
    await openToolsTab();

    await screen.findByRole('button', { name: '更新' });
    expect(screen.queryByRole('button', { name: '启用 Computer Use' })).toBeNull();
  });

  it('opens system settings when accessibility permission is missing', async () => {
    mocks.listPluginDependencyStatuses.mockResolvedValue([
      cuaDependency({ state: 'needs_permission', code: 'permission_accessibility_missing', resolvedBinary: '/Users/test/.local/bin/cua-driver', version: '0.31.0' }),
    ]);
    renderSettings();
    await openToolsTab();

    fireEvent.click(await screen.findByRole('button', { name: '打开辅助功能' }));
    await waitFor(() => {
      expect(mocks.openPluginDependencyPermissionSettings).toHaveBeenCalledWith({ permission: 'accessibility' });
    });
  });

  it('opens system settings when screen recording permission is missing', async () => {
    mocks.listPluginDependencyStatuses.mockResolvedValue([
      cuaDependency({ state: 'needs_permission', code: 'permission_screen_missing', resolvedBinary: '/Users/test/.local/bin/cua-driver', version: '0.31.0' }),
    ]);
    renderSettings();
    await openToolsTab();

    fireEvent.click(await screen.findByRole('button', { name: '打开屏幕录制' }));
    await waitFor(() => {
      expect(mocks.openPluginDependencyPermissionSettings).toHaveBeenCalledWith({ permission: 'screen' });
    });
  });

  it('shows unsupported text without actions on unsupported platforms', async () => {
    mocks.listPluginDependencyStatuses.mockResolvedValue([
      cuaDependency({ state: 'unsupported', code: 'unsupported_platform', canInstall: false, canUpdate: false }),
    ]);
    renderSettings();
    await openToolsTab();

    expect(await screen.findByText('当前平台不支持电脑操作')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下载并安装' })).toBeNull();
    expect(screen.queryByRole('button', { name: '更新' })).toBeNull();
    expect(screen.queryByRole('button', { name: '安装并启用' })).toBeNull();
  });

  it('hides install/update while a task started elsewhere is running and offers cancel', async () => {
    // 跨入口场景：MCP 页发起安装后切到工具管理，task 仍在 main 侧运行。
    mocks.listPluginDependencyStatuses.mockResolvedValue([
      cuaDependency({ task: { taskId: 't1', dependencyId: 'cua-driver', state: 'running' } }),
    ]);
    renderSettings();
    await openToolsTab();

    const cancel = await screen.findByRole('button', { name: '取消安装任务' });
    expect(screen.queryByRole('button', { name: '下载并安装' })).toBeNull();
    expect(screen.queryByRole('button', { name: '更新' })).toBeNull();
    expect(screen.queryByRole('button', { name: '启用 Computer Use' })).toBeNull();

    fireEvent.click(cancel);
    await waitFor(() => {
      expect(mocks.cancelPluginDependencyTask).toHaveBeenCalledWith({
        pluginName: 'cua-computer-use',
        dependencyId: 'cua-driver',
      });
    });
  });

  it('marks a custom driver path and disables in-app update', async () => {
    mocks.listPluginDependencyStatuses.mockResolvedValue([
      cuaDependency({ state: 'ready', code: 'ready', version: '0.31.0', resolvedBinary: '/opt/custom/bin/cua-driver' }),
    ]);
    mocks.listPluginMcpServers.mockResolvedValue([cuaServer({ connected: true })]);
    renderSettings();
    await openToolsTab();

    expect(await screen.findByText(/驱动来自自定义路径/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更新' })).toBeNull();
  });

  it('treats the Windows private release path as managed, not custom', async () => {
    mocks.listPluginDependencyStatuses.mockResolvedValue([
      cuaDependency({ state: 'ready', code: 'ready', version: '0.31.0', resolvedBinary: 'C:\\Users\\test\\AppData\\Local\\xiaok\\runtime\\cua-driver\\0.31.0\\cua-driver.exe' }),
    ]);
    mocks.listPluginMcpServers.mockResolvedValue([cuaServer({ connected: true })]);
    renderSettings();
    await openToolsTab();

    await screen.findByRole('button', { name: '更新' });
    expect(screen.queryByText(/驱动来自自定义路径/)).toBeNull();
  });

  it('offers update when the driver version is too old', async () => {
    mocks.listPluginDependencyStatuses.mockResolvedValue([
      cuaDependency({ state: 'degraded', code: 'version_too_old', version: '0.18.0', resolvedBinary: '/Users/test/.local/bin/cua-driver' }),
    ]);
    renderSettings();
    await openToolsTab();

    expect(await screen.findByText('需要更新 Driver')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更新' })).toBeInTheDocument();
  });

  it('alerts on install failure', async () => {
    mocks.listPluginDependencyStatuses.mockResolvedValue([cuaDependency()]);
    mocks.installPluginDependency.mockResolvedValue({ success: false, error: 'plugin_dependency_operation_failed' });
    renderSettings();
    await openToolsTab();

    fireEvent.click(await screen.findByRole('button', { name: '下载并安装' }));
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('安装失败');
    });
  });

  it('explains update refusal when the driver is pinned by environment override', async () => {
    mocks.listPluginDependencyStatuses.mockResolvedValue([
      cuaDependency({ state: 'ready', code: 'ready', version: '0.31.0', resolvedBinary: '/Users/test/.local/bin/cua-driver' }),
    ]);
    mocks.updatePluginDependency.mockResolvedValue({ success: false, error: 'external_driver_update_not_allowed' });
    renderSettings();
    await openToolsTab();

    fireEvent.click(await screen.findByRole('button', { name: '更新' }));
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('驱动由环境变量指定，无法在应用内更新');
    });
  });

  it('shows an unavailable state with refresh when dependency reads fail', async () => {
    mocks.listPluginDependencyStatuses.mockRejectedValue(new Error('ipc_down'));
    renderSettings();
    await openToolsTab();

    expect(await screen.findByText('电脑操作状态暂不可用')).toBeInTheDocument();
    mocks.listPluginDependencyStatuses.mockResolvedValue([cuaDependency()]);
    fireEvent.click(screen.getByRole('button', { name: '刷新电脑操作状态' }));
    expect(await screen.findByRole('button', { name: '下载并安装' })).toBeInTheDocument();
  });

  it('does not render the section when the catalog has no cua entry', async () => {
    mocks.listPluginDependencyStatuses.mockResolvedValue([]);
    renderSettings();
    await openToolsTab();

    // 生产目录恒含 cua-driver 条目；空目录按不可用处理而不是空白。
    expect(await screen.findByText('电脑操作状态暂不可用')).toBeInTheDocument();
  });
});
