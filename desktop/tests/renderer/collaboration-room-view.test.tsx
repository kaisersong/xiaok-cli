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

const { mockGetRoom, mockListRooms, mockSend, mockMarkSeen, mockArchive, mockUpdateMembers, mockCreateProject, mockProxyGetText, mockKbListCollections, mockKbAddSource, mockOnRoomEvent, roomEventHarness } = vi.hoisted(() => ({
  mockGetRoom: vi.fn(),
  mockListRooms: vi.fn(),
  mockSend: vi.fn(),
  mockMarkSeen: vi.fn(),
  mockArchive: vi.fn(),
  mockUpdateMembers: vi.fn(),
  mockCreateProject: vi.fn(),
  mockProxyGetText: vi.fn(),
  mockKbListCollections: vi.fn(),
  mockKbAddSource: vi.fn(),
  mockOnRoomEvent: vi.fn(),
  roomEventHarness: { listener: null as null | ((event: Record<string, unknown>) => void) },
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
    onCollaborationRoomEvent: mockOnRoomEvent,
  },
}));

vi.mock('../../renderer/src/api', () => ({
  api: {
    listSkills: vi.fn().mockResolvedValue([]),
    onSkillsChanged: vi.fn(() => () => {}),
    selectMaterials: vi.fn(),
  },
}));

vi.mock('../../renderer/src/components/ChatModelPicker', () => ({
  ChatModelPicker: () => <button type="button">model</button>,
}));

vi.mock('../../renderer/src/shared/desktop', () => ({
  getDesktopApi: () => ({
    kswarmProxyGetText: mockProxyGetText,
    kbListCollections: mockKbListCollections,
    kbAddSource: mockKbAddSource,
  }),
}));

