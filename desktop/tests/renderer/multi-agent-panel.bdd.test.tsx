import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MultiAgentPanel } from '../../renderer/src/components/MultiAgentPanel';
import { MultiAgentConnection } from '../../renderer/src/lib/multi-agent-connection';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import type { MultiAgentDesktopAPI, MultiAgentDurableEvent, MultiAgentGroupSnapshot } from '../../shared/multi-agent-types';

const stops: Array<() => void> = [];
afterEach(() => { cleanup(); for (const stop of stops.splice(0)) stop(); });
function setup(historical = false, presentation = false, incomplete = false, events: MultiAgentDurableEvent[] = []) {
  const child = { id: 'child', parentId: 'root_g', taskName: 'review', status: 'completed', turn: 2, resumable: true, unreadMessages: 1,
    cleanupPending: false, resourcesReleased: false, sessionResident: true, executionActive: false, usage: { inputTokens: 120, outputTokens: 30 },
    ...(presentation ? { presentationOrdinal: 1, turnId: 'turn-2', phase: 'model', taskSummary: 'Inspect source', toolsCompleted: 3, toolsFailed: 1, toolCounts: { read: 2, grep: 1 }, toolStatisticsComplete: !incomplete, resultSummary: 'Verified final result', lastResult: 'Verified final result' } : {}) };
  const snapshot = { threadId: 't', activeGroupId: 'g', threadRevision: 1, group: { groupId: 'g', historicalOnly: historical }, root: { ...child, id: 'root_g', parentId: null, taskName: 'main' },
    agents: presentation ? Array.from({ length: 20 }, (_, index) => ({ ...child, id: `child-${index + 1}`, presentationOrdinal: index + 1, resourcesReleased: true })) : [child],
    residentAgents: presentation ? [] : [child], lastSeq: events.length, nextAgentCursor: null, counts: { total: presentation ? 20 : 1, completed: 1, running: 0, failed: 0, unread: 1 } } as MultiAgentGroupSnapshot;
  const api = {
    subscribeLocalExecutionAuthorization: vi.fn<MultiAgentDesktopAPI['subscribeLocalExecutionAuthorization']>(async input => ({
      subscriptionId: input.subscriptionId, authorization: { bootId: 'boot', permissionRevision: 0, executionAllowed: true, persistenceState: 'confirmed' } })),
    unsubscribeLocalExecutionAuthorization: vi.fn(async () => {}),
    subscribeMultiAgents: vi.fn(async input => ({ subscriptionId: input.subscriptionId, snapshot })), unsubscribeMultiAgents: vi.fn(async () => {}),
    getMultiAgentSnapshot: vi.fn(async () => snapshot),
    getMultiAgentEvents: vi.fn(async () => ({ items: events, headSeq: events.length, nextAfterSeq: events.length, hasMore: false })),
    sendAgentMessage: vi.fn(async () => ({ operationId: 'op', state: 'unknown' })), followupAgent: vi.fn(), interruptAgent: vi.fn(), closeAgent: vi.fn(),
    getMultiAgentOperation: vi.fn(async () => ({ applyState: 'applied', result: { state: 'applied' } })),
  } as unknown as MultiAgentDesktopAPI;
  const connection = new MultiAgentConnection(api, 't'); stops.push(connection.start());
  const mounted = render(<LocaleProvider><MultiAgentPanel connection={connection} api={api} onSelectGroup={vi.fn()} /></LocaleProvider>);
  return { api, connection, snapshot, rerender: mounted.rerender };
}
describe('BDD: user-facing agent progress and controls', () => {
  it.each(['direct', 'query'] as const)('A15 Given a %s known refusal, Then the draft survives and the current main turn is refreshed without replaying the mutation', async source => {
    const { api } = setup(); await screen.findByText('review');
    const rejected = { operationId: 'op', state: 'completed' as const, outcome: 'rejected' as const, error: 'stale_expected_turn' };
    if (source === 'direct') vi.mocked(api.sendAgentMessage).mockResolvedValue(rejected);
    else vi.mocked(api.getMultiAgentOperation).mockResolvedValue({ groupId: 'g', operationId: 'op', command: 'send', requestHash: 'hash', applyState: 'applied', result: rejected });
    fireEvent.change(screen.getByLabelText('补充说明'), { target: { value: 'keep refused draft' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    if (source === 'query') {
      await screen.findByText('处理结果未知，请查询操作状态后再决定是否重试');
      fireEvent.click(screen.getByRole('button', { name: '查询操作状态' }));
    }
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '发送消息' })).toBeEnabled());
    expect(screen.getByLabelText('补充说明')).toHaveValue('keep refused draft');
    await vi.waitFor(() => expect(api.getMultiAgentSnapshot).toHaveBeenCalledTimes(1));
    expect(api.sendAgentMessage).toHaveBeenCalledTimes(1); expect(screen.queryByRole('button', { name: '查询操作状态' })).toBeNull();
  });

  it('A15 Given a genuine transport rejection and no receipt, Then the same draft remains locked and neither query nor refresh replays it', async () => {
    const { api, connection } = setup(); await screen.findByText('review');
    vi.mocked(api.sendAgentMessage).mockRejectedValue(new Error('transport disconnected'));
    vi.mocked(api.getMultiAgentOperation).mockResolvedValue(null);
    fireEvent.change(screen.getByLabelText('补充说明'), { target: { value: 'unknown draft' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await screen.findByText('处理结果未知，请查询操作状态后再决定是否重试');
    fireEvent.click(screen.getByRole('button', { name: '查询操作状态' }));
    await vi.waitFor(() => expect(api.getMultiAgentOperation).toHaveBeenCalledTimes(1));
    act(() => connection.refresh());
    await vi.waitFor(() => expect(api.getMultiAgentSnapshot).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled();
    expect(screen.getByLabelText('补充说明')).toHaveValue('unknown draft'); expect(api.sendAgentMessage).toHaveBeenCalledTimes(1);
  });

  it.each(['query', 'direct-refused', 'transport-rejected'] as const)('A15 Given an old %s completion, Then a new main-owned group clears only local state and the late completion cannot mutate the new group or replay the old command', async source => {
    const { api, snapshot, rerender } = setup(); await screen.findByText('review');
    let resolveOld!: (value: any) => void;
    let rejectOld!: (error: Error) => void;
    if (source === 'query') vi.mocked(api.getMultiAgentOperation).mockImplementation(() => new Promise(resolve => { resolveOld = resolve; }));
    else vi.mocked(api.sendAgentMessage).mockImplementation(() => new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; }));
    fireEvent.change(screen.getByLabelText('补充说明'), { target: { value: 'old draft' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    if (source === 'query') {
      await screen.findByText('处理结果未知，请查询操作状态后再决定是否重试');
      fireEvent.click(screen.getByRole('button', { name: '查询操作状态' }));
      await vi.waitFor(() => expect(api.getMultiAgentOperation).toHaveBeenCalledTimes(1));
    } else await vi.waitFor(() => expect(api.sendAgentMessage).toHaveBeenCalledTimes(1));
    const next = { ...snapshot, group: { ...snapshot.group!, groupId: 'new-group' }, threadRevision: 2, activeGroupId: 'new-group', root: null,
      agents: [{ ...snapshot.agents[0], id: 'new-child', parentId: 'root_new-group', taskName: 'new child' }], residentAgents: [] };
    const nextApi = { ...api, subscribeMultiAgents: vi.fn(async input => ({ subscriptionId: input.subscriptionId, snapshot: next })), getMultiAgentSnapshot: vi.fn(async () => next) } as MultiAgentDesktopAPI;
    const connection = new MultiAgentConnection(nextApi, 't'); stops.push(connection.start());
    rerender(<LocaleProvider><MultiAgentPanel connection={connection} api={nextApi} onSelectGroup={vi.fn()} /></LocaleProvider>);
    await screen.findByText('new child');
    fireEvent.change(screen.getByLabelText('补充说明'), { target: { value: 'new draft' } });
    await act(async () => {
      const result = { operationId: 'old', state: 'completed', outcome: 'rejected' };
      if (source === 'transport-rejected') rejectOld(new Error('old connection closed'));
      else resolveOld(source === 'query' ? { applyState: 'applied', result } : result);
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: '查询操作状态' })).toBeNull();
    expect(screen.getByRole('button', { name: '发送消息' })).toBeEnabled(); expect(screen.getByLabelText('补充说明')).toHaveValue('new draft');
    expect(api.sendAgentMessage).toHaveBeenCalledTimes(1); expect(nextApi.getMultiAgentSnapshot).not.toHaveBeenCalled();
  });
  it('A25 Given deletion is pending, Then mutations and a new group are disabled while resource inspection remains available', async () => {
    const { snapshot } = setup(); snapshot.threadDeleteState = 'delete_pending';
    await screen.findByText('review');
    for (const name of ['发送消息', '继续执行', '中断当前轮', '关闭 SubAgent', '新建执行组']) expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(screen.getByRole('button', { name: '工作树与清理状态' })).toBeEnabled();
    expect(screen.getByLabelText('补充说明')).toBeDisabled();
  });
  it('U1/U7 Given a completed child, Then progress shows session residency separately, and an unknown mutation preserves its draft until checked', async () => {
    const { api } = setup(); await screen.findByText('review');
    expect(screen.getByText('会话可继续')).toBeVisible(); expect(screen.getByText('输入 120 / 输出 30 tokens')).toBeVisible();
    fireEvent.change(screen.getByLabelText('补充说明'), { target: { value: 'keep my draft' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await screen.findByText('处理结果未知，请查询操作状态后再决定是否重试');
    expect(screen.getByLabelText('补充说明')).toHaveValue('keep my draft');
    expect(api.sendAgentMessage).toHaveBeenCalledWith(expect.objectContaining({ threadId: 't', groupId: 'g', agentId: 'child', expectedTurn: 2 }));
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled();
  });
  it('U6/U7 Given a historical group, Then lifecycle and message controls cannot write', async () => {
    const { api } = setup(true); await screen.findByText('review');
    expect(screen.getByText('历史记录，只读')).toBeVisible();
    for (const name of ['发送消息', '继续执行', '中断当前轮', '关闭 SubAgent']) expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(api.sendAgentMessage).not.toHaveBeenCalled();
  });

  it('U1 Given twenty same-name historical instances, Then names stay distinct through reorder, all use the same italic class and stats retain the draft', async () => {
    const { connection, snapshot } = setup(false, true); await screen.findByText('双鱼座');
    expect(screen.getByText('天秤座')).toBeVisible(); expect(screen.getByText('双鱼座-2')).toBeVisible();
    const aliases = document.querySelectorAll('.multi-agent-alias'); expect(aliases).toHaveLength(20);
    expect(new Set([...aliases].map(node => node.className)).size).toBe(1);
    for (const node of aliases) expect(node.tagName).toBe('EM');
    expect(screen.getByText('分工：Inspect source')).toBeVisible();
    expect(screen.getByText('3 次工具调用 · 失败 1 次')).toBeVisible();
    expect(screen.getByText('Verified final result')).toBeVisible();
    const composer = screen.getByLabelText('补充说明'); fireEvent.change(composer, { target: { value: 'draft survives progress' } }); composer.focus();
    act(() => connection.installAgentPage([...snapshot.agents].reverse(), connection.beginAgentPage('test')!));
    expect(screen.getByRole('button', { name: /双鱼座 已完成/ })).toHaveAttribute('aria-pressed', 'true');
    expect(composer).toHaveValue('draft survives progress'); expect(composer).toHaveFocus();
  });

  it('U1 Given legacy history with no recorded tool facts, Then unknown is explicit rather than fabricated zero work', async () => {
    setup(); await screen.findByText('review'); expect(screen.getByText('工具统计未记录')).toBeVisible();
    expect(screen.queryByText('0 次工具调用 · 失败 0 次')).not.toBeInTheDocument();
  });

  it('U1 Given incomplete durable statistics, Then a terminal row cannot present a precise tool total', async () => {
    setup(false, true, true); await screen.findByText('双鱼座');
    expect(screen.getByText('工具统计不完整')).toBeVisible(); expect(screen.queryByText('3 次工具调用 · 失败 1 次')).not.toBeInTheDocument();
  });

  it('U1 Given a completed instance with a retained model phase, Then it does not claim that a model is still working', async () => {
    setup(false, true); await screen.findByText('双鱼座');
    expect(screen.queryByText('模型处理中')).not.toBeInTheDocument();
  });

  it.each(['same-turn', 'different-turn', 'legacy', 'truncated', 'message-between'] as const)('U1 Given %s output/result facts, Then only a proven duplicate is folded and history/messages remain', async variant => {
    const event = (seq: number, kind: MultiAgentDurableEvent['kind'], payload: Record<string, unknown>, turnId: string | undefined = 'turn-2'): MultiAgentDurableEvent => ({
      schemaVersion: 1, channel: 'durable', groupId: 'g', agentId: 'child-1', eventId: `event-${seq}`, seq, kind, timestamp: seq, turnId, payload,
    });
    const outputTurn = variant === 'different-turn' ? 'turn-1' : 'turn-2';
    const events = [
      event(1, 'output', { text: 'Verified ' }, outputTurn),
      event(2, 'output', { text: 'final result' }, outputTurn),
      event(3, 'result', { preview: 'Verified final result', truncated: variant === 'truncated' }),
      event(4, 'message_sent', { message: { sender: { kind: 'agent', agentId: 'child-1' }, receiverId: 'root_g', preview: 'Verified final result' } }),
    ];
    if (variant === 'legacy') delete events[2].turnId;
    if (variant === 'message-between') { [events[2], events[3]] = [events[3], events[2]]; events.forEach((item, index) => { item.seq = index + 1; }); }
    setup(false, true, false, events); await screen.findByText('双鱼座');
    const output = screen.getByTestId('multi-agent-output');
    const entries = [...output.querySelectorAll('.multi-agent-event')];
    expect(entries.filter(item => item.querySelector('small')?.textContent === '输出')).toHaveLength(variant === 'same-turn' ? 0 : 1);
    expect(entries.filter(item => item.querySelector('small')?.textContent === '结果')).toHaveLength(1);
    expect(output.querySelectorAll('pre')).toHaveLength(1); // Messages remain literal; answers now render Markdown.
    expect([...output.querySelectorAll('p')].filter(item => item.textContent === 'Verified final result')).toHaveLength(variant === 'same-turn' ? 1 : 2);
    expect(output.textContent).toContain('child-1 → root_g');
  });

  it('U1 Given the matching result is outside the visible window, Then the current snapshot fallback remains and a substring summary is not treated as equal', async () => {
    const events = Array.from({ length: 51 }, (_, index): MultiAgentDurableEvent => ({ schemaVersion: 1, channel: 'durable', groupId: 'g', agentId: 'child-1',
      turnId: 'turn-2', eventId: `event-${index}`, seq: index + 1, timestamp: index,
      kind: index === 0 ? 'result' : 'artifact', payload: index === 0 ? { preview: 'Verified final result', truncated: false } : { text: `artifact-${index}` } }));
    const { connection, snapshot } = setup(false, true, false, events); await screen.findByText('双鱼座');
    expect(screen.getAllByText('Verified final result')).toHaveLength(1);
    act(() => connection.installAgentPage(snapshot.agents.map(agent => agent.id === 'child-1' ? { ...agent, resultSummary: 'Verified' } : agent), connection.beginAgentPage('test')!));
    expect(screen.getByText('Verified')).toBeVisible(); expect(screen.getByText('Verified final result')).toBeVisible();
  });
});
