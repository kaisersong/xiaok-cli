import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalMemoryStatsCard } from '../../renderer/src/components/settings/LocalMemoryStatsCard';
import { zh } from '../../renderer/src/locales/zh';

const api = vi.hoisted(() => ({ memory: {
  stats: vi.fn(), listLayer: vi.fn(), getModelId: vi.fn(), compact: vi.fn(),
}, getModelConfig: vi.fn() }));
vi.mock('../../renderer/src/shared/desktop', () => ({ getDesktopApi: () => api }));
vi.mock('../../renderer/src/contexts/LocaleContext', () => ({ useLocale: () => ({ t: zh }) }));

describe('local memory distillation result UI', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.clearAllMocks(); api.memory.stats.mockResolvedValue({ l0: 17, l1: 17, l2: 0, l3: 0, dbSizeBytes: 0 });
    api.memory.listLayer.mockResolvedValue([]); api.memory.getModelId.mockResolvedValue(null);
    api.getModelConfig.mockResolvedValue({ models: [{ id: 'configured-model', label: 'Current model' }] });
  });
  it('keeps content operations but hides model configuration when embedded in the content tab', async () => {
    render(<LocalMemoryStatsCard showModelConfig={false} />);
    await screen.findByRole('button', { name: zh.desktopSettings.memoryCompact });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('button', {name: zh.desktopSettings.memoryAdd})).toBeInTheDocument();
  });
  it('shows failure and permits retry instead of showing done', async () => {
    api.memory.compact.mockRejectedValueOnce(new Error('quota')); render(<LocalMemoryStatsCard />);
    fireEvent.click(await screen.findByRole('button', { name: zh.desktopSettings.memoryCompact }));
    expect(await screen.findByRole('alert')).toHaveTextContent(zh.desktopSettings.memoryCompactFailed);
    expect(screen.queryByRole('button', { name: zh.desktopSettings.memoryCompactDone })).toBeNull();
    expect(screen.getByRole('button', { name: zh.desktopSettings.memoryCompact })).toBeEnabled();
  });
  it('only accepts a real result and refreshes layer counts', async () => {
    api.memory.compact.mockResolvedValueOnce({ status: 'completed', l1: 0, l2: 3, l3: 2 });
    render(<LocalMemoryStatsCard />);
    await waitFor(() => expect(api.memory.stats).toHaveBeenCalled());
    api.memory.stats.mockResolvedValue({ l0: 17, l1: 17, l2: 3, l3: 2, dbSizeBytes: 0 });
    fireEvent.click(screen.getByRole('button', { name: zh.desktopSettings.memoryCompact }));
    expect(await screen.findByRole('button', { name: zh.desktopSettings.memoryCompactDone })).toBeInTheDocument();
    await waitFor(() => expect(api.memory.stats).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('option', { name: 'Current model' })).toHaveValue('configured-model');
  });
  it('rejects a legacy false/no-op receipt', async () => {
    api.memory.compact.mockResolvedValueOnce(false); render(<LocalMemoryStatsCard />);
    fireEvent.click(await screen.findByRole('button', { name: zh.desktopSettings.memoryCompact }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
