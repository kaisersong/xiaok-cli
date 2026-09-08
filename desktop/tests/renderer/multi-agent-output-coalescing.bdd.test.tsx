import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MultiAgentPanel } from '../../renderer/src/components/MultiAgentPanel';
import { MultiAgentConnection } from '../../renderer/src/lib/multi-agent-connection';
import { MultiAgentProjection } from '../../renderer/src/lib/multi-agent-projection';
import { buildAgentOutputView } from '../../renderer/src/lib/multi-agent-output-view';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import type { DesktopAgentSnapshot, MultiAgentDesktopAPI, MultiAgentDurableEvent, MultiAgentGroupSnapshot } from '../../shared/multi-agent-types';

const disposals: Array<() => void> = [];
afterEach(() => { cleanup(); disposals.splice(0).forEach(dispose => dispose()); });
const root: DesktopAgentSnapshot = { id: 'root_g', parentId: null, taskName: 'main', status: 'completed', turn: 1, turnId: 'turn-1',
  canonicalName: '/root', depth: 0, createdAt: 1, runtimeResident: false, stopState: 'none', closeReason: null, activationState: 'settled',
  resumable: false, unreadMessages: 0, cleanupPending: false, resourcesReleased: true, sessionResident: false, executionActive: false };
function event(seq: number, kind: MultiAgentDurableEvent['kind'], payload: Record<string, unknown>,
  identity: Partial<Pick<MultiAgentDurableEvent, 'agentId' | 'turnId' | 'groupId'>> = {}): MultiAgentDurableEvent {
  return { schemaVersion: 1, channel: 'durable', groupId: 'g', agentId: root.id, turnId: 'turn-1', seq,
    eventId: `event-${seq}`, timestamp: seq, kind, payload, ...identity };
}
function outputs(parts: string[], first = 1) { return parts.map((text, index) => event(index + first, 'output', { text })); }
async function setup(events: MultiAgentDurableEvent[], rootFields: Partial<DesktopAgentSnapshot> = {}, children: DesktopAgentSnapshot[] = []) {
  const snapshot: MultiAgentGroupSnapshot = { threadId: 't', activeGroupId: 'g', threadRevision: 1, group: { groupId: 'g', threadId: 't', bootId: 'boot', historicalOnly: false,
    createdAt: 1, lastSeq: events.at(-1)?.seq ?? 0, byteUsage: 0, currentRootEpoch: 1, nextRootEpoch: 2, mutationBlockedReason: null },
    root: { ...root, ...rootFields }, agents: children, residentAgents: [], lastSeq: events.at(-1)?.seq ?? 0, nextAgentCursor: null,
    counts: { total: children.length, completed: children.length, running: 0, failed: 0, unread: 0 } };
  const api = {
    subscribeLocalExecutionAuthorization: vi.fn<MultiAgentDesktopAPI['subscribeLocalExecutionAuthorization']>(async input => ({ subscriptionId: input.subscriptionId,
      authorization: { bootId: 'boot', permissionRevision: 0, executionAllowed: true, persistenceState: 'confirmed' } })),
    unsubscribeLocalExecutionAuthorization: vi.fn(async () => {}),
    subscribeMultiAgents: vi.fn(async input => ({ subscriptionId: input.subscriptionId, snapshot })), unsubscribeMultiAgents: vi.fn(async () => {}),
    getMultiAgentSnapshot: vi.fn(async () => snapshot),
    getMultiAgentEvents: vi.fn<MultiAgentDesktopAPI['getMultiAgentEvents']>(async input => {
      const items = events.filter(item => item.seq > input.afterSeq).slice(0, input.limit);
      const nextAfterSeq = items.at(-1)?.seq ?? input.afterSeq;
      return { items, headSeq: snapshot.lastSeq, nextAfterSeq, hasMore: nextAfterSeq < snapshot.lastSeq };
    }),
    getAgentContent: vi.fn(),
  } as unknown as MultiAgentDesktopAPI;
  const connection = new MultiAgentConnection(api, 't'); disposals.push(connection.start());
  await vi.waitFor(() => expect(connection.getSnapshot().projection.detailSeq).toBe(snapshot.lastSeq));
  const details = vi.spyOn(connection, 'details');
  const mounted = render(<LocaleProvider><MultiAgentPanel connection={connection} api={api} onSelectGroup={vi.fn()} /></LocaleProvider>);
  if (children.length) fireEvent.click(mounted.container.querySelector('.multi-agent-row')!);
  return { api, connection, details, snapshot, mounted, output: screen.getByTestId('multi-agent-output') };
}
function textBlocks(output: HTMLElement, kind: string) {
  return [...output.querySelectorAll('.multi-agent-event')].filter(block => block.querySelector('small')?.textContent === kind);
}

