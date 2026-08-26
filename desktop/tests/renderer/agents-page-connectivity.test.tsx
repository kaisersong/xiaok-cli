import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { mockProbeAgent } = vi.hoisted(() => ({
  mockProbeAgent: vi.fn(),
}));

const agents = Array.from({ length: 10 }, (_, index) => ({
  id: `agent-${index + 1}`,
  name: `Agent ${index + 1}`,
  status: index === 1 ? 'offline' : 'idle',
  ...(index < 2 ? { runtimeType: index === 0 ? 'codex' : 'claude' } : {}),
}));

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => ({
    agents,
    fetchAgents: vi.fn(),
    startAgent: vi.fn(),
    stopAgent: vi.fn(),
    archiveAgent: vi.fn(),
    probeAgent: mockProbeAgent,
    connected: true,
  }),
}));

vi.mock('../../renderer/src/components/projects/EditAgentModal', () => ({ EditAgentModal: () => null }));

import { AgentsTab } from '../../renderer/src/components/projects/AgentsTab';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AgentsPage connectivity check', () => {
  it('does not spend model calls on mount and checks every listed agent with a persistent summary', async () => {
    mockProbeAgent.mockImplementation(async (id: string) => {
      if (id === 'agent-1') return { healthy: true, callability: 'available', durationMs: 10 };
      if (id === 'agent-2') return { healthy: false, callability: 'unavailable', error: 'authentication failed', durationMs: 20 };
      if (id === 'agent-10') throw new Error('probe transport failed');
      return { healthy: true, callability: 'limited', durationMs: 5 };
    });

    render(<LocaleProvider><AgentsTab /></LocaleProvider>);
    expect(mockProbeAgent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '一键检测' }));

    await waitFor(() => expect(mockProbeAgent).toHaveBeenCalledTimes(10));
    expect(new Set(mockProbeAgent.mock.calls.map(([id]) => id))).toEqual(new Set(agents.map(agent => agent.id)));
    expect(await screen.findByText('可用')).toBeInTheDocument();
    expect(screen.getAllByText('受限')).toHaveLength(7);
    expect(screen.getAllByText('不可用')).toHaveLength(2);
    expect(screen.getByText('authentication failed')).toBeInTheDocument();
    expect(screen.getByText('probe transport failed')).toBeInTheDocument();
    expect(screen.getByText('已检测 10 个：可用 1，受限 7，不可用 2')).toBeInTheDocument();
  });
});
