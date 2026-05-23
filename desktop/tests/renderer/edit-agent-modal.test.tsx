/**
 * EditAgentModal tests: verify dynamic provider/model loading from Desktop config.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock KSwarmContext
const mockUpdateAgent = vi.fn().mockResolvedValue(true);

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => ({
    updateAgent: mockUpdateAgent,
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
        { id: 'openai', label: 'OpenAI', type: 'first_party', protocol: 'openai_responses', apiKeyConfigured: true },
        { id: 'deepseek', label: 'DeepSeek', type: 'first_party', protocol: 'openai_legacy', apiKeyConfigured: true },
        { id: 'kimi', label: 'Kimi', type: 'first_party', protocol: 'openai_legacy', apiKeyConfigured: false },
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
        kimi: [],
      };
      return Promise.resolve(models[providerId] || []);
    }),
  },
}));

import { EditAgentModal } from '../../renderer/src/components/projects/EditAgentModal';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const MOCK_AGENT = {
  id: 'agent-001',
  name: 'Test Agent',
  roles: ['worker'],
  provider: '',
  model: '',
  baseUrl: '',
  instructions: '',
  status: 'idle' as const,
};

function renderModal(agent = MOCK_AGENT) {
  return render(
    <LocaleProvider>
      <EditAgentModal agent={agent as any} onClose={() => {}} />
    </LocaleProvider>
  );
}

describe('EditAgentModal: dynamic provider/model from Desktop config', () => {
  it('uses the same platform-following provider label as create agent', async () => {
    renderModal();

    await waitFor(() => {
      const select = screen.getByTestId('provider-select') as HTMLSelectElement;
      expect(select.options[0].value).toBe('');
      expect(select.options[0].textContent).toBe('跟随平台配置');
    });
  });

  it('shows dynamic providers from Desktop config (not hardcoded list)', async () => {
    renderModal();

    await waitFor(() => {
      const select = screen.getByTestId('provider-select') as HTMLSelectElement;
      const labels = Array.from(select.options).map(o => o.textContent);
      expect(labels.some(l => l?.includes('Anthropic'))).toBe(true);
      expect(labels.some(l => l?.includes('OpenAI'))).toBe(true);
      expect(labels.some(l => l?.includes('DeepSeek'))).toBe(true);
      expect(labels.some(l => l?.includes('Kimi'))).toBe(true);
    });
  });

  it('shows unconfigured API key status for Kimi', async () => {
    renderModal();

    await waitFor(() => {
      const select = screen.getByTestId('provider-select') as HTMLSelectElement;
      const kimiOption = Array.from(select.options).find(o => o.textContent?.includes('Kimi'));
      expect(kimiOption?.textContent).toContain('未配置 API Key');
    });
  });

  it('shows model dropdown when desktop models are available', async () => {
    renderModal();

    await waitFor(() => expect(screen.getByTestId('provider-select')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('provider-select'), { target: { value: 'anthropic' } });

    await waitFor(() => {
      expect(screen.getByTestId('model-select')).toBeInTheDocument();
      expect(screen.queryByTestId('model-input')).not.toBeInTheDocument();
    });
  });

  it('lists available models for selected provider', async () => {
    renderModal();

    await waitFor(() => expect(screen.getByTestId('provider-select')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('provider-select'), { target: { value: 'anthropic' } });

    await waitFor(() => {
      const select = screen.getByTestId('model-select') as HTMLSelectElement;
      const values = Array.from(select.options).map(o => o.value);
      expect(values).toContain('claude-sonnet-4-20250514');
      expect(values).toContain('claude-opus-4-20250514');
    });
  });

  it('shows model text input when no desktop models available', async () => {
    renderModal();

    await waitFor(() => expect(screen.getByTestId('provider-select')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('provider-select'), { target: { value: 'kimi' } });

    await waitFor(() => {
      expect(screen.getByTestId('model-input')).toBeInTheDocument();
      expect(screen.queryByTestId('model-select')).not.toBeInTheDocument();
    });
  });

  it('shows Base URL field for all providers (including anthropic)', async () => {
    renderModal();

    await waitFor(() => expect(screen.getByTestId('provider-select')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('provider-select'), { target: { value: 'anthropic' } });

    await waitFor(() => {
      expect(screen.getByTestId('baseurl-input')).toBeInTheDocument();
    });
  });

  it('shows API Key field for all providers', async () => {
    renderModal();

    await waitFor(() => expect(screen.getByTestId('provider-select')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('provider-select'), { target: { value: 'deepseek' } });

    await waitFor(() => {
      expect(screen.getByTestId('apikey-input')).toBeInTheDocument();
    });
  });

  it('resets model when provider changes', async () => {
    renderModal();

    await waitFor(() => expect(screen.getByTestId('provider-select')).toBeInTheDocument());

    // Select anthropic and pick a model
    fireEvent.change(screen.getByTestId('provider-select'), { target: { value: 'anthropic' } });
    await waitFor(() => expect(screen.getByTestId('model-select')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('model-select'), { target: { value: 'claude-sonnet-4-20250514' } });

    // Switch provider — model should reset
    fireEvent.change(screen.getByTestId('provider-select'), { target: { value: 'deepseek' } });

    await waitFor(() => {
      const select = screen.getByTestId('model-select') as HTMLSelectElement;
      expect(select.value).toBe('');
    });
  });

  it('pre-fills values from existing agent', async () => {
    const agentWithConfig = {
      ...MOCK_AGENT,
      provider: 'openai',
      model: 'gpt-4o',
      baseUrl: 'https://custom.api.com/v1',
    };
    renderModal(agentWithConfig);

    await waitFor(() => {
      const select = screen.getByTestId('provider-select') as HTMLSelectElement;
      expect(select.value).toBe('openai');
    });
  });

  it('calls updateAgent with correct payload on save', async () => {
    renderModal();

    await waitFor(() => expect(screen.getByTestId('provider-select')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('provider-select'), { target: { value: 'anthropic' } });
    await waitFor(() => expect(screen.getByTestId('model-select')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('model-select'), { target: { value: 'claude-sonnet-4-20250514' } });

    const saveBtn = screen.getByText(/保存|Save/i);
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockUpdateAgent).toHaveBeenCalledWith('agent-001', expect.objectContaining({
        name: 'Test Agent',
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      }));
    });
  });
});
