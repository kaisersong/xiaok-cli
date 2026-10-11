import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { ChatModelPicker } from '../../renderer/src/components/ChatModelPicker';
import { CreateAgentModal } from '../../renderer/src/components/projects/CreateAgentModal';
import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
const m = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), managed: vi.fn() }));
vi.mock('../../renderer/src/api/bridge', () => ({ api: {
  getModelConfig: m.get, saveModelConfig: m.save, createManagedXiaokAgent: m.managed,
  getServiceStatus: vi.fn(async () => ({ checkedAt: 1, services: [] })),
  getAccountSettings: vi.fn(async () => ({ pipeline_trace_enabled: false, prompt_cache_debug_enabled: false })),
  updateAccountSettings: vi.fn(async () => ({})), getSkillDebugConfig: vi.fn(async () => ({ enabled: false })),
  getKswarmConfig: vi.fn(async () => ({ maxConcurrentTasks: 3 })),
} }));
vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({ useKSwarm: () => ({ createAgent: vi.fn(), fetchRuntimes: async () => [], fetchLlmProviders: async () => [] }) }));
const snapshot = { configPath: 'own', defaultProvider: 'owned', defaultModelId: 'old', providers: [{ id: 'owned', label: 'Owned', type: 'custom', protocol: 'openai_legacy', apiKeyConfigured: false }], models: [{ id: 'old', provider: 'owned', model: 'old', label: 'Old model', isDefault: true }, { id: 'new', provider: 'owned', model: 'new', label: 'New model', isDefault: false }], providerProfiles: [] };
beforeEach(() => { m.get.mockReset().mockResolvedValue(snapshot); m.save.mockReset().mockRejectedValue(Error('model_config_operation_unknown')); m.managed.mockReset().mockRejectedValue(Error('model_config_operation_unknown')); (globalThis as Record<string, unknown>).__APP_VERSION__ = 'test'; (globalThis as Record<string, unknown>).__APP_BUILD__ = 'test'; });
afterEach(() => { cleanup(); delete (globalThis as Record<string, unknown>).__APP_VERSION__; delete (globalThis as Record<string, unknown>).__APP_BUILD__; });
it('shows uncertainty for model selection without a second mutation or fake confirmed new model', async () => {
  render(<LocaleProvider><ChatModelPicker /></LocaleProvider>);
  fireEvent.click(await screen.findByRole('button', { name: '切换默认模型' }));
  fireEvent.click(screen.getByRole('button', { name: /New model/ }));
  await screen.findByText('模型操作结果未确认，请刷新后检查。');
  expect(m.save).toHaveBeenCalledTimes(1); expect(m.get).toHaveBeenCalledTimes(2); // existing one read refresh, not mutation retry
  expect(screen.getByRole('button', { name: '切换默认模型' }).textContent).toContain('Old model');
});
it('keeps the actual managed-agent dialog and displays failure without automatically creating again', async () => {
  const close = vi.fn(); render(<LocaleProvider><CreateAgentModal open onClose={close} /></LocaleProvider>);
  fireEvent.click(screen.getByText('下一步'));
  fireEvent.change(screen.getByPlaceholderText('例：研究员、编码专家'), { target: { value: 'Own agent' } });
  fireEvent.click(screen.getByRole('button', { name: '创建智能体' }));
  await screen.findByText('模型操作结果未确认，请刷新后检查。');
  expect(m.managed).toHaveBeenCalledTimes(1); expect(close).not.toHaveBeenCalled();
  expect((screen.getByRole('button', { name: '创建智能体' }) as HTMLButtonElement).disabled).toBe(false);
});
it('localizes the actual Settings model-load failure instead of displaying the stable technical code', async () => {
  m.get.mockRejectedValue(Error('model_config_operation_unknown'));
  render(<MemoryRouter><LocaleProvider><DesktopSettings onClose={() => {}} /></LocaleProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '模型设置' }));
  await screen.findByText('模型操作结果未确认，请刷新后检查。');
  expect(screen.queryByText('model_config_operation_unknown')).toBeNull(); expect(m.save).not.toHaveBeenCalled();
});
