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
  },
}));

describe('DesktopSettings tools pane', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__APP_VERSION__ = 'test-version';
    (globalThis as Record<string, unknown>).__APP_BUILD__ = 'test-build';
    mocks.getConnectorsConfig.mockReset();
    mocks.saveConnectorsConfig.mockReset();
    mocks.listConnectorRuntimes.mockReset();
    mocks.testConnectorProvider.mockReset();
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

  it('renders tools tab with current providers and runtime badges', async () => {
    mocks.getConnectorsConfig.mockResolvedValue(defaultSnapshot());

    renderSettings();

    fireEvent.click(await screen.findByRole('button', { name: '工具管理' }));

    await screen.findByText('搜索 Provider');
    expect(screen.getByText('DuckDuckGo')).toBeInTheDocument();
    expect(screen.getByText('Tavily')).toBeInTheDocument();
    expect(screen.getByText('Brave Search')).toBeInTheDocument();
    // SearXNG removed
    expect(screen.queryByText('SearXNG')).toBeNull();
    expect(screen.getByText('抓取 Provider')).toBeInTheDocument();
    expect(screen.getByText('Jina Reader')).toBeInTheDocument();
    // Firecrawl kept as not_implemented placeholder
    expect(screen.getAllByText('Firecrawl').length).toBeGreaterThanOrEqual(1);

    const ddgRadio = screen.getByLabelText('search-duckduckgo') as HTMLInputElement;
    expect(ddgRadio.checked).toBe(true);

    const firecrawlRadio = screen.getByLabelText('fetch-firecrawl') as HTMLInputElement;
    expect(firecrawlRadio.disabled).toBe(false);

    // Test buttons present
    expect(screen.getByLabelText('test-search')).toBeInTheDocument();
    expect(screen.getByLabelText('test-fetch')).toBeInTheDocument();
  });

  it('saves new provider selection with API key typed in ApiKeyInput (no stored key)', async () => {
    // snapshot has no tavilyApiKey — ApiKeyInput starts in edit mode
    mocks.getConnectorsConfig.mockResolvedValue(defaultSnapshot());
    mocks.saveConnectorsConfig.mockImplementation(async (input) => ({
      config: input,
      loadStatus: 'ok' as const,
      providers: defaultSnapshot().providers,
    }));

    renderSettings();

    fireEvent.click(await screen.findByRole('button', { name: '工具管理' }));
    await screen.findByText('搜索 Provider');

    // Switch to Tavily
    fireEvent.click(screen.getByLabelText('search-tavily'));

    // ApiKeyInput is in edit mode (no stored key) — password input visible immediately
    const keyInput = await screen.findByLabelText('tavily-api-key');
    fireEvent.change(keyInput, { target: { value: 'tvly-test-key' } });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(mocks.saveConnectorsConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          search: expect.objectContaining({ provider: 'tavily', tavilyApiKey: 'tvly-test-key' }),
        }),
      );
    });

    await screen.findByText('已保存');
  });

  it('shows masked key and edit toggle when a key is already stored', async () => {
    mocks.getConnectorsConfig.mockResolvedValue({
      ...defaultSnapshot(),
      config: {
        search: { provider: 'tavily' as const, tavilyApiKey: 'tvly-abcdefgh1234' },
        fetch: { provider: 'basic' as const },
      },
    });

    renderSettings();

    fireEvent.click(await screen.findByRole('button', { name: '工具管理' }));
    await screen.findByText('搜索 Provider');

    // Masked display visible, not plain password input
    const maskedEl = screen.getByLabelText('tavily-api-key');
    expect(maskedEl.tagName).toBe('SPAN');
    expect(maskedEl.textContent).toMatch(/•/);
    // No raw key in DOM
    expect(maskedEl.textContent).not.toContain('tvly-abcdefgh1234');

    // 更换 button present
    expect(screen.getByLabelText('edit-tavily-api-key')).toBeInTheDocument();
  });

  it('test button calls testConnectorProvider and shows result', async () => {
    mocks.getConnectorsConfig.mockResolvedValue(defaultSnapshot());
    mocks.testConnectorProvider.mockResolvedValue({
      success: true,
      latencyMs: 123,
      providerName: 'web_search.duckduckgo',
      detail: '3 result(s)',
    });

    renderSettings();

    fireEvent.click(await screen.findByRole('button', { name: '工具管理' }));
    await screen.findByText('搜索 Provider');

    fireEvent.click(screen.getByLabelText('test-search'));

    await waitFor(() => {
      expect(mocks.testConnectorProvider).toHaveBeenCalledWith('search');
    });
    await screen.findByText(/123ms/);
  });

  it('requires an acknowledged save before testing a changed search provider', async () => {
    mocks.getConnectorsConfig.mockResolvedValue(defaultSnapshot());
    let finishSave!: (value: unknown) => void;
    mocks.saveConnectorsConfig.mockImplementation(() => new Promise(resolve => { finishSave = resolve; }));
    mocks.testConnectorProvider.mockResolvedValue({ success: true, latencyMs: 87, providerName: 'web_search.firecrawl' });
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: '工具管理' }));
    fireEvent.click(await screen.findByLabelText('search-firecrawl'));
    expect(screen.getByLabelText('test-search')).toBeDisabled();
    expect(screen.getAllByText('请先保存或刷新确认当前配置，再测试连接。').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText('test-search'));
    expect(mocks.testConnectorProvider).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByLabelText('test-search')).toBeDisabled();
    const submitted = mocks.saveConnectorsConfig.mock.calls[0]![0];
    expect(submitted.search.provider).toBe('firecrawl');
    await act(async () => finishSave({ ...defaultSnapshot(), config: submitted }));
    expect(screen.getByLabelText('test-search')).toBeEnabled();
    fireEvent.click(screen.getByLabelText('test-search'));
    await screen.findByText(/87ms/);
    expect(mocks.testConnectorProvider).toHaveBeenCalledWith('search');
  });

  it('also blocks testing after a fetch selection or credential edit', async () => {
    mocks.getConnectorsConfig.mockResolvedValue(defaultSnapshot());
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: '工具管理' }));
    fireEvent.click(await screen.findByLabelText('fetch-firecrawl'));
    expect(screen.getByLabelText('test-fetch')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('fetch-basic'));
    expect(screen.getByLabelText('test-fetch')).toBeEnabled();
    fireEvent.click(screen.getByLabelText('search-firecrawl'));
    mocks.saveConnectorsConfig.mockImplementation(async input => ({ ...defaultSnapshot(), config: input }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('已保存');
    expect(screen.getByLabelText('test-search')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('firecrawl-search-api-key'), { target: { value: 'fc-fictional-fixture' } });
    expect(screen.getByLabelText('test-search')).toBeDisabled();
    expect(mocks.testConnectorProvider).not.toHaveBeenCalled();
  });

  it('requires refresh after an uncertain save even when the draft is reverted', async () => {
    mocks.getConnectorsConfig.mockResolvedValue(defaultSnapshot());
    mocks.saveConnectorsConfig.mockRejectedValue(new Error('connectors_operation_unknown'));
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: '工具管理' }));
    fireEvent.click(await screen.findByLabelText('search-firecrawl'));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('连接器操作结果尚未确认，请先刷新核对。');
    fireEvent.click(screen.getByLabelText('search-duckduckgo'));
    expect(screen.getByLabelText('test-search')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '刷新连接器配置' }));
    await waitFor(() => expect(screen.getByLabelText('test-search')).toBeEnabled());
    expect(mocks.testConnectorProvider).not.toHaveBeenCalled();
    expect(mocks.saveConnectorsConfig).toHaveBeenCalledTimes(1);
  });

  it('hides a previous DuckDuckGo error when the selection changes', async () => {
    mocks.getConnectorsConfig.mockResolvedValue(defaultSnapshot());
    mocks.testConnectorProvider.mockResolvedValue({ success: false, latencyMs: 5, providerName: 'web_search.duckduckgo', error: 'DuckDuckGo bot challenge' });
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: '工具管理' }));
    fireEvent.click(await screen.findByLabelText('test-search'));
    await screen.findByText('DuckDuckGo bot challenge');
    fireEvent.click(screen.getByLabelText('search-firecrawl'));
    expect(screen.queryByText('DuckDuckGo bot challenge')).toBeNull();
    fireEvent.click(screen.getByLabelText('search-duckduckgo'));
    expect(screen.queryByText('DuckDuckGo bot challenge')).toBeNull();
  });

  it('does not let a refresh started before an uncertain save confirm stale configuration', async () => {
    let finishRefresh!: (value: unknown) => void;
    mocks.getConnectorsConfig.mockResolvedValueOnce(defaultSnapshot())
      .mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve; }));
    mocks.saveConnectorsConfig.mockRejectedValue(new Error('connectors_operation_unknown'));
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: '工具管理' }));
    await screen.findByLabelText('search-duckduckgo');
    fireEvent.click(screen.getByRole('button', { name: '刷新连接器配置' }));
    fireEvent.click(screen.getByLabelText('search-firecrawl'));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('连接器操作结果尚未确认，请先刷新核对。');
    fireEvent.click(screen.getByLabelText('search-duckduckgo'));
    await act(async () => finishRefresh(defaultSnapshot()));
    expect(screen.getByLabelText('test-search')).toBeDisabled();
    expect(screen.getByRole('button', { name: '刷新连接器配置' })).toBeEnabled();
  });

  it.each([true, false])('ignores a late old-provider result (success=%s) after switching and saving', async success => {
    mocks.getConnectorsConfig.mockResolvedValue(defaultSnapshot());
    let finishTest!: (value: unknown) => void;
    mocks.testConnectorProvider.mockImplementation(() => new Promise(resolve => { finishTest = resolve; }));
    mocks.saveConnectorsConfig.mockImplementation(async input => ({ ...defaultSnapshot(), config: input }));
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: '工具管理' }));
    fireEvent.click(await screen.findByLabelText('test-search'));
    expect(screen.getByLabelText('test-search')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('search-firecrawl'));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('已保存');
    await act(async () => finishTest({ success, latencyMs: 987, providerName: 'web_search.duckduckgo', error: 'Late DuckDuckGo error' }));
    expect(screen.queryByText(/987ms|Late DuckDuckGo error/)).toBeNull();
    expect(screen.getByLabelText('test-search')).toBeEnabled();
  });

  it('renders DeepSeek in both provider lists and reuses the model-config key (hint, no key input)', async () => {
    mocks.getConnectorsConfig.mockResolvedValue(defaultSnapshot());

    renderSettings();

    fireEvent.click(await screen.findByRole('button', { name: '工具管理' }));
    await screen.findByText('搜索 Provider');

    // Both lists expose DeepSeek.
    expect(screen.getAllByText('DeepSeek').length).toBeGreaterThanOrEqual(2);

    // Selecting DeepSeek for search shows the model-config hint, not an ApiKeyInput.
    fireEvent.click(screen.getByLabelText('search-deepseek'));
    await screen.findByText(/复用模型配置中 DeepSeek 的 API Key|使用「模型配置」中 DeepSeek/);
    expect(screen.queryByLabelText('deepseek-api-key')).toBeNull();

    fireEvent.click(screen.getByLabelText('fetch-deepseek'));
    const hints = await screen.findAllByText(/使用「模型配置」中 DeepSeek/);
    expect(hints.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByLabelText('deepseek-api-key')).toBeNull();
  });

  it('saves a deepseek selection without any api key field', async () => {
    mocks.getConnectorsConfig.mockResolvedValue(defaultSnapshot());
    mocks.saveConnectorsConfig.mockImplementation(async (input) => ({
      config: input,
      loadStatus: 'ok' as const,
      providers: defaultSnapshot().providers,
    }));

    renderSettings();

    fireEvent.click(await screen.findByRole('button', { name: '工具管理' }));
    await screen.findByText('搜索 Provider');

    fireEvent.click(screen.getByLabelText('search-deepseek'));
    fireEvent.click(screen.getByLabelText('fetch-deepseek'));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      const [input] = mocks.saveConnectorsConfig.mock.lastCall ?? [];
      expect(input).toBeDefined();
      expect((input as { search: { provider: string } }).search).toEqual({ provider: 'deepseek' });
      expect((input as { fetch: { provider: string } }).fetch.provider).toBe('deepseek');
    });

    await screen.findByText('已保存');
  });

});
