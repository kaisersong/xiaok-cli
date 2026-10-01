import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatModelPicker } from '../../renderer/src/components/ChatModelPicker';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

const initial = {
  defaultModelId: 'plain',
  providers: [{ id: 'glm', label: 'GLM' }, { id: 'openai', label: 'OpenAI' }],
  models: [
    { id: 'plain', provider: 'glm', model: 'GLM-5.2', label: 'GLM 5.2' },
    { id: 'glm-5.3', provider: 'glm', model: 'GLM-5.3', label: 'GLM 5.3',
      runtimeOptions: { contextLimit: 1_048_576, reasoningEffort: 'high' },
      runtimeConstraints: { reasoningEfforts: ['low', 'high', 'max'] } },
    { id: 'openai-gpt-5.5', provider: 'openai', model: 'gpt-5.5', label: 'GPT-5.5',
      runtimeOptions: { contextLimit: 1_050_000, reasoningEffort: 'medium' },
      runtimeConstraints: { reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'] } },
  ],
};
let snapshot = structuredClone(initial);
const save = vi.fn(async ({ modelId }: { modelId: string }) => {
  snapshot = { ...snapshot, defaultModelId: modelId };
  return structuredClone(snapshot);
});
const update = vi.fn(async ({ modelId, runtimeOptions }: { modelId: string; runtimeOptions: { contextLimit?: number; reasoningEffort: string } }) => {
  snapshot = {
    ...snapshot,
    models: snapshot.models.map(model => model.id === modelId
      ? { ...model, runtimeOptions }
      : model),
  };
  return structuredClone(snapshot);
});
vi.mock('../../renderer/src/api', () => ({
  api: {
    getModelConfig: async () => structuredClone(snapshot),
    saveModelConfig: (...args: Parameters<typeof save>) => save(...args),
    updateModelRuntimeOptions: (...args: Parameters<typeof update>) => update(...args),
  },
}));

beforeEach(() => {
  snapshot = structuredClone(initial);
  save.mockClear();
  update.mockClear();
});
afterEach(cleanup);

it('offers and persists effort only after selecting a supported model', async () => {
  render(<LocaleProvider><ChatModelPicker /></LocaleProvider>);
  fireEvent.click(await screen.findByRole('button', { name: '切换默认模型' }));
  expect(screen.queryByRole('button', { name: /低.*low/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /GLM 5.3/ }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ providerId: 'glm', modelId: 'glm-5.3' }));
  fireEvent.click(await screen.findByRole('button', { name: /低.*low/ }));
  await waitFor(() => expect(update).toHaveBeenCalledWith({
    modelId: 'glm-5.3',
    runtimeOptions: { contextLimit: 1_048_576, reasoningEffort: 'low' },
  }));
  await waitFor(() => expect(screen.getByRole('button', { name: /低.*low/ }).getAttribute('aria-pressed')).toBe('true'));
});

it('shows the GPT-5.5-specific effort tiers and saves xhigh', async () => {
  render(<LocaleProvider><ChatModelPicker /></LocaleProvider>);
  fireEvent.click(await screen.findByRole('button', { name: '切换默认模型' }));
  fireEvent.click(screen.getByRole('button', { name: /GPT-5.5/ }));
  fireEvent.click(await screen.findByRole('button', { name: /极高.*xhigh/ }));
  await waitFor(() => expect(update).toHaveBeenCalledWith({
    modelId: 'openai-gpt-5.5',
    runtimeOptions: { contextLimit: 1_050_000, reasoningEffort: 'xhigh' },
  }));
  expect(screen.queryByRole('button', { name: /最高.*max/ })).toBeNull();
});

it('shows the API tier, the middle default and explains model-relative effort', async () => {
  snapshot.defaultModelId = 'glm-5.3';
  render(<LocaleProvider><ChatModelPicker /></LocaleProvider>);
  fireEvent.click(await screen.findByRole('button', { name: '切换默认模型' }));
  const selected = screen.getByRole('button', { name: /高.*high.*默认/ });
  expect(selected.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText(/仅在当前模型内比较/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /中.*medium/ })).toBeNull();
});