describe('BDD: retained agent output is rendered as bounded semantic blocks', () => {
  it('O1/O2: a table head outside the final 50 source events is recovered from the existing cache and rendered once without changing durable facts', async () => {
    const body = '| task | value |\n| --- | --- |\n| check_a | 42 |\n| check_b | 42 |\n';
    const events = outputs([...body]); const before = JSON.stringify(events);
    const { output, api, details } = await setup(events);
    expect(within(output).getByRole('table')).toBeVisible();
    expect(within(output).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['task', 'value']);
    expect(within(output).getAllByRole('row')).toHaveLength(3);
    expect(textBlocks(output, '输出')).toHaveLength(1);
    expect(details).toHaveBeenCalledWith(root.id, events.length - 49);
    expect(api.getMultiAgentEvents).toHaveBeenCalledTimes(1); expect(api.getAgentContent).not.toHaveBeenCalled();
    expect(JSON.stringify(events)).toBe(before);
  });

  it('O3: a message between fragments remains at its source position and cannot be folded into an answer', async () => {
    const { output } = await setup([event(1, 'output', { text: '**before**' }), event(2, 'message_sent', {
      message: { sender: { kind: 'user' }, receiverId: root.id, preview: 'interleaved message' } }), event(3, 'output', { text: '**after**' })]);
    const blocks = [...output.querySelectorAll('.multi-agent-event')];
    expect(blocks).toHaveLength(3); expect(blocks[1].textContent).toContain('interleaved message');
    expect(blocks[0].querySelector('strong')?.textContent).toBe('before'); expect(blocks[2].querySelector('strong')?.textContent).toBe('after');
  });

  it.each(['message_consumed', 'tool_finished', 'status', 'cleanup', 'approval'] as const)('O3: hidden %s is still an output boundary', async kind => {
    const { output } = await setup([event(1, 'output', { text: '**left' }), event(2, kind, {}), event(3, 'output', { text: 'right**' })]);
    expect(textBlocks(output, '输出')).toHaveLength(2); expect(output.querySelector('strong')).toBeNull();
  });

  it('O3: same-turn usage is transparent, but another turn is not', async () => {
    const { output } = await setup([event(1, 'output', { text: '**same' }), event(2, 'usage', {}), event(3, 'output', { text: ' turn**' }),
      event(4, 'usage', {}, { turnId: 'next-turn' }), event(5, 'output', { text: 'different' }, { turnId: 'next-turn' })]);
    expect(textBlocks(output, '输出')).toHaveLength(2); expect(output.querySelector('strong')?.textContent).toBe('same turn');
  });

  it('O3: other agents in group sequence gaps do not damage an intact same-agent table', async () => {
    const { output } = await setup([event(1, 'output', { text: '| a | b |\n' }), event(2, 'output', { text: 'foreign' }, { agentId: 'child' }),
      event(3, 'output', { text: '| - | - |\n| one | two |' })]);
    expect(within(output).getByRole('table')).toBeVisible(); expect(output.textContent).not.toContain('foreign');
  });

  it.each(['legacy', 'different-turn', 'truncated'] as const)('O3: %s fragments cannot pretend to be one complete answer', async variant => {
    const identity = variant === 'legacy' ? { turnId: undefined } : {};
    const { output } = await setup([event(1, 'output', { text: '**left', truncated: variant === 'truncated' }, identity),
      event(2, 'output', { text: 'right**' }, variant === 'different-turn' ? { turnId: 'other' } : identity)]);
    expect(textBlocks(output, '输出')).toHaveLength(2); expect(output.querySelector('strong')).toBeNull();
    if (variant === 'truncated') expect(within(output).getAllByText('仅显示部分内容').length).toBeGreaterThan(0);
  });

  it('O4: exact same-turn output/result echo folds once, without suppressing a distinct snapshot summary', async () => {
    const { output } = await setup([...outputs(['**answer', '**']), event(3, 'usage', {}), event(4, 'result', { preview: '**answer**', truncated: false })],
      { lastResult: '**answer**', resultSummary: 'answer summary' });
    expect(textBlocks(output, '输出')).toHaveLength(0); expect(textBlocks(output, '结果')).toHaveLength(1);
    expect(output.querySelectorAll('strong')).toHaveLength(1); expect(output.textContent).toContain('answer summary');
  });

  it('O5: history beyond ten cache pages is bounded and labelled partial without automatic saved-content loading', async () => {
    const events = outputs(Array.from({ length: 551 }, (_, index) => index === 0 ? 'old-head' : 'x'));
    const { output, api, details } = await setup(events, { resultContentId: 'saved' });
    expect(details.mock.calls.length).toBeLessThanOrEqual(10);
    expect(textBlocks(output, '输出')).toHaveLength(1); expect(output.textContent).not.toContain('old-head');
    expect(within(output).getAllByText('仅显示部分内容').length).toBeGreaterThan(0);
    expect(within(output).getByRole('button', { name: '读取已保存内容' })).toBeVisible(); expect(api.getAgentContent).not.toHaveBeenCalled();
  });

  it('O5: clipping to fifty display entries remains explicit and keeps the newest message', async () => {
    const { output } = await setup(Array.from({ length: 51 }, (_, index) => event(index + 1, 'message_sent', {
      message: { sender: { kind: 'user' }, receiverId: root.id, preview: `message-${index}` } })));
    expect(output.querySelectorAll('.multi-agent-event')).toHaveLength(50); expect(output.textContent).toContain('message-50');
    expect(within(output).getAllByText('仅显示部分内容').length).toBeGreaterThan(0);
  });

  it('O5: a real projection eviction with a short final page cannot masquerade as a complete cached history', async () => {
    const { snapshot } = await setup([]);
    const events = [event(1, 'status', { agent: { ...root, status: 'pending' } }), ...outputs(['lost-head', 'b', 'c', 'd', 'e'], 2)];
    const projection = new MultiAgentProjection('t', 'eviction', undefined, { maxEvents: 4, maxBytes: 1024 * 1024 });
    projection.install({ ...snapshot, lastSeq: 6 }); projection.replay(events);
    expect(projection.details(root.id)).toHaveLength(4);
    const view = buildAgentOutputView({ groupId: 'g', agent: root, details: projection.details.bind(projection), userSender: 'user' });
    expect(view.partial).toBe(true); expect(view.entries.map(item => item.text)).toEqual(['bcde']);
  });

  it('O5/B2: a proven initial pending does not clear the partial warning after fifty display entries displace the original table', async () => {
    const events = [event(1, 'status', { agent: { ...root, status: 'pending' } }), event(2, 'output', { text: '| old-head |\n| --- |\n| old-row |' }),
      ...Array.from({ length: 50 }, (_, index) => event(index + 3, 'message_sent', { message: { sender: { kind: 'user' }, receiverId: root.id, preview: `later-${index}` } }))];
    const { output } = await setup(events);
    expect(output.querySelectorAll('.multi-agent-event')).toHaveLength(50); expect(output.textContent).not.toContain('old-head');
    expect(within(output).getAllByText('仅显示部分内容').length).toBeGreaterThan(0);
  });

  it('O6/B3: globally equal empty previews of originally different facts cannot become an exact echo', async () => {
    const events = [event(1, 'output', { text: 'left original answer' }), event(2, 'result', { preview: 'right original answer', truncated: false }),
      ...Array.from({ length: 8 }, (_, index) => event(index + 3, 'artifact', { text: 'x'.repeat(8192) }))];
    const { output } = await setup(events);
    expect(textBlocks(output, '输出')).toHaveLength(1); expect(textBlocks(output, '结果')).toHaveLength(1);
    expect(textBlocks(output, '输出')[0].textContent).toContain('仅显示部分内容'); expect(textBlocks(output, '结果')[0].textContent).toContain('仅显示部分内容');
  });

  it('O6/B3: a proven original exact echo may fold before global clipping, but its retained result must stay partial', async () => {
    const events = [event(1, 'output', { text: 'same original answer' }), event(2, 'result', { preview: 'same original answer', truncated: false }),
      ...Array.from({ length: 8 }, (_, index) => event(index + 3, 'artifact', { text: 'x'.repeat(8192) }))];
    const { output } = await setup(events);
    expect(textBlocks(output, '输出')).toHaveLength(0); expect(textBlocks(output, '结果')).toHaveLength(1);
    expect(textBlocks(output, '结果')[0].textContent).toContain('仅显示部分内容');
  });

  it('O6: per-entry clipping is scalar-safe and cannot fold a partial answer into an exact full result', async () => {
    const body = `${'a'.repeat(8191)}😀TAIL`;
    const { output } = await setup([event(1, 'output', { text: body }), event(2, 'result', { preview: body, truncated: false })]);
    expect(textBlocks(output, '输出')).toHaveLength(1); expect(textBlocks(output, '结果')).toHaveLength(1);
    expect(output.textContent).not.toContain('TAIL'); expect(output.textContent).not.toContain('\ud83d');
    expect(within(output).getAllByText('仅显示部分内容').length).toBeGreaterThan(0);
  });

  it('O6: the total budget covers event text and both snapshot fallback paths, not only output fragments', async () => {
    const events = Array.from({ length: 12 }, (_, index) => event(index + 1, 'artifact', { text: `${index}:${'x'.repeat(8190)}` }));
    const { output } = await setup(events, { resultSummary: 's'.repeat(8192), lastResult: 'r'.repeat(8192) });
    expect(output.textContent!.length).toBeLessThan(67_000);
    expect(output.textContent).toContain('r'.repeat(8192)); expect(within(output).getAllByText('仅显示部分内容').length).toBeGreaterThan(0);
  });

  it('O7: Markdown formatting does not add remote images, executable diagrams, raw HTML or external link actions', async () => {
    const body = '**bold**\n\n[link](https://example.test/) ![image alt](https://example.test/a.png)\n\n<script>bad()</script>\n\n```mermaid\ngraph TD; A-->B\n```';
    const { output } = await setup([event(1, 'output', { text: body })]);
    expect(output.querySelector('strong')?.textContent).toBe('bold'); expect(output.querySelector('a, img, script, svg')).toBeNull();
    expect(output.textContent).toContain('image alt'); expect(output.querySelector('code')?.textContent).toContain('graph TD');
  });

  it('O8: the elapsed-only timer does not rescan or refetch detail pages', async () => {
    const { details, api } = await setup(outputs(['one', ' answer'])); const calls = details.mock.calls.length; const reads = vi.mocked(api.getMultiAgentEvents).mock.calls.length;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
    expect(details).toHaveBeenCalledTimes(calls); expect(api.getMultiAgentEvents).toHaveBeenCalledTimes(reads);
  });

  it('O8: switching agents never carries a root answer into a child answer', async () => {
    const child = { ...root, id: 'child', parentId: root.id, taskName: 'child', canonicalName: '/root/child', depth: 1, turnId: 'child-turn' };
    const { output } = await setup([event(1, 'output', { text: '**root-only**' }), event(2, 'output', { text: '**child-only**' }, { agentId: child.id, turnId: child.turnId })], {}, [child]);
    expect(output.querySelector('strong')?.textContent).toBe('root-only');
    fireEvent.click(screen.getByRole('button', { name: 'child 已完成' }));
    expect(output.querySelector('strong')?.textContent).toBe('child-only'); expect(output.textContent).not.toContain('root-only');
  });

  it('O8: actual connection refresh appends the next retained fragment to the same current-turn block', async () => {
    const events = outputs(['**stream']); const { connection, snapshot, output } = await setup(events);
    expect(output.querySelector('strong')).toBeNull();
    events.push(event(2, 'output', { text: ' done**' })); snapshot.lastSeq = 2;
    act(() => connection.refresh());
    await vi.waitFor(() => expect(output.querySelector('strong')?.textContent).toBe('stream done'));
    expect(textBlocks(output, '输出')).toHaveLength(1);
  });

  it('O4/O6: an older exact snapshot match clipped by the global budget does not suppress the current result fallback', async () => {
    const events = [event(1, 'output', { text: '**current saved result**' }),
      ...Array.from({ length: 8 }, (_, index) => event(index + 2, 'artifact', { text: 'x'.repeat(8192) }))];
    const { output } = await setup(events, { lastResult: '**current saved result**' });
    expect(output.querySelector('strong')?.textContent).toBe('current saved result');
    expect(textBlocks(output, '输出')[0].textContent).toContain('仅显示部分内容');
  });
});
