import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { mockUpdateAgent } = vi.hoisted(() => ({ mockUpdateAgent: vi.fn().mockResolvedValue({ id: 'external' }) }));

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => ({ updateAgent: mockUpdateAgent }),
}));
vi.mock('../../renderer/src/api', () => ({
  api: {
    getModelConfig: vi.fn().mockResolvedValue({ providers: [] }),
    listAvailableModelsForProvider: vi.fn().mockResolvedValue([]),
  },
}));

import { EditAgentModal } from '../../renderer/src/components/projects/EditAgentModal';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('EditAgentModal desktop model fallback', () => {
  it('persists the user-controlled fallback preference for an external agent', async () => {
    render(
      <LocaleProvider>
        <EditAgentModal
          agent={{ id: 'external', name: 'External', status: 'offline', runtimeType: 'codex' }}
          onClose={() => {}}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /调用失败时使用 Desktop 当前模型/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(mockUpdateAgent).toHaveBeenCalledWith('external', expect.objectContaining({
      fallbackToDesktopModel: true,
    })));
  });
});
