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
  getSystemOneConfig: vi.fn(),
  saveSystemOneConfig: vi.fn(),
}));

vi.mock('../../renderer/src/api/bridge', () => ({
  api: {
    getConnectorsConfig: mocks.getConnectorsConfig,
    saveConnectorsConfig: mocks.saveConnectorsConfig,
    listConnectorRuntimes: mocks.listConnectorRuntimes,
    testConnectorProvider: mocks.testConnectorProvider,
    getSystemOneConfig: mocks.getSystemOneConfig,
    saveSystemOneConfig: mocks.saveSystemOneConfig,
    getSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }),
    saveSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }),
    getKswarmConfig: vi.fn().mockResolvedValue({ maxConcurrentTasks: 3 }),
    saveKswarmConfig: vi.fn().mockResolvedValue({ maxConcurrentTasks: 3 }),
    listMCPInstalls: vi.fn().mockResolvedValue([]),
    listPluginMcpServers: vi.fn().mockResolvedValue([]),
  },
}));

function connectorsSnapshot() {
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

function systemOneSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    configured: false,
    keySource: 'none' as const,
    keyEnvVar: null,
    baseUrl: 'https://api.typesafe.ai',
    model: 'jev-latest',
    apiKeyMasked: null,
    ...overrides,
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

async function openToolsPane() {
  fireEvent.click(await screen.findByRole('button', { name: '工具管理' }));
  await screen.findByText('搜索 Provider');
  await screen.findByText('SystemOne 辅助决策模型');
}

async function saveCall(): Promise<Record<string, unknown>> {
  await waitFor(() => {
    expect(mocks.saveSystemOneConfig).toHaveBeenCalledTimes(1);
  });
  const calls = mocks.saveSystemOneConfig.mock.calls as Array<[Record<string, unknown>]>;
  return calls[0][0];
}

describe('DesktopSettings SystemOne (Jev) section', () => {
  const KEY = 'tsp_test_key_1234';

  beforeEach(() => {
    (globalThis as Record<string, unknown>).__APP_VERSION__ = 'test-version';
    (globalThis as Record<string, unknown>).__APP_BUILD__ = 'test-build';
    mocks.getConnectorsConfig.mockReset();
    mocks.getSystemOneConfig.mockReset();
    mocks.saveSystemOneConfig.mockReset();
    mocks.getConnectorsConfig.mockResolvedValue(connectorsSnapshot());
    mocks.getSystemOneConfig.mockResolvedValue(systemOneSnapshot());
    mocks.saveSystemOneConfig.mockResolvedValue(
      systemOneSnapshot({ configured: true, keySource: 'config', apiKeyMasked: 'tsp_••••1234' }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (globalThis as Record<string, unknown>).__APP_VERSION__;
    delete (globalThis as Record<string, unknown>).__APP_BUILD__;
  });

  it('renders the SystemOne section with Jev instructions inside the tools pane', async () => {
    renderSettings();

    // 该分区只属于「工具管理」，未切换 tab 前不应存在，否则下面的断言是假阳性。
    await screen.findByRole('button', { name: '工具管理' });
    expect(screen.queryByText('SystemOne 辅助决策模型')).toBeNull();

    await openToolsPane();

    expect(screen.getByText('Jev（TypeSafe）')).toBeInTheDocument();
    expect(screen.getByText(/用途：答案范围已固定的语义判断/)).toBeInTheDocument();
    expect(screen.getByText(/配置方式：填入下方的 TypeSafe API Key 并保存/)).toBeInTheDocument();
    expect(screen.getByText('端点：POST https://api.typesafe.ai/v1/systemone')).toBeInTheDocument();
    expect(screen.getByText('模型：jev-latest')).toBeInTheDocument();
    expect(screen.getByText(/XIAOK_TYPESAFE_API_KEY/)).toBeInTheDocument();
    expect(screen.getByText(/Jev 不会出现在模型列表里，也不会成为默认聊天模型/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存 Jev Key' })).toBeInTheDocument();

    expect(mocks.getSystemOneConfig).toHaveBeenCalled();
  });

  it('shows the masked key when configured, the empty label when not, and the env source', async () => {
    mocks.getSystemOneConfig.mockResolvedValue(systemOneSnapshot({
      configured: true,
      keySource: 'env',
      keyEnvVar: 'XIAOK_TYPESAFE_API_KEY',
      apiKeyMasked: 'xiao••••9999',
    }));

    renderSettings();
    await openToolsPane();

    expect((await screen.findByText('已配置：xiao••••9999')).textContent).toContain('••••');
    expect(screen.getByText('来源：环境变量 XIAOK_TYPESAFE_API_KEY')).toBeInTheDocument();
    expect(screen.queryByText('未配置')).toBeNull();
    expect(screen.getByText('模型：jev-latest')).toBeInTheDocument();

    cleanup();
    mocks.getSystemOneConfig.mockResolvedValue(systemOneSnapshot());
    renderSettings();
    await openToolsPane();

    await screen.findByText('未配置');
    expect(screen.queryByText(/^已配置：/)).toBeNull();
    expect(screen.queryByText(/来源：环境变量/)).toBeNull();
  });

  it('saves the typed key through saveSystemOneConfig and never sends provider fields', async () => {
    renderSettings();
    await openToolsPane();

    const input = screen.getByLabelText('jev-api-key') as HTMLInputElement;
    const saveButton = screen.getByRole('button', { name: '保存 Jev Key' });
    expect(saveButton).toBeDisabled();
    expect(input.type).toBe('password');

    fireEvent.change(input, { target: { value: KEY } });
    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);

    const sent = await saveCall();
    // 只允许 systemOne 的字段；绝不出现 providerId/protocol（那是旧的错误实现）。
    expect(Object.keys(sent)).toEqual(['apiKey']);
    expect(sent.apiKey).toBe(KEY);
    expect(sent).not.toHaveProperty('providerId');
    expect(sent).not.toHaveProperty('protocol');

    await screen.findByText('已保存');
    await waitFor(() => {
      expect((screen.getByLabelText('jev-api-key') as HTMLInputElement).value).toBe('');
    });
  });

  it('clears the stored key with an empty apiKey patch only when the key comes from config.json', async () => {
    mocks.getSystemOneConfig.mockResolvedValue(systemOneSnapshot({
      configured: true,
      keySource: 'config',
      apiKeyMasked: 'tsp_••••1234',
    }));
    mocks.saveSystemOneConfig.mockResolvedValue(systemOneSnapshot());

    renderSettings();
    await openToolsPane();

    fireEvent.click(await screen.findByRole('button', { name: '清除' }));

    expect(await saveCall()).toEqual({ apiKey: '' });

    // key 来自环境变量时不能清除（配置文件里没有它）。
    cleanup();
    mocks.saveSystemOneConfig.mockClear();
    mocks.getSystemOneConfig.mockResolvedValue(systemOneSnapshot({
      configured: true,
      keySource: 'env',
      keyEnvVar: 'XIAOK_TYPESAFE_API_KEY',
      apiKeyMasked: 'xiao••••9999',
    }));
    renderSettings();
    await openToolsPane();

    expect(await screen.findByRole('button', { name: '清除' })).toBeDisabled();
  });

  it('shows a readable message on save failure and never leaks the raw JS error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mocks.saveSystemOneConfig.mockRejectedValue(new Error('jev save blew up'));
      renderSettings();
      await openToolsPane();

      fireEvent.change(screen.getByLabelText('jev-api-key'), { target: { value: KEY } });
      fireEvent.click(screen.getByRole('button', { name: '保存 Jev Key' }));

      await screen.findByText('读取 SystemOne 配置失败，请稍后重试');
      // 原始报错只能进 console，不能出现在界面上。
      expect(screen.queryByText('jev save blew up')).toBeNull();
      expect(screen.queryByText('已保存')).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('shows a readable message when loading the config fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mocks.getSystemOneConfig.mockRejectedValue(new TypeError('api.getSystemOneConfig is not a function'));
      renderSettings();
      await openToolsPane();

      await screen.findByText('读取 SystemOne 配置失败，请稍后重试');
      expect(screen.queryByText(/is not a function/)).toBeNull();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
