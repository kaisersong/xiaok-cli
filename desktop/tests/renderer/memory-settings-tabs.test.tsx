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

vi.mock('../../renderer/src/components/settings/LocalMemoryStatsCard', () => ({ LocalMemoryStatsCard: () => <input aria-label="synthetic content search" /> }));
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

describe('historical memory tabs through actual DesktopSettings', () => {
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

  it('preserves historical memory-tab arrow and home/end focus navigation in the real settings shell', async()=>{
    renderSettings();fireEvent.click(screen.getByRole('button',{name:'记忆管理'}));
    const content=screen.getByRole('tab',{name:'记忆内容'}),configuration=screen.getByRole('tab',{name:'记忆配置'});
    expect(content).toHaveAttribute('aria-selected','true');
    fireEvent.keyDown(content,{key:'ArrowRight'});expect(configuration).toHaveFocus();expect(configuration).toHaveAttribute('aria-selected','true');
    fireEvent.keyDown(configuration,{key:'Home'});expect(content).toHaveFocus();expect(content).toHaveAttribute('tabindex','0');
    fireEvent.keyDown(content,{key:'End'});expect(configuration).toHaveFocus();expect(content).toHaveAttribute('tabindex','-1');
  });
  it('preserves the original content input across memory configuration switching in the real settings shell', async()=>{
    renderSettings();fireEvent.click(screen.getByRole('button',{name:'记忆管理'}));
    const input=screen.getByRole('textbox',{name:'synthetic content search'});fireEvent.change(input,{target:{value:'synthetic retained'}});
    fireEvent.click(screen.getByRole('tab',{name:'记忆配置'}));expect(screen.queryByRole('textbox',{name:'synthetic content search'})).toBeNull();
    expect(await screen.findByTestId('memory-embedding-settings')).toBeVisible();
    fireEvent.click(screen.getByRole('tab',{name:'记忆内容'}));expect(screen.getByRole('textbox',{name:'synthetic content search'})).toHaveValue('synthetic retained');
  });

});
