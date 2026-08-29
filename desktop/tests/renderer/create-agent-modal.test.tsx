import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';

const {
  mockCreateAgent,
  mockFetchRuntimes,
  mockFetchLlmProviders,
  mockCreateManagedXiaokAgent,
} = vi.hoisted(() => ({
  mockCreateAgent: vi.fn().mockResolvedValue({ id: 'test-agent' }),
  mockFetchRuntimes: vi.fn().mockResolvedValue([
    { type: 'xiaok', displayName: 'xiaok', description: 'xiaok 内置智能体', detected: true, supported: true },
    { type: 'claude', displayName: 'Claude', description: 'Anthropic Claude CLI', detected: true, supported: true },
    { type: 'kimi', displayName: 'Kimi', description: 'Kimi Agent CLI', detected: true, supported: true },
    { type: 'kiro', displayName: 'Kiro', description: 'Kiro CLI', detected: true, supported: false },
  ]),
  mockFetchLlmProviders: vi.fn().mockResolvedValue(['openai', 'anthropic', 'ollama']),
  mockCreateManagedXiaokAgent: vi.fn().mockResolvedValue({ id: 'managed-xiaok-agent' }),
}));

// Mock KSwarmContext
vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => ({
    createAgent: mockCreateAgent,
    fetchRuntimes: mockFetchRuntimes,
    fetchLlmProviders: mockFetchLlmProviders,
  }),
}));

// Mock bridge API with desktop model config
vi.mock('../../renderer/src/api/bridge', () => ({
  api: {
    getModelConfig: vi.fn().mockResolvedValue({
      defaultProvider: 'anthropic',
      defaultModelId: 'anthropic-claude-sonnet-4-20250514',
      providers: [
        { id: 'anthropic', label: 'Anthropic', type: 'first_party', protocol: 'anthropic', apiKeyConfigured: true },
        { id: 'openai', label: 'OpenAI', type: 'first_party', protocol: 'openai_responses', apiKeyConfigured: false },
        { id: 'deepseek', label: 'DeepSeek', type: 'first_party', protocol: 'openai_legacy', apiKeyConfigured: true },
      ],
      models: [],
      providerProfiles: [],
    }),
    listAvailableModelsForProvider: vi.fn().mockImplementation((providerId: string) => {
      const models: Record<string, Array<{ modelId: string; model: string; label: string }>> = {
        anthropic: [
          { modelId: 'claude-sonnet-4-20250514', model: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
          { modelId: 'claude-opus-4-20250514', model: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
        ],
        deepseek: [
          { modelId: 'deepseek-chat', model: 'deepseek-chat', label: 'DeepSeek Chat' },
          { modelId: 'deepseek-reasoner', model: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
        ],
        openai: [
          { modelId: 'gpt-4o', model: 'gpt-4o', label: 'GPT-4o' },
        ],
      };
      return Promise.resolve(models[providerId] || []);
    }),
    createManagedXiaokAgent: mockCreateManagedXiaokAgent,
  },
}));

import { CreateAgentModal } from '../../renderer/src/components/projects/CreateAgentModal';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderModal() {
  return render(
    <LocaleProvider>
      <CreateAgentModal open={true} onClose={() => {}} />
    </LocaleProvider>
  );
}

function goToStep2() {
  fireEvent.click(screen.getByText('下一步'));
}

describe('CreateAgentModal: xiaok runtime uses managed local runtime', () => {
  it('hides provider/model configuration when runtimeType is xiaok', async () => {
    renderModal();
    goToStep2();

    await waitFor(() => {
      expect(screen.getByText('将直接使用 xiaok 当前桌面环境运行')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('provider-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('model-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('model-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('apikey-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('baseurl-input')).not.toBeInTheDocument();
  });

  it('creates xiaok agent through the managed desktop bridge', async () => {
    renderModal();
    goToStep2();

    fireEvent.change(screen.getByPlaceholderText('例：研究员、编码专家'), { target: { value: 'PO 助手' } });
    fireEvent.change(screen.getByPlaceholderText('系统提示词或行为指令...'), { target: { value: '负责规划' } });
    fireEvent.click(screen.getByRole('button', { name: '创建智能体' }));

    await waitFor(() => {
      expect(mockCreateManagedXiaokAgent).toHaveBeenCalledWith({
        name: 'PO 助手',
        roles: ['worker'],
        instructions: '负责规划',
      });
    });
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });

  it('uses the selected native CLI own configuration instead of the fixed KSwarm provider list', async () => {
    renderModal();
    goToStep2();

    await waitFor(() => {
      expect(screen.getByText('Claude')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Kimi'));

    await waitFor(() => {
      expect(screen.getByText('使用 Kimi 自身的登录、模型与提供商配置。')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('provider-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('model-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('model-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('apikey-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('baseurl-input')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('例：研究员、编码专家'), { target: { value: 'Kimi 研究员' } });
    fireEvent.click(screen.getByRole('button', { name: '创建智能体' }));

    await waitFor(() => {
      expect(mockCreateAgent).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Kimi 研究员',
        runtimeType: 'kimi',
      }));
    });
    expect(mockCreateManagedXiaokAgent).not.toHaveBeenCalled();
  });

  it('does not allow selecting an installed runtime without an execution harness', async () => {
    renderModal();
    goToStep2();

    const kiro = await screen.findByRole('button', { name: /Kiro/ });
    expect(kiro).toBeDisabled();
    expect(kiro).toHaveTextContent('不支持');
  });

  it('resets provider and model when switching runtime', async () => {
    renderModal();
    goToStep2();

    await waitFor(() => {
      expect(screen.getByText('Claude')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Claude'));

    await waitFor(() => {
      expect(screen.getByText('使用 Claude 自身的登录、模型与提供商配置。')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('provider-select')).not.toBeInTheDocument();
  });
});
