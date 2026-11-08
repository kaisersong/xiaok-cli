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
  getModelConfig: vi.fn(),
  saveModelConfig: vi.fn(),
  getKimDecisionConfig: vi.fn(),
  saveKimDecisionConfig: vi.fn(),
  testKimDecisionConnection: vi.fn(),
}));

vi.mock('../../renderer/src/api/bridge', () => ({
  api: {
    getConnectorsConfig: mocks.getConnectorsConfig,
    saveConnectorsConfig: mocks.saveConnectorsConfig,
    listConnectorRuntimes: mocks.listConnectorRuntimes,
    testConnectorProvider: mocks.testConnectorProvider,
    getSystemOneConfig: mocks.getSystemOneConfig,
    saveSystemOneConfig: mocks.saveSystemOneConfig,
    getModelConfig: mocks.getModelConfig,
    saveModelConfig: mocks.saveModelConfig,
    getKimDecisionConfig: mocks.getKimDecisionConfig,
    saveKimDecisionConfig: mocks.saveKimDecisionConfig,
    testKimDecisionConnection: mocks.testKimDecisionConnection,
    getSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }),
    saveSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }),
    getKswarmConfig: vi.fn().mockResolvedValue({ maxConcurrentTasks: 3 }),
    saveKswarmConfig: vi.fn().mockResolvedValue({ maxConcurrentTasks: 3 }),
    listMCPInstalls: vi.fn().mockResolvedValue([]),
    listPluginMcpServers: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../renderer/src/components/settings/LocalMemoryStatsCard', () => ({ LocalMemoryStatsCard: () => null }));
vi.mock('../../renderer/src/components/settings/MemoryModelSettings', () => ({ MemoryModelSettings: () => <div data-testid="memory-embedding-settings" /> }));

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

