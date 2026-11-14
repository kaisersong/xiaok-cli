import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

const mocks = vi.hoisted(() => ({
  getConnectorsConfig: vi.fn(),
  saveConnectorsConfig: vi.fn(),
  listConnectorRuntimes: vi.fn(),
  testConnectorProvider: vi.fn(),
  controlYzjCliAuth: vi.fn(),
  getYzjCliAuthState: vi.fn(),
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
    // SystemOne 区块是工具管理的一部分，这里显式 mock，避免靠异常路径通过。
    getSystemOneConfig: vi.fn().mockResolvedValue({
      configured: false,
      keySource: 'none',
      keyEnvVar: null,
      baseUrl: 'https://api.typesafe.ai',
      model: 'jev-latest',
      apiKeyMasked: null,
    }),
    saveSystemOneConfig: vi.fn(),
    getSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }),
    saveSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }),
    getKswarmConfig: vi.fn().mockResolvedValue({ maxConcurrentTasks: 3 }),
    saveKswarmConfig: vi.fn().mockResolvedValue({ maxConcurrentTasks: 3 }),
    listMCPInstalls: vi.fn().mockResolvedValue([]),
    listPluginMcpServers: vi.fn().mockResolvedValue([]),
    // 电脑操作区读取依赖状态；本文件聚焦搜索/抓取，默认无依赖条目。
    listPluginDependencyStatuses: vi.fn().mockResolvedValue([]),
    installPluginDependency: vi.fn().mockResolvedValue({ success: true }),
    updatePluginDependency: vi.fn().mockResolvedValue({ success: true }),
    cancelPluginDependencyTask: vi.fn().mockResolvedValue({ cancelling: true }),
    installPlugin: vi.fn().mockResolvedValue({ success: true }),
    enableComputerUse: vi.fn().mockResolvedValue({ state: 'ready', mcpConnected: true, wrapperReady: true }),
    openPluginDependencyPermissionSettings: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('DesktopSettings tools pane zero-config view', () => {

  beforeEach(() => {
    (globalThis as Record<string, unknown>).__APP_VERSION__ = 'test-version';
    (globalThis as Record<string, unknown>).__APP_BUILD__ = 'test-build';
    mocks.getConnectorsConfig.mockReset();
    mocks.saveConnectorsConfig.mockReset();
    mocks.listConnectorRuntimes.mockReset();
    mocks.testConnectorProvider.mockReset();
    mocks.controlYzjCliAuth.mockReset().mockResolvedValue({ phase: 'signedOut', revision: 1 });
    mocks.getYzjCliAuthState.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (globalThis as Record<string, unknown>).__APP_VERSION__;
    delete (globalThis as Record<string, unknown>).__APP_BUILD__;
  });

  function defaultSnapshot() {
    return {
      config: {
        search: { provider: 'duckduckgo' as const },
        fetch: { provider: 'basic' as const },
      },
      loadStatus: 'ok' as const,
      providers: [
        { provider_name: 'duckduckgo', runtime_state: 'ready' as const },
        { provider_name: 'tavily', runtime_state: 'inactive' as const },
        { provider_name: 'brave', runtime_state: 'inactive' as const },
        { provider_name: 'basic', runtime_state: 'ready' as const },
        { provider_name: 'jina', runtime_state: 'inactive' as const },
        { provider_name: 'firecrawl', runtime_state: 'not_implemented' as const },
      ],
    };
  }

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

  // 零配置改版后 provider 列表默认折叠；既有用例先展开高级设置，
  // 台账 #55 的保存/测试绑定语义保持不变。
  async function openAdvanced(kind: 'search' | 'fetch') {
    fireEvent.click(await screen.findByLabelText(`advanced-${kind}`));
  }

  it('default view shows zero-config summaries and hides provider configuration', async () => {
    mocks.getConnectorsConfig.mockResolvedValue(defaultSnapshot());
    renderSettings();
    await openToolsTab();

    // 摘要行：当前已确认 provider + 免配置说明。
    expect(screen.getByLabelText('summary-search')).toHaveTextContent('DuckDuckGo');
    expect(screen.getByLabelText('summary-search')).toHaveTextContent('无需配置');
    expect(screen.getByLabelText('summary-fetch')).toHaveTextContent('Basic');
    expect(screen.getByLabelText('summary-fetch')).toHaveTextContent('无需配置');

    // 内置/免配置工具的配置 UI 默认不可见。
    expect(screen.queryByLabelText('search-duckduckgo')).toBeNull();
    expect(screen.queryByLabelText('search-tavily')).toBeNull();
    expect(screen.queryByLabelText('fetch-jina')).toBeNull();
    expect(screen.queryByLabelText('test-search')).toBeNull();
    expect(screen.queryByLabelText('test-fetch')).toBeNull();

    // 高级设置入口存在。
    expect(screen.getByLabelText('advanced-search')).toBeInTheDocument();
    expect(screen.getByLabelText('advanced-fetch')).toBeInTheDocument();

    // 无变更且未展开高级设置时，保存区隐藏（零配置默认视图）。
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
  });

  it('summary reflects the confirmed snapshot, not an unsaved draft', async () => {
    mocks.getConnectorsConfig.mockResolvedValue(defaultSnapshot());
    renderSettings();
    await openToolsTab();
    await openAdvanced('search');

    fireEvent.click(screen.getByLabelText('search-tavily'));
    // 未保存：摘要仍显示已确认的 DuckDuckGo（台账 #55 语义）。
    expect(screen.getByLabelText('summary-search')).toHaveTextContent('DuckDuckGo');
    expect(screen.getByLabelText('summary-search')).not.toHaveTextContent('Tavily');
  });

  it('jina shows a free-tier badge when inactive; firecrawl never claims keyless', async () => {
    mocks.getConnectorsConfig.mockResolvedValue(defaultSnapshot());
    renderSettings();
    await openToolsTab();
    await openAdvanced('fetch');

    // Jina 免 Key 实测成立：未选中时展示免费可用而非未启用。
    expect(screen.getAllByText('免费可用').length).toBeGreaterThanOrEqual(1);

    // Firecrawl 免 Key 在 VPN/代理网络被拒（实测 403）：不得出现无需 Key 声明。
    expect(screen.queryByText('免费额度，无需 Key')).toBeNull();
    expect(screen.getAllByText(/免 Key 在.*受限|建议配置免费 Key|部分网络受限/).length).toBeGreaterThanOrEqual(1);
  });

  it('firecrawl summary recommends a key instead of claiming keyless free tier', async () => {
    mocks.getConnectorsConfig.mockResolvedValue({
      ...defaultSnapshot(),
      config: {
        search: { provider: 'firecrawl' as const },
        fetch: { provider: 'basic' as const },
      },
    });
    renderSettings();
    await openToolsTab();
    expect(screen.getByLabelText('summary-search')).toHaveTextContent('Firecrawl');
    expect(screen.getByLabelText('summary-search')).toHaveTextContent('建议配置 Key');
    expect(screen.getByLabelText('summary-search')).not.toHaveTextContent('无需 Key');
  });
});
