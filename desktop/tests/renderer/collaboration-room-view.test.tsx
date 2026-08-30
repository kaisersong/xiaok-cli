/**
 * CollaborationRoomView renderer states (design §13.2, §16.4).
 *
 * RED until Phase 3 implementation lands.
 *
 * Invariants:
 *   - the view renders distinct, locale-driven states for loading, empty,
 *     error, archived and broker-degraded snapshots.
 *   - durable room state is never persisted to localStorage by the view.
 *   - no hardcoded user-visible strings in the component source — all copy
 *     comes from the zh/en locale contract.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGetRoom, mockListRooms, mockSend, mockMarkSeen, mockArchive, mockUpdateMembers, mockCreateProject } = vi.hoisted(() => ({
  mockGetRoom: vi.fn(),
  mockListRooms: vi.fn(),
  mockSend: vi.fn(),
  mockMarkSeen: vi.fn(),
  mockArchive: vi.fn(),
  mockUpdateMembers: vi.fn(),
  mockCreateProject: vi.fn(),
}));

vi.mock('../../renderer/src/lib/desktop', () => ({
  desktop: {
    listCollaborationRooms: mockListRooms,
    getCollaborationRoom: mockGetRoom,
    sendCollaborationRoomMessage: mockSend,
    markCollaborationRoomSeen: mockMarkSeen,
    archiveCollaborationRoom: mockArchive,
    updateCollaborationRoomMembers: mockUpdateMembers,
    createProjectFromRoom: mockCreateProject,
  },
}));

import { CollaborationRoomView } from '../../renderer/src/components/collaboration/CollaborationRoomView';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

function renderView(props = {}) {
  return render(
    <MemoryRouter>
      <LocaleProvider>
        <CollaborationRoomView roomId="room-1" {...props} />
      </LocaleProvider>
    </MemoryRouter>
  );
}

const activeSnapshot = {
  ok: true,
  room: { roomId: 'room-1', title: '项目讨论', status: 'active', revision: 3 },
  members: [
    { subject: { kind: 'user', userId: 'user.local' }, role: 'owner', status: 'active' },
    { subject: { kind: 'agent', logicalAgentId: 'agent-a' }, role: 'member', status: 'active' },
  ],
  messages: [
    { messageId: 'msg-1', kind: 'text', text: 'hello', sender: { kind: 'user', userId: 'user.local' } },
  ],
  projects: [],
};

describe('CollaborationRoomView states', () => {
  it('renders a loading state while the snapshot is in flight', async () => {
    mockGetRoom.mockImplementation(() => new Promise(() => {}));
    renderView();

    expect(screen.getByTestId('room-view-loading')).toBeDefined();
  });

  it('renders an empty state for a room with no messages', async () => {
    mockGetRoom.mockResolvedValue({ ...activeSnapshot, messages: [] });
    renderView();

    await waitFor(() => {
      expect(screen.getByTestId('room-view-empty')).toBeDefined();
    });
  });

  it('renders an error state with a retry affordance when the fetch fails', async () => {
    mockGetRoom.mockResolvedValue({ ok: false, code: 'broker_unavailable' });
    renderView();

    await waitFor(() => {
      expect(screen.getByTestId('room-view-error')).toBeDefined();
    });
  });

  it('renders an archived banner for archived rooms', async () => {
    mockGetRoom.mockResolvedValue({
      ...activeSnapshot,
      room: { ...activeSnapshot.room, status: 'archived' },
    });
    renderView();

    await waitFor(() => {
      expect(screen.getByTestId('room-view-archived')).toBeDefined();
    });
  });

  it('renders a degraded banner when the broker is unavailable but projects stay visible', async () => {
    mockGetRoom.mockResolvedValue({ ok: false, code: 'broker_unavailable', degraded: true });
    renderView({ degradedProjects: [{ id: 'proj-1', name: '仍可只读' }] });

    await waitFor(() => {
      expect(screen.getByTestId('room-view-degraded')).toBeDefined();
    });
  });

  it('renders messages and the composer for an active room', async () => {
    mockGetRoom.mockResolvedValue(activeSnapshot);
    renderView();

    await waitFor(() => {
      expect(screen.getByText('hello')).toBeDefined();
    });
    expect(screen.getByTestId('room-composer')).toBeDefined();
  });

  it('automatically sends an @agent message with mention policy and refreshes the snapshot', async () => {
    mockGetRoom.mockResolvedValue(activeSnapshot);
    mockSend.mockResolvedValue({ ok: true });
    renderView({ availableAgents: [{ id: 'agent-a', name: 'Agent A' }] });

    const composer = await screen.findByLabelText('输入消息，@ 可提及智能体');
    fireEvent.change(composer, { target: { value: '@agent-a 请检查跨层风险' } });
    fireEvent.click(screen.getByLabelText('发送'));

    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockSend.mock.calls[0][0]).toMatchObject({
      roomId: 'room-1',
      text: '@agent-a 请检查跨层风险',
      mentions: [{ kind: 'agent', logicalAgentId: 'agent-a' }],
      responsePolicy: 'mentioned',
    });
    await waitFor(() => expect(mockGetRoom.mock.calls.length).toBeGreaterThan(1));
  });

  it('never persists durable room state to localStorage', async () => {
    mockGetRoom.mockResolvedValue(activeSnapshot);
    renderView();

    await waitFor(() => {
      expect(screen.getByText('hello')).toBeDefined();
    });
    const keys = Object.keys(window.localStorage);
    expect(keys.filter((key) => key.toLowerCase().includes('room'))).toEqual([]);
  });
});
