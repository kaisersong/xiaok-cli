import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

});
