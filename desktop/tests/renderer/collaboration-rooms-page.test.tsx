import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => ({
    agents: [
      { id: 'xiaok-worker', name: '小 K' },
      { id: 'agent-a', name: 'Agent A' },
    ],
  }),
}));

vi.mock('../../renderer/src/lib/desktop', () => ({
  desktop: {
    listCollaborationRooms: vi.fn(async () => ({ ok: true, rooms: [] })),
    createCollaborationRoom: vi.fn(),
  },
}));

import { CollaborationRoomsPage } from '../../renderer/src/components/collaboration/CollaborationRoomsPage';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('CollaborationRoomsPage', () => {
  it('shows the default Xiaok agent as a checked, non-removable room member', async () => {
    render(
      <MemoryRouter>
        <LocaleProvider>
          <CollaborationRoomsPage />
        </LocaleProvider>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '新建协作空间' }));
    const defaultAgent = screen.getByRole('checkbox', { name: /小 K/ }) as HTMLInputElement;

    expect(defaultAgent.checked).toBe(true);
    expect(defaultAgent.disabled).toBe(true);
  });
});