import { CollaborationRoomView } from '../../renderer/src/components/collaboration/CollaborationRoomView';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
  roomEventHarness.listener = null;
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
  mockOnRoomEvent.mockImplementation((listener: (event: Record<string, unknown>) => void) => {
    roomEventHarness.listener = listener;
    return () => { if (roomEventHarness.listener === listener) roomEventHarness.listener = null; };
  });

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

  it('keeps the room composer visually continuous with the timeline', async () => {
    mockGetRoom.mockResolvedValue(activeSnapshot);
    renderView();

    await screen.findByText('hello');
    const composerFooter = screen.getByTestId('room-composer');
    expect(composerFooter.className.split(/\s+/)).not.toContain('border-t');
    expect(composerFooter.className.split(/\s+/)).not.toContain('border-[var(--c-border)]');

    const composerInput = screen.getByRole('textbox', {
      name: '输入消息，@ 智能体协作，不 @ 默认与小 K 对话',
    });
    const inputFrame = composerInput.closest('[role="presentation"]') as HTMLElement | null;
    expect(inputFrame?.style.borderStyle).toBe('solid');
    expect(inputFrame?.style.borderWidth).toBe('0.5px');
    expect(inputFrame?.style.borderColor).not.toBe('');
  });

  it('moves project selection into a lightweight message footer action bar', async () => {
    mockGetRoom.mockResolvedValue(activeSnapshot);
    renderView();

    await screen.findByText('hello');
    expect(screen.queryByRole('checkbox', { name: '选为项目背景' })).toBeNull();
    const actionBar = screen.getByTestId('room-message-actions-msg-1');
    expect(actionBar.className).toContain('group-hover:opacity-100');
    expect(actionBar.className).toContain('group-focus-within:opacity-100');

    const selectButton = screen.getByRole('button', { name: '选入项目背景' });
    expect(selectButton.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(selectButton);
    expect(screen.getByRole('button', { name: '移出项目背景' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '基于已选内容创建项目' })).toBeDefined();
  });

  it('copies the raw room message text and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mockGetRoom.mockResolvedValue({
      ...activeSnapshot,
      messages: [{
        messageId: 'msg-copy',
        kind: 'text',
        sender: { kind: 'agent', logicalAgentId: 'agent-a' },
        text: '**原始 Markdown**',
      }],
    });
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: '复制消息' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('**原始 Markdown**'));
    expect(screen.getByRole('button', { name: '已复制' })).toBeDefined();
  });

  it('saves a room message to the first knowledge collection with truthful feedback', async () => {
    mockKbListCollections.mockResolvedValue([{ id: 'kb-default', name: '我的知识库' }]);
    mockKbAddSource.mockResolvedValue({ id: 'source-1' });
    mockGetRoom.mockResolvedValue({
      ...activeSnapshot,
      messages: [{
        messageId: 'msg-kb',
        kind: 'text',
        sender: { kind: 'agent', logicalAgentId: 'agent-a' },
        text: '# 值得收藏\n\n完整正文',
      }],
    });
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: '收藏到知识库' }));

    await waitFor(() => expect(mockKbAddSource).toHaveBeenCalledWith(expect.objectContaining({
      collectionId: 'kb-default',
      kind: 'paste',
      text: '# 值得收藏\n\n完整正文',
    })));
    expect(screen.getByRole('button', { name: '已收藏到知识库' })).toBeDefined();
  });

  it('does not claim a knowledge save when no collection exists', async () => {
    mockKbListCollections.mockResolvedValue([]);
    mockGetRoom.mockResolvedValue(activeSnapshot);
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: '收藏到知识库' }));

    await waitFor(() => expect(screen.getByText('请先在知识库中创建集合')).toBeDefined());
    expect(mockKbAddSource).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '已收藏到知识库' })).toBeNull();
  });

  it('does not add generic message actions to project events', async () => {
    mockGetRoom.mockResolvedValue({
      ...activeSnapshot,
      messages: [{
        messageId: 'msg-event',
        kind: 'project_event',
        sender: { kind: 'system', service: 'kswarm' },
        text: 'project updated',
      }],
    });
    renderView();

    await screen.findByText('project updated');
    expect(screen.queryByTestId('room-message-actions-msg-event')).toBeNull();
  });

  it('uses the shared task composer and removes the legacy response-policy selector', async () => {
    mockGetRoom.mockResolvedValue(activeSnapshot);
    renderView({ availableAgents: [{ id: 'agent-a', name: 'Agent A' }] });

    await screen.findByText('hello');
    expect(screen.queryByLabelText('全员讨论一次')).toBeNull();
    expect(screen.getByRole('button', { name: '添加附件' })).toBeDefined();

    const composer = screen.getByRole('textbox', { name: '输入消息，@ 智能体协作，不 @ 默认与小 K 对话' });
    fireEvent.change(composer, { target: { value: '@' } });
    expect(await screen.findByRole('button', { name: /@all/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /@agent-a.*Agent A/ })).toBeDefined();
  });

  it('submits raw text and attachment paths without renderer-owned response policy', async () => {
    mockGetRoom.mockResolvedValue(activeSnapshot);
    mockSend.mockResolvedValue({ ok: true, wake: { status: 'queued', roomMessageId: 'msg-new', logicalAgentIds: ['agent-a'] } });
    renderView({ availableAgents: [{ id: 'agent-a', name: 'Agent A' }] });

    const composer = await screen.findByRole('textbox', { name: '输入消息，@ 智能体协作，不 @ 默认与小 K 对话' });
    fireEvent.change(composer, { target: { value: '@agent-a 请检查' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockSend.mock.calls[0][0]).toEqual(expect.objectContaining({
      roomId: 'room-1',
      text: '@agent-a 请检查',
      filePaths: [],
    }));
    expect(mockSend.mock.calls[0][0]).not.toHaveProperty('responsePolicy');
    expect(mockSend.mock.calls[0][0]).not.toHaveProperty('mentions');
  });

  it('renders GFM room messages as semantic content instead of raw markers', async () => {
    mockGetRoom.mockResolvedValue({
      ...activeSnapshot,
      messages: [{
        messageId: 'msg-markdown',
        kind: 'text',
        sender: { kind: 'agent', logicalAgentId: 'agent-a' },
        text: [
          '# 核查结论',
          '',
          '- A 已复核',
          '- B 待补证',
          '',
          '| Claim | Status |',
          '| --- | --- |',
          '| A | Pass |',
          '',
          '`FINAL-MEMO-0830`',
          '',
          '[来源](https://example.com/source)',
        ].join('\n'),
      }],
    });

    const { container } = renderView();

    expect(await screen.findByRole('heading', { name: '核查结论', level: 1 })).toBeDefined();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    const table = screen.getByRole('table');
    expect(table.parentElement?.className).toContain('overflow-x-auto');
    expect(container.querySelector('code')?.textContent).toBe('FINAL-MEMO-0830');
    const sourceLink = screen.getByRole('link', { name: '来源' });
    expect(sourceLink.getAttribute('href')).toBe('https://example.com/source');
    expect(sourceLink.getAttribute('target')).toBe('_blank');
    expect(sourceLink.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.queryByText('# 核查结论')).toBeNull();
  });

  it('keeps raw HTML and dangerous links inert and does not linkify local paths', async () => {
    mockGetRoom.mockResolvedValue({
      ...activeSnapshot,
      messages: [{
        messageId: 'msg-untrusted',
        kind: 'text',
        sender: { kind: 'agent', logicalAgentId: 'agent-a' },
        text: [
          '## 安全检查',
          '',
          '<img src=x onerror="window.__roomPwned=1">',
          '',
          '[危险链接](javascript:alert(1))',
          '',
          '/Users/kai/private.txt',
        ].join('\n'),
      }],
    });

    const { container } = renderView();

    expect(await screen.findByRole('heading', { name: '安全检查', level: 2 })).toBeDefined();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img');
    const dangerousLink = Array.from(container.querySelectorAll('a'))
      .find((element) => element.textContent === '危险链接');
    expect(dangerousLink?.getAttribute('href') ?? '').toBe('');
    expect(screen.queryByRole('link', { name: '/Users/kai/private.txt' })).toBeNull();
    expect(screen.getByText('/Users/kai/private.txt')).toBeDefined();
    expect((window as unknown as { __roomPwned?: unknown }).__roomPwned).toBeUndefined();
  });

  it('renders a trusted project artifact card and opens the shared HTML preview', async () => {
    mockProxyGetText.mockResolvedValue('<!doctype html><html><body><h1>Room artifact proof</h1></body></html>');
    mockGetRoom.mockResolvedValue({
      ...activeSnapshot,
      messages: [{
        messageId: 'msg-artifact',
        kind: 'project_event',
        sender: { kind: 'system', service: 'kswarm' },
        text: 'Artifact report.html registered',
        sourceRef: {
          projectId: 'project-1',
          eventType: 'artifact.registered',
          taskId: 'task-report',
          artifactId: 'artifact-report-html',
          artifact: {
            projectId: 'project-1',
            filename: 'report.html',
            kind: 'html',
            mimeType: 'text/html',
          },
        },
      }],
    });

    renderView();

    const artifactCard = await screen.findByTestId('room-artifact-report.html');
    expect(artifactCard.textContent).toContain('report.html');
    expect(artifactCard.textContent).toContain('text/html');
    fireEvent.click(artifactCard);

    await waitFor(() => {
      expect(mockProxyGetText).toHaveBeenCalledWith('/projects/project-1/artifacts/report.html');
    });
    expect(await screen.findByTitle('report.html')).toBeDefined();
  });

  it('does not turn incomplete or non-project file references into artifact cards', async () => {
    mockGetRoom.mockResolvedValue({
      ...activeSnapshot,
      messages: [
        {
          messageId: 'msg-user-path',
          kind: 'text',
          sender: { kind: 'user', userId: 'user.local' },
          text: '/Users/kai/private/report.html',
          sourceRef: {
            projectId: 'project-1',
            artifactId: 'forged-artifact',
            artifact: { filename: 'report.html', mimeType: 'text/html' },
          },
        },
        {
          messageId: 'msg-incomplete-event',
          kind: 'project_event',
          sender: { kind: 'system', service: 'kswarm' },
          text: 'Artifact metadata incomplete',
          sourceRef: {
            projectId: 'project-1',
            eventType: 'artifact.registered',
            artifactId: 'missing-filename',
          },
        },
      ],
    });

    renderView();

    await screen.findByText('/Users/kai/private/report.html');
    expect(screen.queryByTestId('room-artifact-report.html')).toBeNull();
  });

  it('persists the raw @agent text while main owns mention routing', async () => {
    mockGetRoom.mockResolvedValue(activeSnapshot);
    mockSend.mockResolvedValue({ ok: true });
    renderView({ availableAgents: [{ id: 'agent-a', name: 'Agent A' }] });

    const composer = await screen.findByLabelText('输入消息，@ 智能体协作，不 @ 默认与小 K 对话');
    fireEvent.change(composer, { target: { value: '@agent-a 请检查跨层风险' } });
    fireEvent.click(screen.getByLabelText('发送'));

    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockSend.mock.calls[0][0]).toMatchObject({
      roomId: 'room-1',
      text: '@agent-a 请检查跨层风险',
      filePaths: [],
    });
    expect(mockSend.mock.calls[0][0]).not.toHaveProperty('mentions');
    expect(mockSend.mock.calls[0][0]).not.toHaveProperty('responsePolicy');
    await waitFor(() => expect(mockGetRoom.mock.calls.length).toBeGreaterThan(1));
  });

  it('clears the composer and restores the send button as soon as the persisted message is queued', async () => {
    mockGetRoom.mockResolvedValue(activeSnapshot);
    mockSend.mockResolvedValue({
      ok: true,
      wake: {
        status: 'queued',
        roomMessageId: 'msg-user-2',
        logicalAgentIds: ['agent-a'],
      },
    });
    renderView({ availableAgents: [{ id: 'agent-a', name: 'Agent A' }] });

    const composer = await screen.findByLabelText('输入消息，@ 智能体协作，不 @ 默认与小 K 对话');
    fireEvent.change(composer, { target: { value: '@agent-a 请复盘' } });
    const sendButton = screen.getByLabelText('发送') as HTMLButtonElement;
    fireEvent.click(sendButton);

    await waitFor(() => expect((composer as HTMLTextAreaElement).value).toBe(''));
    fireEvent.change(composer, { target: { value: '下一条消息' } });
    expect(sendButton.disabled).toBe(false);
    expect(screen.getByTestId('room-discussion-pending').textContent).toContain('1');
  });

  it('refreshes only for the current room and clears the matching pending discussion on settlement', async () => {
    mockGetRoom.mockResolvedValue(activeSnapshot);
    mockSend.mockResolvedValue({
      ok: true,
      wake: {
        status: 'queued',
        roomMessageId: 'msg-user-3',
        logicalAgentIds: ['agent-a'],
      },
    });
    renderView({ availableAgents: [{ id: 'agent-a', name: 'Agent A' }] });

    const composer = await screen.findByLabelText('输入消息，@ 智能体协作，不 @ 默认与小 K 对话');
    fireEvent.change(composer, { target: { value: '@agent-a 请复盘' } });
    fireEvent.click(screen.getByLabelText('发送'));
    await screen.findByTestId('room-discussion-pending');
    const callsAfterSend = mockGetRoom.mock.calls.length;

    roomEventHarness.listener?.({
      type: 'wake_settled',
      roomId: 'room-other',
      roomMessageId: 'msg-user-3',
      logicalAgentId: 'agent-a',
      outcome: 'completed',
      remaining: 0,
    });
    await Promise.resolve();
    expect(mockGetRoom.mock.calls.length).toBe(callsAfterSend);

    roomEventHarness.listener?.({
      type: 'wake_settled',
      roomId: 'room-1',
      roomMessageId: 'msg-user-3',
      logicalAgentId: 'agent-a',
      outcome: 'completed',
      remaining: 0,
    });
    await waitFor(() => expect(mockGetRoom.mock.calls.length).toBeGreaterThan(callsAfterSend));

    roomEventHarness.listener?.({
      type: 'discussion_settled',
      roomId: 'room-1',
      roomMessageId: 'msg-user-3',
      completed: ['agent-a'],
      failed: [],
    });
    await waitFor(() => expect(screen.queryByTestId('room-discussion-pending')).toBeNull());
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
