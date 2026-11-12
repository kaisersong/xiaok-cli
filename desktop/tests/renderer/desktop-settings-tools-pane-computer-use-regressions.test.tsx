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

describe('DesktopSettings tools pane computer use section — review regressions', () => {

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

  it('singleflight: a held read survives polling ticks and lands once', async () => {
    // 台账 #28：慢读取（main 健康检查可达 30s）不能被 2s tick 持续作废。
    let resolveDeps!: (value: unknown) => void;
    mocks.listPluginDependencyStatuses.mockImplementationOnce(
      () => new Promise(resolve => { resolveDeps = resolve; }),
    );
    renderSettings();
    await openToolsTab();
    await screen.findByText('电脑操作状态暂不可用');

    // 持有超过一个 tick：定时读取必须跳过而不是发起重叠请求。
    await new Promise(resolve => setTimeout(resolve, 2500));
    expect(mocks.listPluginDependencyStatuses).toHaveBeenCalledTimes(1);

    resolveDeps([cuaDependency()]);
    expect(await screen.findByRole('button', { name: '下载并安装' })).toBeInTheDocument();
  }, 10000);

  it('allows cancelling an install started from this section while the IPC is held', async () => {
    // install/update IPC 等待完整任务结果；本入口发起后 cuaPending 一直持有，
    // 取消必须用独立锁，不能被阻塞。
    let resolveInstall!: (value: unknown) => void;
    mocks.installPluginDependency.mockImplementationOnce(
      () => new Promise(resolve => { resolveInstall = resolve; }),
    );
    mocks.listPluginDependencyStatuses
      .mockResolvedValueOnce([cuaDependency()])
      .mockResolvedValue([cuaDependency({ task: { taskId: 't2', dependencyId: 'cua-driver', state: 'running' } })]);
    renderSettings();
    await openToolsTab();

    fireEvent.click(await screen.findByRole('button', { name: '下载并安装' }));
    // 任务状态由 2s 轮询带回，等待窗口必须大于轮询间隔。
    const cancel = await screen.findByRole('button', { name: '取消安装任务' }, { timeout: 5000 });
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    await waitFor(() => {
      expect(mocks.cancelPluginDependencyTask).toHaveBeenCalledWith({
        pluginName: 'cua-computer-use',
        dependencyId: 'cua-driver',
      });
    });
    resolveInstall({ success: false, error: 'cancelled' });
  });

  it('offers enable when the driver is ready but the MCP entry is absent', async () => {
    // 禁用电脑操作会移除 server 条目；驱动仍 ready 时必须能重新启用。
    mocks.listPluginDependencyStatuses.mockResolvedValue([
      cuaDependency({ state: 'ready', code: 'ready', version: '0.31.0', resolvedBinary: '/Users/test/.local/bin/cua-driver' }),
    ]);
    mocks.listPluginMcpServers.mockResolvedValue([]);
    renderSettings();
    await openToolsTab();

    fireEvent.click(await screen.findByRole('button', { name: '启用 Computer Use' }));
    await waitFor(() => {
      expect(mocks.enableComputerUse).toHaveBeenCalled();
    });
  });

  it.each([
    '/opt/custom/runtime/cua-driver/my-driver',
    '/tmp/usr/local/bin/cua-driver',
    'C:\\custom\\runtime\\cua-driver\\my-driver.exe',
  ])('treats lookalike path %s as custom, not managed', async binary => {
    // 受管判定必须严格全路径匹配，子串/后缀相似不算受管。
    mocks.listPluginDependencyStatuses.mockResolvedValue([
      cuaDependency({ state: 'ready', code: 'ready', version: '0.31.0', resolvedBinary: binary }),
    ]);
    mocks.listPluginMcpServers.mockResolvedValue([cuaServer({ connected: true })]);
    renderSettings();
    await openToolsTab();

    expect(await screen.findByText(/驱动来自自定义路径/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更新' })).toBeNull();
  });

  it('queues at most one manual refresh while a read is held', async () => {
    let resolveFirst!: (value: unknown) => void;
    mocks.listPluginDependencyStatuses
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockResolvedValue([cuaDependency()]);
    renderSettings();
    await openToolsTab();
    await screen.findByText('电脑操作状态暂不可用');

    // 忙时手动刷新最多排队一次，多次点击不叠加。
    fireEvent.click(screen.getByRole('button', { name: '刷新电脑操作状态' }));
    fireEvent.click(screen.getByRole('button', { name: '刷新电脑操作状态' }));
    expect(mocks.listPluginDependencyStatuses).toHaveBeenCalledTimes(1);

    resolveFirst([]);
    // 首个读取落地后，排队的刷新自动发起并带回可安装状态。
    expect(await screen.findByRole('button', { name: '下载并安装' })).toBeInTheDocument();
    expect(mocks.listPluginDependencyStatuses).toHaveBeenCalledTimes(2);
  });

  it('allows cancelling an update started from this section while the IPC is held', async () => {
    let resolveUpdate!: (value: unknown) => void;
    mocks.updatePluginDependency.mockImplementationOnce(
      () => new Promise(resolve => { resolveUpdate = resolve; }),
    );
    const ready = { state: 'ready', code: 'ready', version: '0.31.0', resolvedBinary: '/Users/test/.local/bin/cua-driver' };
    mocks.listPluginDependencyStatuses
      .mockResolvedValueOnce([cuaDependency(ready)])
      .mockResolvedValue([cuaDependency({ ...ready, task: { taskId: 't3', dependencyId: 'cua-driver', state: 'running' } })]);
    renderSettings();
    await openToolsTab();

    fireEvent.click(await screen.findByRole('button', { name: '更新' }));
    const cancel = await screen.findByRole('button', { name: '取消安装任务' }, { timeout: 5000 });
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    await waitFor(() => {
      expect(mocks.cancelPluginDependencyTask).toHaveBeenCalledWith({
        pluginName: 'cua-computer-use',
        dependencyId: 'cua-driver',
      });
    });
    resolveUpdate({ success: false, error: 'cancelled' });
  });
});
