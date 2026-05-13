/**
 * CreateAgentModal tests: verify that runtimeType=xiaok uses Desktop model config
 * instead of kswarm's hardcoded /llm/providers.
 *
 * Design doc: docs/design/2026-05-13-kswarm-agent-model-bridge.md
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock KSwarmContext
const mockCreateAgent = vi.fn().mockResolvedValue({ id: 'test-agent' });
const mockFetchRuntimes = vi.fn().mockResolvedValue([
  { type: 'xiaok', displayName: 'xiaok', description: 'xiaok 内置智能体', detected: true },
  { type: 'claude', displayName: 'Claude', description: 'Anthropic Claude CLI', detected: true },
]);
const mockFetchLlmProviders = vi.fn().mockResolvedValue(['openai', 'anthropic', 'ollama']);

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

describe('CreateAgentModal: xiaok runtime uses Desktop model config', () => {
  it('shows desktop-configured providers when runtimeType is xiaok', async () => {
    renderModal();
    goToStep2();

    await waitFor(() => {
      const select = screen.getByTestId('provider-select') as HTMLSelectElement;
      const labels = Array.from(select.options).map(o => o.textContent);
      // Should show desktop providers (Anthropic, OpenAI, DeepSeek)
      expect(labels).toContain('跟随平台配置');
      expect(labels.some(l => l?.includes('Anthropic'))).toBe(true);
      expect(labels.some(l => l?.includes('DeepSeek'))).toBe(true);
    });
  });

  it('shows unconfigured API key status for OpenAI', async () => {
    renderModal();
    goToStep2();

    await waitFor(() => {
      const select = screen.getByTestId('provider-select') as HTMLSelectElement;
      const openaiOption = Array.from(select.options).find(o => o.textContent?.includes('OpenAI'));
      expect(openaiOption?.textContent).toContain('未配置 API Key');
    });
  });

  it('shows model dropdown (not text input) when xiaok provider is selected', async () => {
    renderModal();
    goToStep2();

    await waitFor(() => {
      expect(screen.getByTestId('provider-select')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('provider-select'), { target: { value: 'anthropic' } });

    await waitFor(() => {
      // Model should be a <select> (model-select), not <input> (model-input)
      expect(screen.getByTestId('model-select')).toBeInTheDocument();
      expect(screen.queryByTestId('model-input')).not.toBeInTheDocument();
    });
  });

  it('lists available models for selected desktop provider', async () => {
    renderModal();
    goToStep2();

    await waitFor(() => expect(screen.getByTestId('provider-select')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('provider-select'), { target: { value: 'anthropic' } });

    await waitFor(() => {
      const select = screen.getByTestId('model-select') as HTMLSelectElement;
      const values = Array.from(select.options).map(o => o.value);
      expect(values).toContain('claude-sonnet-4-20250514');
      expect(values).toContain('claude-opus-4-20250514');
    });
  });

  it('hides API key and Base URL fields when runtimeType is xiaok', async () => {
    renderModal();
    goToStep2();

    await waitFor(() => expect(screen.getByTestId('provider-select')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('provider-select'), { target: { value: 'anthropic' } });

    await waitFor(() => expect(screen.getByTestId('model-select')).toBeInTheDocument());

    // xiaok should NOT show API key or Base URL
    expect(screen.queryByTestId('apikey-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('baseurl-input')).not.toBeInTheDocument();
  });

  it('uses kswarm providers and text input for non-xiaok runtime', async () => {
    renderModal();
    goToStep2();

    await waitFor(() => {
      expect(screen.getByText('Claude')).toBeInTheDocument();
    });

    // Switch to claude runtime
    fireEvent.click(screen.getByText('Claude'));

    await waitFor(() => {
      const select = screen.getByTestId('provider-select') as HTMLSelectElement;
      // Non-xiaok should use kswarm providers (openai/anthropic/ollama)
      const labels = Array.from(select.options).map(o => o.textContent);
      expect(labels.some(l => l?.includes('Ollama'))).toBe(true);
    });

    fireEvent.change(screen.getByTestId('provider-select'), { target: { value: 'anthropic' } });

    await waitFor(() => {
      // Non-xiaok should have text input for model
      expect(screen.getByTestId('model-input')).toBeInTheDocument();
      expect(screen.queryByTestId('model-select')).not.toBeInTheDocument();
      // Should show API key field
      expect(screen.getByTestId('apikey-input')).toBeInTheDocument();
    });
  });

  it('resets provider and model when switching runtime', async () => {
    renderModal();
    goToStep2();

    await waitFor(() => expect(screen.getByTestId('provider-select')).toBeInTheDocument());

    // Select a provider
    fireEvent.change(screen.getByTestId('provider-select'), { target: { value: 'anthropic' } });
    await waitFor(() => expect(screen.getByTestId('model-select')).toBeInTheDocument());

    // Switch to claude runtime
    fireEvent.click(screen.getByText('Claude'));

    // Provider should be reset
    await waitFor(() => {
      const select = screen.getByTestId('provider-select') as HTMLSelectElement;
      expect(select.value).toBe('');
    });
  });
});