async function openDecisionPane() {
  fireEvent.click(await screen.findByRole('button', { name: '模型设置' }));
  fireEvent.click(await screen.findByRole('tab', { name: '决策模型' }));
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
    mocks.getModelConfig.mockReset().mockResolvedValue({providers:[],models:[],providerProfiles:[],defaultModelId:null});
    mocks.saveModelConfig.mockReset();
    mocks.getKimDecisionConfig.mockReset().mockResolvedValue({enabled:false,baseUrl:'http://127.0.0.1:8765',attentionThreshold:0.65});
    mocks.saveKimDecisionConfig.mockReset().mockImplementation(async patch=>patch);
    mocks.testKimDecisionConnection.mockReset().mockResolvedValue({available:true,model:'Songkai/K-IM-Deiction',engine:'mlx'});
    localStorage.setItem('xiaok:locale','zh');
    mocks.getConnectorsConfig.mockResolvedValue(connectorsSnapshot());
    mocks.getSystemOneConfig.mockResolvedValue(systemOneSnapshot());
    mocks.saveSystemOneConfig.mockResolvedValue(
      systemOneSnapshot({ configured: true, keySource: 'config', apiKeyMasked: 'tsp_••••1234' }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();
    delete (globalThis as Record<string, unknown>).__APP_VERSION__;
    delete (globalThis as Record<string, unknown>).__APP_BUILD__;
  });

  it('defaults to content and does not expose SystemOne in the tools pane', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('button', {name:'记忆管理'}));
    expect(await screen.findByRole('tab', {name:'记忆内容'})).toHaveAttribute('aria-selected','true');
    expect(screen.queryByText('SystemOne 辅助决策模型')).toBeNull();
    fireEvent.click(screen.getByRole('button', {name:'工具管理'}));
    expect(await screen.findByText('搜索 Provider')).toBeInTheDocument();
    expect(screen.queryByText('SystemOne 辅助决策模型')).toBeNull();
  });
  it('defaults model settings to conversation models and loads decision configs only on entry', async () => {
    renderSettings();
    fireEvent.click(screen.getByRole('button',{name:'模型设置'}));
    expect(screen.getByRole('tab',{name:'对话模型'})).toHaveAttribute('aria-selected','true');
    await waitFor(()=>expect(mocks.getModelConfig).toHaveBeenCalledTimes(1));
    expect(mocks.getSystemOneConfig).not.toHaveBeenCalled();
    expect(mocks.getKimDecisionConfig).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab',{name:'决策模型'}));
    await screen.findByLabelText('启用群消息本地分诊');
    expect(mocks.getSystemOneConfig).toHaveBeenCalledTimes(1);
    expect(mocks.getKimDecisionConfig).toHaveBeenCalledTimes(1);
    expect(mocks.saveModelConfig).not.toHaveBeenCalled();
    expect(mocks.saveSystemOneConfig).not.toHaveBeenCalled();
    expect(mocks.saveKimDecisionConfig).not.toHaveBeenCalled();
  });

  it('keeps memory configuration and routes its single decision link to the new forms', async () => {
    renderSettings();
    fireEvent.click(screen.getByRole('button',{name:'记忆管理'}));
    fireEvent.click(screen.getByRole('tab',{name:'记忆配置'}));
    expect(await screen.findByTestId('memory-embedding-settings')).toBeInTheDocument();
    expect(screen.getByRole('combobox',{name:'压缩模型'})).toBeInTheDocument();
    expect(screen.queryByLabelText('jev-api-key')).toBeNull();
    expect(screen.queryByTestId('kim-decision-settings')).toBeNull();
    expect(mocks.getSystemOneConfig).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'前往决策模型设置'}));
    expect(screen.getByRole('tab',{name:'决策模型'})).toHaveAttribute('aria-selected','true');
    expect(screen.getByRole('tab',{name:'决策模型'})).toHaveFocus();
    await screen.findByLabelText('启用群消息本地分诊');
    expect(screen.getAllByLabelText('jev-api-key')).toHaveLength(1);
    expect(screen.getAllByTestId('kim-decision-settings')).toHaveLength(1);
    expect(mocks.getModelConfig).not.toHaveBeenCalled();
  });

  it('preserves both unsaved decision drafts without refetching when switching model tabs', async () => {
    renderSettings();
    await openDecisionPane();
    const endpoint=await screen.findByLabelText('本地服务地址');
    fireEvent.change(endpoint,{target:{value:'http://127.0.0.1:8766'}});
    fireEvent.change(screen.getByLabelText('jev-api-key'),{target:{value:KEY}});
    fireEvent.click(screen.getByRole('tab',{name:'对话模型'}));
    expect(screen.queryByRole('button',{name:'保存 Jev Key'})).toBeNull();
    fireEvent.click(screen.getByRole('tab',{name:'决策模型'}));
    expect(screen.getByLabelText('jev-api-key')).toHaveValue(KEY);
    expect(screen.getByLabelText('本地服务地址')).toHaveValue('http://127.0.0.1:8766');
    expect(screen.getByRole('button',{name:'检查连接'})).toBeDisabled();
    expect(mocks.getSystemOneConfig).toHaveBeenCalledTimes(1);
    expect(mocks.getKimDecisionConfig).toHaveBeenCalledTimes(1);
    expect(mocks.saveSystemOneConfig).not.toHaveBeenCalled();
    expect(mocks.saveKimDecisionConfig).not.toHaveBeenCalled();
  });

  it('finishes a pending Jev save once across tab changes and keeps K-IM on its existing API', async () => {
    let resolveSave!:(snapshot:ReturnType<typeof systemOneSnapshot>)=>void;
    mocks.saveSystemOneConfig.mockReturnValueOnce(new Promise(resolve=>{resolveSave=resolve;}));
    renderSettings();await openDecisionPane();
    fireEvent.change(screen.getByLabelText('jev-api-key'),{target:{value:KEY}});
    fireEvent.click(screen.getByRole('button',{name:'保存 Jev Key'}));
    fireEvent.click(screen.getByRole('tab',{name:'对话模型'}));
    fireEvent.click(screen.getByRole('tab',{name:'决策模型'}));
    expect(screen.getByRole('button',{name:'保存中…'})).toBeDisabled();
    resolveSave(systemOneSnapshot({configured:true,keySource:'config',apiKeyMasked:'tsp_••••1234'}));
    await screen.findByText('已保存');
    expect(mocks.saveSystemOneConfig).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('jev-api-key')).toHaveValue('');
    fireEvent.click(await screen.findByLabelText('启用群消息本地分诊'));
    fireEvent.click(screen.getByRole('button',{name:'保存设置'}));
    await waitFor(()=>expect(mocks.saveKimDecisionConfig).toHaveBeenCalledWith({enabled:true,baseUrl:'http://127.0.0.1:8765',attentionThreshold:0.65}));
    fireEvent.click(screen.getByRole('button',{name:'检查连接'}));
    await screen.findByText('本地模型服务可用');
    expect(mocks.saveModelConfig).not.toHaveBeenCalled();
  });

  it('supports tab keyboard navigation and an accessible selected panel', async () => {
    renderSettings();fireEvent.click(screen.getByRole('button',{name:'模型设置'}));
    const chat=screen.getByRole('tab',{name:'对话模型'}),decision=screen.getByRole('tab',{name:'决策模型'});
    chat.focus();fireEvent.keyDown(chat,{key:'ArrowRight'});
    expect(decision).toHaveFocus();expect(decision).toHaveAttribute('tabIndex','0');
    expect(chat).toHaveAttribute('tabIndex','-1');
    expect(screen.getByRole('tabpanel',{name:'决策模型'})).toHaveAttribute('id',decision.getAttribute('aria-controls'));
    fireEvent.keyDown(decision,{key:'Home'});expect(chat).toHaveFocus();
    fireEvent.keyDown(chat,{key:'End'});expect(decision).toHaveFocus();
    fireEvent.keyDown(decision,{key:'ArrowLeft'});expect(chat).toHaveFocus();
  });

  it('keeps a pending save rejection visible after returning to decision models', async () => {
    const error=vi.spyOn(console,'error').mockImplementation(()=>{});
    let rejectSave!:(error:Error)=>void;
    mocks.saveSystemOneConfig.mockReturnValueOnce(new Promise((_resolve,reject)=>{rejectSave=reject;}));
    try {
      renderSettings();await openDecisionPane();
      fireEvent.change(screen.getByLabelText('jev-api-key'),{target:{value:KEY}});
      fireEvent.click(screen.getByRole('button',{name:'保存 Jev Key'}));
      fireEvent.click(screen.getByRole('tab',{name:'对话模型'}));
      rejectSave(new Error('private-save-error'));
      await waitFor(()=>expect(error).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole('tab',{name:'决策模型'}));
      expect(await screen.findByText('读取 SystemOne 配置失败，请稍后重试')).toBeInTheDocument();
      expect(screen.getByLabelText('jev-api-key')).toHaveValue(KEY);
      expect(screen.queryByText('private-save-error')).toBeNull();
      expect(mocks.saveSystemOneConfig).toHaveBeenCalledTimes(1);
    } finally { error.mockRestore(); }
  });

  it.each(['pending','failed'])('keeps decision settings accessible when conversation config is %s', async mode => {
    const error=vi.spyOn(console,'error').mockImplementation(()=>{});
    try {
      mocks.getModelConfig.mockImplementation(()=>mode==='pending'?new Promise(()=>{}):Promise.reject(new Error('model_config_unavailable')));
      renderSettings();fireEvent.click(screen.getByRole('button',{name:'模型设置'}));
      fireEvent.click(screen.getByRole('tab',{name:'决策模型'}));
      await screen.findByLabelText('启用群消息本地分诊');
      expect(screen.getByLabelText('jev-api-key')).toBeInTheDocument();
    } finally {error.mockRestore();}
  });

  it('localizes the model tabs and memory handoff in English', async () => {
    localStorage.setItem('xiaok:locale','en');renderSettings();
    fireEvent.click(screen.getByRole('button',{name:'Memory'}));
    fireEvent.click(screen.getByRole('tab',{name:'Memory configuration'}));
    fireEvent.click(screen.getByRole('button',{name:'Open decision model settings'}));
    expect(screen.getByRole('tab',{name:'Decision models'})).toHaveAttribute('aria-selected','true');
    expect(screen.getByRole('tab',{name:'Conversation models'})).toBeInTheDocument();
    await screen.findByLabelText('Enable local group-message triage');
  });
  it('renders the existing Jev form only in the decision models tab', async () => {
    renderSettings();

    // 决策配置只在用户进入决策模型页签后读取。
    await screen.findByRole('button', { name: '工具管理' });
    expect(screen.queryByText('SystemOne 辅助决策模型')).toBeNull();

    await openDecisionPane();

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
    await openDecisionPane();

    expect((await screen.findByText('已配置：xiao••••9999')).textContent).toContain('••••');
    expect(screen.getByText('来源：环境变量 XIAOK_TYPESAFE_API_KEY')).toBeInTheDocument();
    expect(screen.queryByText('未配置')).toBeNull();
    expect(screen.getByText('模型：jev-latest')).toBeInTheDocument();

    cleanup();
    mocks.getSystemOneConfig.mockResolvedValue(systemOneSnapshot());
    renderSettings();
    await openDecisionPane();

    await screen.findByText('未配置');
    expect(screen.queryByText(/^已配置：/)).toBeNull();
    expect(screen.queryByText(/来源：环境变量/)).toBeNull();
  });

  it('saves the typed key through saveSystemOneConfig and never sends provider fields', async () => {
    renderSettings();
    await openDecisionPane();

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
    await openDecisionPane();

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
    await openDecisionPane();

    expect(await screen.findByRole('button', { name: '清除' })).toBeDisabled();
  });

  it('shows a readable message on save failure and never leaks the raw JS error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mocks.saveSystemOneConfig.mockRejectedValue(new Error('jev save blew up'));
      renderSettings();
      await openDecisionPane();

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
      await openDecisionPane();

      await screen.findByText('读取 SystemOne 配置失败，请稍后重试');
      expect(screen.queryByText(/is not a function/)).toBeNull();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
