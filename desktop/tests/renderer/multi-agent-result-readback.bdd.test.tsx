import { createHash, randomUUID, webcrypto } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MultiAgentPanel } from '../../renderer/src/components/MultiAgentPanel';
import { MultiAgentConnection } from '../../renderer/src/lib/multi-agent-connection';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator';
import type { DesktopAgentSnapshot, MultiAgentContentPage, MultiAgentDesktopAPI, MultiAgentDurableEvent,
  MultiAgentGroupSnapshot, MultiAgentTransport } from '../../shared/multi-agent-types';

const stops: Array<() => void | Promise<void>> = [];
let digest: ReturnType<typeof vi.fn<typeof webcrypto.subtle.digest>>;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000);
  digest = vi.fn((...args: Parameters<typeof webcrypto.subtle.digest>) => webcrypto.subtle.digest(...args));
  vi.stubGlobal('crypto', { randomUUID, subtle: { digest } });
  localStorage.clear();
});
afterEach(async () => { cleanup(); for (const stop of stops.splice(0).reverse()) await stop(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function contentPage(text: string, fields: Partial<MultiAgentContentPage> = {}): MultiAgentContentPage {
  const bytes = Buffer.from(text);
  // Fixture serialization, not a second reader/checksum implementation.
  return { contentId: 'content-a-1', base64: bytes.toString('base64'), nextOffset: bytes.length, byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), truncated: false, ...fields };
}
function agent(fields: Partial<DesktopAgentSnapshot> = {}): DesktopAgentSnapshot {
  return { id: 'agent-a', parentId: 'root_g', taskName: 'Reader A', canonicalName: '/root/a', depth: 1, status: 'completed',
    turn: 1, turnId: 'turn-a-1', createdAt: 1, executionActive: false, sessionResident: true, runtimeResident: false,
    resourcesReleased: false, cleanupPending: false, resumable: true, stopState: 'none', closeReason: null,
    activationState: 'settled', unreadMessages: 0, resultContentId: 'content-a-1', ...fields };
}
function fixture(options: { threadId?: string; groupId?: string; contentId?: string; historical?: boolean; events?: MultiAgentDurableEvent[] } = {}) {
  const threadId = options.threadId ?? 'thread'; const groupId = options.groupId ?? 'g';
  const events = [...(options.events ?? [])];
  let snapshot: MultiAgentGroupSnapshot = { threadId, threadRevision: 1, activeGroupId: groupId, hasAgentHistory: true,
    threadDeleteState: 'none', group: { groupId, threadId, bootId: 'boot', historicalOnly: Boolean(options.historical),
      createdAt: 1, lastSeq: events.length, byteUsage: 0, currentRootEpoch: 1, nextRootEpoch: 2, mutationBlockedReason: null },
    root: null, agents: [agent({ parentId: `root_${groupId}`, resultContentId: options.contentId ?? 'content-a-1' }),
      agent({ id: 'agent-b', taskName: 'Reader B', canonicalName: '/root/b', parentId: `root_${groupId}`, turnId: 'turn-b-1', resultContentId: 'content-b-1' })],
    residentAgents: [], nextAgentCursor: null, lastSeq: events.length, counts: { total: 2, running: 0, completed: 2, failed: 0, unread: 0 } };
  const listeners = new Map<string, (event: MultiAgentTransport) => void>();
  const api = {
    subscribeLocalExecutionAuthorization: vi.fn<MultiAgentDesktopAPI['subscribeLocalExecutionAuthorization']>(async input => ({
      subscriptionId: input.subscriptionId, authorization: { bootId: 'boot', permissionRevision: 0, executionAllowed: true, persistenceState: 'confirmed' } })),
    unsubscribeLocalExecutionAuthorization: vi.fn(async () => {}),
    subscribeMultiAgents: vi.fn(async (input, receive) => { listeners.set(input.subscriptionId, receive); return { subscriptionId: input.subscriptionId, snapshot }; }),
    unsubscribeMultiAgents: vi.fn(async input => { listeners.delete(input.subscriptionId); }),
    getMultiAgentSnapshot: vi.fn(async () => snapshot),
    getMultiAgentEvents: vi.fn(async input => ({ items: events.filter(event => event.seq > input.afterSeq), nextAfterSeq: snapshot.lastSeq, headSeq: snapshot.lastSeq, hasMore: false })),
    getAgentContent: vi.fn(async () => contentPage('EXPANDED_A_TURN_1')),
    listMultiAgentGroups: vi.fn(async () => ({ items: [snapshot.group!], nextCursor: null })),
    listMultiAgents: vi.fn(async () => ({ items: snapshot.agents, nextCursor: null })),
    sendAgentMessage: vi.fn(async input => ({ operationId: input.operationId, state: 'applied' })),
    followupAgent: vi.fn(async input => ({ operationId: input.operationId, state: 'queued_next_admission', targetAgentId: input.agentId, expectedTurn: 7 })),
    interruptAgent: vi.fn(), closeAgent: vi.fn(), getMultiAgentOperation: vi.fn(),
    getMultiAgentResources: vi.fn(async () => ({ items: [], nextCursor: null })), resetMultiAgentGroup: vi.fn(),
  } as unknown as MultiAgentDesktopAPI;
  const connection = new MultiAgentConnection(api, threadId);
  const start = () => { stops.push(connection.start()); };
  const publish = (envelope: MultiAgentTransport['envelope']) => { for (const [subscriptionId, receive] of listeners) receive({ subscriptionId, envelope }); };
  const update = (fields: Partial<DesktopAgentSnapshot> & { id?: string }) => {
    const id = fields.id ?? 'agent-a'; const updated = { ...snapshot.agents.find(item => item.id === id)!, ...fields };
    const event: MultiAgentDurableEvent = { schemaVersion: 1, channel: 'durable', groupId, eventId: randomUUID(), seq: snapshot.lastSeq + 1,
      agentId: id, turnId: updated.turnId, kind: 'status', timestamp: Date.now(), payload: { agent: updated } };
    events.push(event); snapshot = { ...snapshot, agents: snapshot.agents.map(item => item.id === id ? updated : item), lastSeq: event.seq };
    publish(event);
  };
  const deletion = (state: 'delete_pending' | 'deleted') => {
    snapshot = { ...snapshot, threadRevision: snapshot.threadRevision + 1, threadDeleteState: state,
      ...(state === 'deleted' ? { group: null, root: null, agents: [], residentAgents: [], activeGroupId: null, hasAgentHistory: false } : {}) };
    publish({ channel: 'group_changed', threadId, threadRevision: snapshot.threadRevision, oldGroupId: groupId,
      newGroupId: state === 'deleted' ? null : groupId, threadDeleteState: state, hasAgentHistory: state !== 'deleted' });
  };
  return { api, connection, threadId, groupId, start, update, deletion };
}
async function flush(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); await nextTurn(); await nextTurn(); });
}
async function mount(f = fixture()) {
  f.start();
  const mounted = render(<LocaleProvider><MultiAgentPanel connection={f.connection} api={f.api} onSelectGroup={() => {}} /></LocaleProvider>);
  await flush(); expect(f.connection.getSnapshot().phase).toBe('live');
  return { ...f, ...mounted };
}
function readButton() {
  return screen.getByRole('button', { name: /读取.*内容|Read .*content/i });
}
function expandedText() {
  return [...document.querySelectorAll('.multi-agent-output pre')].map(node => node.textContent ?? '').join('\n');
}
function nextSegment() { return screen.queryByRole('button', { name: /^(下一段|Next segment)$/ }); }
function previousSegment() { return screen.queryByRole('button', { name: /^(上一段|Previous segment)$/ }); }
function collectSavedSegments(checkPage?: () => void) {
  // Exercise rendered controls, not another implementation of the splitter.
  const pages: string[] = [];
  for (let steps = 0; steps < 257; steps++) {
    expect(document.querySelectorAll('.multi-agent-output pre')).toHaveLength(1);
    const page = expandedText(); expect(page.length).toBeLessThanOrEqual(8192);
    expect(Buffer.from(page).toString('utf8')).toBe(page);
    pages.push(page); checkPage?.();
    const next = nextSegment();
    if (!next || next.getAttribute('aria-disabled') === 'true') return pages;
    fireEvent.click(next);
  }
  throw new Error('Visible content never reached its final segment');
}
async function read() { fireEvent.click(readButton()); await flush(); }
async function advance(f: ReturnType<typeof fixture>, fields: Partial<DesktopAgentSnapshot>) {
  act(() => f.update(fields)); await flush(81);
}
async function waitReadSettled(f: ReturnType<typeof fixture>) {
  // Await the actual transport/digest promises, not a guessed number of event
  // loop turns. Deliberately held promises are resolved by their own test first.
  await flush();
  await act(async () => { await Promise.allSettled(vi.mocked(f.api.getAgentContent).mock.results
    .filter(result => result.type === 'return').map(result => result.value)); });
  await flush();
  await act(async () => { await Promise.allSettled(digest.mock.results.filter(result => result.type === 'return').map(result => result.value)); });
  await flush();
  const button = document.querySelector<HTMLButtonElement>('.multi-agent-output button');
  expect(button?.getAttribute('aria-disabled')).not.toBe('true');
  if (button) expect(button.disabled).toBe(false);
}
function storedFixture(text: string, historical = false) {
  const store = new DesktopMultiAgentStore(':memory:', { bootId: randomUUID() }); stops.push(() => store.close());
  const service = new DesktopMultiAgentService({ store, coordinator: new DesktopExecutionCoordinator(), createSession: vi.fn() });
  stops.push(() => service.dispose());
  service.registerThread({ threadId: 'stored-thread', profileId: 'profile', workspaceId: 'workspace', cwd: process.cwd() });
  const group = store.createGroup('stored-thread'); store.putAgent(group.groupId, agent({ parentId: `root_${group.groupId}` }));
  const content = store.putContent(group.groupId, 'agent-a', text);
  if (historical) store.putGroup({ ...store.requireGroup(group.groupId), historicalOnly: true }, true);
  const access = service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 'stored-thread', profileId: 'profile', workspaceId: 'workspace' });
  const f = fixture({ threadId: 'stored-thread', groupId: group.groupId, contentId: content.contentId, historical });
  vi.mocked(f.api.getAgentContent).mockImplementation(async input => service.readContent({ access, groupId: input.groupId, contentId: input.contentId, offset: input.offset ?? 0 }));
  return { ...f, content };
}

describe('R1: real Panel readback identity, not an agentId-only text cache', () => {
  it.each(['next-turn', 'same-turn-new-content'] as const)('Given already loaded text, Then %s immediately hides it without deleting historical events', async change => {
    const f = await mount(); await read(); await waitReadSettled(f);
    expect(expandedText()).toBe('EXPANDED_A_TURN_1');
    await advance(f, change === 'next-turn' ? { turn: 2, turnId: 'turn-a-2', status: 'running', executionActive: true, resultContentId: undefined }
      : { resultContentId: 'replacement-content' });
    expect(expandedText()).not.toContain('EXPANDED_A_TURN_1');
    expect(f.api.getAgentContent).toHaveBeenCalledTimes(1);
  });

  it.each(['first', 'last'] as const)('Given the %s old page is delayed across a new turn, Then it cannot trigger another page or install old text', async stage => {
    const f = await mount(); const pending = deferred<MultiAgentContentPage>();
    const whole = contentPage('FIRSTOLD_TAIL');
    const first = { ...whole, base64: Buffer.from('FIRST').toString('base64'), nextOffset: 5 };
    const last = { ...whole, base64: Buffer.from('OLD_TAIL').toString('base64') };
    if (stage === 'first') vi.mocked(f.api.getAgentContent).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(last);
    else vi.mocked(f.api.getAgentContent).mockResolvedValueOnce(first).mockReturnValueOnce(pending.promise);
    await read();
    await advance(f, { turn: 2, turnId: 'turn-a-2', resultContentId: 'content-a-2' });
    pending.resolve(stage === 'first' ? first : last); await flush(); await waitReadSettled(f);
    expect(f.api.getAgentContent).toHaveBeenCalledTimes(stage === 'first' ? 1 : 2);
    expect(expandedText()).not.toContain('FIRST');
  });

  it('Given A→B→A while A is pending, Then returning to the same tuple cannot resurrect the discarded read token', async () => {
    const f = await mount(); const pending = deferred<MultiAgentContentPage>(); vi.mocked(f.api.getAgentContent).mockReturnValueOnce(pending.promise);
    await read(); fireEvent.click(screen.getByRole('button', { name: /Reader B/ })); fireEvent.click(screen.getByRole('button', { name: /Reader A/ }));
    pending.resolve(contentPage('DISCARDED_A_READ')); await flush(); await waitReadSettled(f);
    expect(expandedText()).not.toContain('DISCARDED_A_READ'); expect(f.api.getAgentContent).toHaveBeenCalledTimes(1);
  });

  it.each(['api-only', 'connection', 'thread', 'group'] as const)('Given %s changes without unmounting Panel, Then late old bytes cannot enter the new read domain', async change => {
    const f = await mount(); const pending = deferred<MultiAgentContentPage>(); vi.mocked(f.api.getAgentContent).mockReturnValueOnce(pending.promise); await read();
    const next = fixture({ threadId: change === 'thread' ? 'other-thread' : f.threadId, groupId: change === 'group' ? 'other-group' : f.groupId });
    if (change !== 'api-only') next.start();
    f.rerender(<LocaleProvider><MultiAgentPanel connection={change === 'api-only' ? f.connection : next.connection} api={next.api} onSelectGroup={() => {}} /></LocaleProvider>);
    await flush(); pending.resolve(contentPage('FOREIGN_READ_DOMAIN')); await flush(); await waitReadSettled(f);
    expect(expandedText()).not.toContain('FOREIGN_READ_DOMAIN'); expect(next.api.getAgentContent).not.toHaveBeenCalled();
  });

  it('Given digest is still pending when the agent advances, Then neither unverified nor late verified old text is committed', async () => {
    const f = await mount(); const pending = deferred<ArrayBuffer>(); digest.mockReturnValueOnce(pending.promise);
    await read();
    expect(expandedText()).not.toContain('EXPANDED_A_TURN_1');
    expect(digest).toHaveBeenCalledTimes(1);
    await advance(f, { turn: 2, turnId: 'turn-a-2', resultContentId: undefined });
    pending.resolve(await webcrypto.subtle.digest('SHA-256', Buffer.from('EXPANDED_A_TURN_1'))); await flush();
    expect(expandedText()).not.toContain('EXPANDED_A_TURN_1');
  });

  it('Given an old read and a new selected-agent command, Then old read finally cannot unlock the pending command', async () => {
    const f = await mount(); const oldRead = deferred<MultiAgentContentPage>(); const command = deferred<Awaited<ReturnType<MultiAgentDesktopAPI['sendAgentMessage']>>>();
    vi.mocked(f.api.getAgentContent).mockReturnValueOnce(oldRead.promise); vi.mocked(f.api.sendAgentMessage).mockReturnValueOnce(command.promise);
    await read(); fireEvent.click(screen.getByRole('button', { name: /Reader B/ })); await flush();
    fireEvent.change(screen.getByLabelText('补充说明'), { target: { value: 'new B command' } }); fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    expect(f.api.sendAgentMessage).toHaveBeenCalledTimes(1);
    oldRead.resolve(contentPage('OLD_READ_CANNOT_UNLOCK')); await flush();
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled();
    command.resolve({ operationId: vi.mocked(f.api.sendAgentMessage).mock.calls[0][0].operationId, state: 'applied' }); await flush(81);
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled(); // draft cleared by its own ACK
    expect(expandedText()).not.toContain('OLD_READ_CANNOT_UNLOCK');
  });

  it.each(['resolve', 'reject'] as const)('Given an abandoned read later %s while B is reading, Then neither old result nor old error can unlock or overwrite B', async outcome => {
    const f = await mount(); const old = deferred<MultiAgentContentPage>(); const current = deferred<MultiAgentContentPage>();
    vi.mocked(f.api.getAgentContent).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    await read(); fireEvent.click(screen.getByRole('button', { name: /Reader B/ })); await read();
    expect(f.api.getAgentContent).toHaveBeenCalledTimes(2);
    if (outcome === 'resolve') old.resolve(contentPage('ABANDONED_A')); else old.reject(new Error('abandoned read failed'));
    await flush();
    expect(readButton()).toHaveAttribute('aria-disabled', 'true');
    expect(document.querySelector('.multi-agent-detail [role="alert"]')).toBeNull(); expect(expandedText()).toHaveLength(0);
    current.resolve(contentPage('CURRENT_B_VERIFIED', { contentId: 'content-b-1' })); await waitReadSettled(f);
    expect(expandedText()).toBe('CURRENT_B_VERIFIED'); expect(f.api.getAgentContent).toHaveBeenCalledTimes(2);
  });

  it.each(['pending', 'loaded'] as const)('Given %s content and delete_pending→deleted, Then inspection is permitted before purge but old content cannot return after deletion', async stage => {
    const f = await mount(); const pending = deferred<MultiAgentContentPage>();
    if (stage === 'pending') vi.mocked(f.api.getAgentContent).mockReturnValueOnce(pending.promise);
    await read(); await flush(); act(() => f.deletion('delete_pending')); await flush(81);
    if (stage === 'loaded') expect(expandedText()).toBe('EXPANDED_A_TURN_1');
    act(() => f.deletion('deleted')); await flush(81);
    pending.resolve(contentPage('LATE_DELETED_BYTES')); await flush();
    expect(f.connection.getSnapshot().projection.threadDeleteState).toBe('deleted');
    expect(expandedText()).toBe(''); expect(f.api.getAgentContent).toHaveBeenCalledTimes(1);
  });

  it('Given unmount while the first page is pending, Then late bytes never trigger another page', async () => {
    const f = await mount(); const pending = deferred<MultiAgentContentPage>(); vi.mocked(f.api.getAgentContent).mockReturnValueOnce(pending.promise);
    await read(); f.unmount(); pending.resolve(contentPage('FIRST', { byteLength: 10, nextOffset: 5 })); await flush();
    expect(f.api.getAgentContent).toHaveBeenCalledTimes(1); expect(document.querySelector('.multi-agent-panel')).toBeNull();
  });
});

describe('R2/R3: real Panel consumes and validates the existing byte-page contract', () => {
  it.each(['boundary', 'leading-bom', 'exact-2mib', 'empty'] as const)('Given %s text from actual SQLite/service byte pages, Then displayed bytes exactly match the stored result', async variant => {
    const source = variant === 'empty' ? '' : variant === 'exact-2mib' ? 'x'.repeat(2 * 1024 * 1024 - 4) + '😀'
      : (variant === 'leading-bom' ? '\uFEFF' : '') + 'x'.repeat(44 * 1024 - 1) + '😀中文_REAL_STORED_TAIL';
    const f = storedFixture(source); await mount(f); await read(); await waitReadSettled(f);
    if (variant === 'boundary' || variant === 'leading-bom') expect(vi.mocked(f.api.getAgentContent).mock.calls.map(([input]) => input.offset)).toEqual([0, 44 * 1024]);
    const displayed = collectSavedSegments().join('');
    expect(createHash('sha256').update(displayed).digest('hex')).toBe(f.content.sha256);
    expect(displayed).toBe(source);
    expect(f.content.truncated).toBe(false);
    if (variant === 'empty') { expect(digest).toHaveBeenCalledTimes(1); expect(document.querySelector('.multi-agent-output pre')).not.toBeNull(); }
  });

  it.each([
    ['wrong-content-id', { contentId: 'foreign-content' }], ['negative-length', { byteLength: -1 }],
    ['nan-length', { byteLength: NaN }], ['fractional-length', { byteLength: 0.5 }],
    ['offset-past-total', { byteLength: 1 }], ['fractional-offset', { nextOffset: 0.5 }],
    ['negative-offset', { nextOffset: -1 }], ['oversized-total', { byteLength: 2 * 1024 * 1024 + 1 }],
    ['invalid-base64', { base64: '###' }], ['noncanonical-base64', { base64: contentPage('UNTRUSTED_PAGE').base64.replace(/^(.{4})/, '$1 ') }],
    ['missing-hash', { sha256: '' }], ['wrong-hash', { sha256: '0'.repeat(64) }],
    ['nonboolean-truncated', { truncated: 'false' as unknown as boolean }],
  ] satisfies Array<[string, Partial<MultiAgentContentPage>]>)('Given %s from IPC, Then no partial text is presented as a saved result', async (_name, fields) => {
    const f = await mount(); vi.mocked(f.api.getAgentContent).mockResolvedValue(contentPage('UNTRUSTED_PAGE', fields));
    await read(); await waitReadSettled(f);
    expect(expandedText()).toHaveLength(0);
    expect(document.querySelector('.multi-agent-detail [role="alert"]')).not.toBeNull();
    expect(f.api.getAgentContent).toHaveBeenCalledTimes(1);
  });

  it.each(['sha256', 'truncated', 'byteLength'] as const)('Given %s changes between otherwise valid pages, Then metadata cannot silently change mid-read', async field => {
    const f = await mount(); const whole = contentPage('AB');
    vi.mocked(f.api.getAgentContent).mockResolvedValueOnce(contentPage('A', { ...whole, base64: 'QQ==', nextOffset: 1 }))
      .mockResolvedValueOnce(contentPage('B', { ...whole, base64: 'Qg==', nextOffset: 2,
        ...(field === 'sha256' ? { sha256: '0'.repeat(64) } : field === 'truncated' ? { truncated: true } : { byteLength: 3 }) }));
    await read(); await waitReadSettled(f);
    expect(expandedText()).toHaveLength(0); expect(f.api.getAgentContent).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.multi-agent-detail [role="alert"]')).not.toBeNull();
  });

  it.each(['zero-progress', 'decoded-page-over-64k', 'over-64-pages', 'invalid-utf8'] as const)('Given %s, Then bounded reading refuses without installing corrupt text', async variant => {
    const f = await mount();
    if (variant === 'zero-progress') vi.mocked(f.api.getAgentContent).mockResolvedValue(contentPage('', { byteLength: 2 }));
    else if (variant === 'decoded-page-over-64k') vi.mocked(f.api.getAgentContent).mockResolvedValue(contentPage('x'.repeat(64 * 1024 + 1)));
    else if (variant === 'over-64-pages') {
      const all = contentPage('x'.repeat(65));
      vi.mocked(f.api.getAgentContent).mockImplementation(async input => ({ ...all, base64: 'eA==', nextOffset: (input.offset ?? 0) + 1 }));
    } else {
      const bytes = Buffer.from([0xf0, 0x9f]);
      vi.mocked(f.api.getAgentContent).mockResolvedValue({ contentId: 'content-a-1', base64: bytes.toString('base64'), nextOffset: 2,
        byteLength: 2, truncated: false, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    await read(); await waitReadSettled(f);
    expect(expandedText()).toHaveLength(0); expect(vi.mocked(f.api.getAgentContent).mock.calls.length).toBeLessThanOrEqual(64);
    expect(document.querySelector('.multi-agent-detail [role="alert"]')).not.toBeNull();
  });

  it.each(['subtle-unavailable', 'digest-rejects'] as const)('Given %s, Then digest is mandatory and failures only offer explicit read retry', async variant => {
    const f = await mount(); vi.mocked(f.api.getAgentContent).mockResolvedValue(contentPage(''));
    if (variant === 'subtle-unavailable') vi.stubGlobal('crypto', { randomUUID });
    if (variant === 'digest-rejects') digest.mockRejectedValueOnce(new Error('digest failed'));
    await read(); await waitReadSettled(f);
    expect(document.querySelector('.multi-agent-detail [role="alert"]')).not.toBeNull();
    await flush(15_000); expect(f.api.getAgentContent).toHaveBeenCalledTimes(1);
  });

  it('Given a rejected checksum, Then only a new explicit click retries and verified bytes replace the read error', async () => {
    const f = await mount();
    vi.mocked(f.api.getAgentContent).mockResolvedValueOnce(contentPage('CORRUPT', { sha256: '0'.repeat(64) }))
      .mockResolvedValueOnce(contentPage('VERIFIED_MANUAL_RETRY'));
    await read(); await waitReadSettled(f);
    expect(document.querySelector('.multi-agent-detail [role="alert"]')).not.toBeNull(); expect(expandedText()).toHaveLength(0);
    await flush(15_000); expect(f.api.getAgentContent).toHaveBeenCalledTimes(1);
    await read(); await waitReadSettled(f);
    expect(expandedText()).toBe('VERIFIED_MANUAL_RETRY'); expect(document.querySelector('.multi-agent-detail [role="alert"]')).toBeNull();
    expect(f.api.getAgentContent).toHaveBeenCalledTimes(2); expect(digest).toHaveBeenCalledTimes(2);
  });
});

describe('R4: saved bytes and preview truncation have separate truthful labels', () => {
  it.each(['zh', 'en'] as const)('Given an oversized historical result (%s), Then only saved bytes render with an explicit permanent truncation notice', async language => {
    localStorage.setItem('xiaok:locale', language);
    const source = 'x'.repeat(2 * 1024 * 1024 - 2) + '😀UNSAVED_TAIL';
    const f = storedFixture(source, true); await mount(f);
    const labelBeforeRead = readButton().textContent ?? '';
    await read(); await waitReadSettled(f);
    expect(f.content.truncated).toBe(true); expect(f.content.byteLength).toBe(2 * 1024 * 1024 - 2);
    const displayed = collectSavedSegments(() => {
      expect(/未保存|not saved/.test(document.querySelector('.multi-agent-output')?.textContent ?? '')).toBe(true);
    }).join('');
    expect(createHash('sha256').update(displayed).digest('hex')).toBe(f.content.sha256);
    expect(vi.mocked(f.api.getAgentContent).mock.calls.length).toBe(47);
    const output = document.querySelector('.multi-agent-output')!;
    expect(output.textContent?.includes(String(f.content.byteLength))).toBe(true);
    expect(/未保存|not saved|not retained|was not saved/i.test(output.textContent ?? '')).toBe(true);
    expect(/完整|full/i.test(labelBeforeRead)).toBe(false);
    expect(f.api.followupAgent).not.toHaveBeenCalled();
  });

  it('Given only the event preview is truncated, Then the marker does not claim saved content itself was lost', async () => {
    const event: MultiAgentDurableEvent = { schemaVersion: 1, channel: 'durable', groupId: 'g', agentId: 'agent-a', turnId: 'turn-a-1',
      eventId: 'preview-event', seq: 1, timestamp: 1, kind: 'result', payload: { contentId: 'content-a-1', preview: 'EVENT_PREVIEW', truncated: true } };
    const f = await mount(fixture({ events: [event] })); await read(); await waitReadSettled(f);
    const output = document.querySelector('.multi-agent-output')!;
    expect(output.textContent?.includes('仅显示部分内容')).toBe(true);
    expect(output.textContent?.includes('EXPANDED_A_TURN_1')).toBe(true);
    expect(/未保存|2MiB/.test(output.textContent ?? '')).toBe(false);
  });
});

describe('R5: queued is an immutable submission receipt, not a second live-state owner', () => {
  it.each(['direct', 'operation-query'] as const)('Given a %s ACK for target turn 7 with CAS turn 1, Then later running/completed rows do not turn the receipt into a live waiting claim', async route => {
    const interval = vi.spyOn(globalThis, 'setInterval'); const f = await mount();
    if (route === 'operation-query') {
      vi.mocked(f.api.followupAgent).mockResolvedValueOnce({ operationId: 'transport-placeholder', state: 'unknown' });
      vi.mocked(f.api.getMultiAgentOperation).mockImplementation(async input => ({ groupId: f.groupId, operationId: input.operationId,
        command: 'user_followup', requestHash: 'original-request', applyState: 'applied', result: {
          operationId: input.operationId, state: 'queued_next_admission', targetAgentId: 'agent-a', expectedTurn: 7,
        } }));
    }
    fireEvent.change(screen.getByLabelText('补充说明'), { target: { value: 'future turn request' } });
    fireEvent.click(screen.getByRole('button', { name: '继续执行' })); await flush();
    const call = vi.mocked(f.api.followupAgent).mock.calls[0][0]; expect(call.expectedTurn).toBe(1);
    if (route === 'operation-query') { fireEvent.click(screen.getByRole('button', { name: '查询操作状态' })); await flush(); }
    await advance(f, { turn: 7, turnId: 'turn-a-7', status: 'running', executionActive: true, resumable: false, resultContentId: undefined });
    await advance(f, { status: 'completed', executionActive: false, resumable: true });
    const receipt = [...document.querySelectorAll('.multi-agent-panel > p[role="status"]')].find(node => /请求回执/.test(node.textContent ?? ''));
    expect(receipt).toBeDefined();
    expect(receipt?.textContent).toContain('agent-a'); expect(receipt?.textContent).toContain('7');
    expect(receipt?.textContent).toContain('提交时');
    fireEvent.click(screen.getByRole('button', { name: /Reader B/ }));
    expect(receipt?.textContent).toContain('agent-a'); expect(receipt?.textContent).not.toContain('agent-b');
    const reads = vi.mocked(f.api.getMultiAgentSnapshot).mock.calls.length;
    await flush(15_000);
    expect(f.api.followupAgent).toHaveBeenCalledTimes(1);
    expect(f.api.getMultiAgentOperation).toHaveBeenCalledTimes(route === 'operation-query' ? 1 : 0);
    expect(f.api.getMultiAgentSnapshot).toHaveBeenCalledTimes(reads); expect(interval).toHaveBeenCalledTimes(1);
  });
});

describe('V1–V5: verified saved bytes have one bounded, lossless display segment', () => {
  it('Given actual stored mixed text, Then every visible segment is bounded, both directions preserve bytes, and paging has no transport or digest effects', async () => {
    const source = '甲😀'.repeat(18000) + 'SAVED_LAST_SEGMENT';
    const f = storedFixture(source); await mount(f); const button = readButton(); button.focus(); await read(); await waitReadSettled(f);
    expect(button).toHaveFocus();
    const calls = vi.mocked(f.api.getAgentContent).mock.calls.length; const hashes = digest.mock.calls.length;
    const pages = collectSavedSegments(); expect(pages.length).toBeGreaterThan(1);
    expect(pages.join('')).toBe(source); expect(createHash('sha256').update(pages.join('')).digest('hex')).toBe(f.content.sha256);
    expect(pages.at(-1)).toContain('SAVED_LAST_SEGMENT');
    const next = nextSegment()!; next.focus(); fireEvent.click(next);
    expect(next).toHaveFocus(); expect(expandedText()).toBe(pages.at(-1));
    for (let index = pages.length - 2; index >= 0; index--) { fireEvent.click(previousSegment()!); expect(expandedText()).toBe(pages[index]); }
    const previous = previousSegment()!; previous.focus(); fireEvent.click(previous);
    expect(previous).toHaveFocus(); expect(previous).toHaveAttribute('aria-disabled', 'true'); expect(expandedText()).toBe(pages[0]);
    expect(f.api.getAgentContent).toHaveBeenCalledTimes(calls); expect(digest).toHaveBeenCalledTimes(hashes);
    expect(f.api.followupAgent).not.toHaveBeenCalled(); expect(f.api.sendAgentMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', ''], ['8191', 'x'.repeat(8191)], ['8192', 'x'.repeat(8192)], ['8193', 'x'.repeat(8193)],
    ['surrogate-midpoint', 'x'.repeat(8191) + '😀END'],
    ['bom-crlf-zwj-combining-bidi', '\uFEFF\r\n' + 'x'.repeat(8187) + '👩‍💻e\u0301\u202Eالعربية\u202C\r\n END '],
  ])('Given %s at the display boundary, Then concatenation is byte exact and single-segment results have no pager', async (_name, source) => {
    const f = storedFixture(source); await mount(f); await read(); await waitReadSettled(f);
    const pages = collectSavedSegments(); expect(pages.join('')).toBe(source);
    expect(createHash('sha256').update(pages.join('')).digest('hex')).toBe(f.content.sha256);
    if (source.length <= 8192) { expect(pages).toHaveLength(1); expect(nextSegment()).toBeNull(); expect(previousSegment()).toBeNull(); }
    else { expect(nextSegment()).not.toBeNull(); expect(previousSegment()).not.toBeNull(); }
  });

  it.each(['zh', 'en'] as const)('Given %s labels, Then display segmentation is named independently of saving/truncation', async language => {
    localStorage.setItem('xiaok:locale', language);
    const f = storedFixture('x'.repeat(8193)); await mount(f); await read(); await waitReadSettled(f);
    expect(screen.getByText(language === 'zh' ? '第 1 / 2 段' : 'Segment 1 / 2')).toBeInTheDocument();
    expect(screen.getByText(language === 'zh' ? '已保存内容分段显示，内容未改动。查找和选择仅限当前段。' : 'Saved content is shown in segments without changes. Find and selection apply to the current segment.')).toBeInTheDocument();
    expect(/未保存|not saved/.test(document.querySelector('.multi-agent-output')?.textContent ?? '')).toBe(false);
    fireEvent.click(nextSegment()!);
    expect(screen.getByText(language === 'zh' ? '第 2 / 2 段' : 'Segment 2 / 2')).toBeInTheDocument();
  });

  it('Given activity and command updates, Then the current segment persists, but same-ID manual reread starts at segment one', async () => {
    const f = storedFixture('A'.repeat(8192) + 'B'.repeat(8192) + 'C'); await mount(f); await read(); await waitReadSettled(f);
    fireEvent.click(nextSegment()!); expect(expandedText()).toBe('B'.repeat(8192));
    await advance(f, { lastActivityAt: Date.now() }); expect(expandedText()).toBe('B'.repeat(8192));
    fireEvent.change(screen.getByLabelText('补充说明'), { target: { value: 'context only' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' })); await flush(81);
    expect(f.api.sendAgentMessage).toHaveBeenCalledTimes(1); expect(expandedText()).toBe('B'.repeat(8192));
    await read(); await waitReadSettled(f); expect(expandedText()).toBe('A'.repeat(8192));
  });

  it.each(['turn', 'content', 'agent', 'api', 'connection', 'thread', 'group', 'deleted'] as const)('Given a loaded non-first segment, Then %s invalidation hides it and an old DOM button cannot operate the replacement', async change => {
    const f = await mount(); const aText = 'A'.repeat(8192) + 'OLD_A_PAGE';
    vi.mocked(f.api.getAgentContent).mockResolvedValue(contentPage(aText)); await read(); await waitReadSettled(f);
    const oldNext = nextSegment()!; fireEvent.click(oldNext); expect(expandedText()).toBe('OLD_A_PAGE');
    if (change === 'turn' || change === 'content') await advance(f, change === 'turn'
      ? { turn: 2, turnId: 'turn-a-2', resultContentId: 'new-a' } : { resultContentId: 'new-a' });
    else if (change === 'agent') { fireEvent.click(screen.getByRole('button', { name: /Reader B/ })); await flush(); }
    else if (change === 'deleted') { act(() => f.deletion('deleted')); await flush(81); }
    else {
      const next = fixture({ threadId: change === 'thread' ? 'new-thread' : f.threadId, groupId: change === 'group' ? 'new-group' : f.groupId });
      if (change !== 'api') next.start();
      f.rerender(<LocaleProvider><MultiAgentPanel connection={change === 'api' ? f.connection : next.connection} api={next.api} onSelectGroup={() => {}} /></LocaleProvider>);
      await flush();
    }
    expect(expandedText()).toBe(''); expect(oldNext.isConnected).toBe(false);
    fireEvent.click(oldNext); expect(expandedText()).toBe('');
    if (change === 'turn' || change === 'content' || change === 'agent') {
      const id = change === 'agent' ? 'content-b-1' : 'new-a';
      vi.mocked(f.api.getAgentContent).mockResolvedValue(contentPage('N'.repeat(8192) + 'NEW_LAST', { contentId: id }));
      await read(); await waitReadSettled(f); fireEvent.click(oldNext);
      expect(expandedText()).toBe('N'.repeat(8192)); expect(previousSegment()).toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('Given A→B→A after paging, Then A has no retained page cache and rereads from the first segment', async () => {
    const f = await mount(); vi.mocked(f.api.getAgentContent).mockResolvedValue(contentPage('A'.repeat(8192) + 'A_LAST'));
    await read(); await waitReadSettled(f); fireEvent.click(nextSegment()!);
    fireEvent.click(screen.getByRole('button', { name: /Reader B/ })); fireEvent.click(screen.getByRole('button', { name: /Reader A/ })); await flush();
    expect(expandedText()).toBe(''); await read(); await waitReadSettled(f); expect(expandedText()).toBe('A'.repeat(8192));
  });

  it.each(['pager', 'composer'] as const)('Given %s owns focus, Then turn invalidation restores only a disappearing owned pager to the existing Agent row', async owner => {
    const f = await mount(); vi.mocked(f.api.getAgentContent).mockResolvedValue(contentPage('A'.repeat(8192) + 'LAST'));
    await read(); await waitReadSettled(f); fireEvent.click(nextSegment()!);
    const focused = owner === 'pager' ? nextSegment()! : screen.getByLabelText('补充说明'); focused.focus();
    await advance(f, { turn: 2, turnId: 'turn-a-2', resultContentId: undefined });
    const row = screen.getByRole('button', { name: /Reader A/ }); expect(row.isConnected).toBe(true);
    expect(owner === 'pager' ? row : focused).toHaveFocus();
  });

  it('Given a multi-segment result awaits its digest, Then no first segment or pager is visible before full verification', async () => {
    const f = storedFixture('甲😀'.repeat(18000)); const pending = deferred<ArrayBuffer>(); digest.mockReturnValueOnce(pending.promise);
    await mount(f); await read(); expect(expandedText()).toBe(''); expect(nextSegment()).toBeNull();
    pending.resolve(await webcrypto.subtle.digest('SHA-256', Buffer.from('甲😀'.repeat(18000)))); await waitReadSettled(f);
    expect(collectSavedSegments().join('')).toBe('甲😀'.repeat(18000));
  });
});

describe('R6: readback retains local focus and the existing announcement policy', () => {
  it.each(['success', 'error'] as const)('Given the focused read button settles with %s, Then its DOM and focus remain without stealing the composer', async outcome => {
    const f = await mount();
    if (outcome === 'error') vi.mocked(f.api.getAgentContent).mockRejectedValueOnce(new Error('read unavailable'));
    const button = readButton(); button.focus(); await read(); await waitReadSettled(f);
    expect(button.isConnected).toBe(true); expect(button).toHaveFocus();
    if (outcome === 'success') {
      await advance(f, { turn: 2, turnId: 'turn-a-2', resultContentId: undefined });
      expect(screen.getByRole('button', { name: /Reader A/ })).toHaveFocus();
    }
  });

  it('Given the composer owns focus before new-turn invalidation, Then hiding the old saved content cannot take it', async () => {
    const f = await mount(); await read(); await waitReadSettled(f);
    const composer = screen.getByLabelText('补充说明'); composer.focus();
    await advance(f, { turn: 2, turnId: 'turn-a-2', resultContentId: undefined });
    expect(composer).toHaveFocus();
  });

  it('Given failure less than ten seconds after ordinary activity, Then it is announced immediately once while ordinary activity remains throttled', async () => {
    const f = await mount(); const live = document.querySelector('.sr-only[aria-live="polite"]')!;
    const initial = live.textContent; let announcements = 0;
    const observer = new MutationObserver(() => { announcements++; }); observer.observe(live, { childList: true, subtree: true, characterData: true });
    stops.push(() => observer.disconnect());
    await advance(f, { status: 'failed' });
    expect(live.textContent).toContain('Reader A 执行失败'); const failures = announcements;
    await advance(f, { status: 'failed' }); expect(announcements).toBe(failures);
    await advance(f, { id: 'agent-b', status: 'running', executionActive: true });
    expect(live.textContent).toContain('Reader A 执行失败');
    await flush(10_000); expect(live.textContent).toContain('1 个 SubAgent 运行中'); expect(live.textContent).not.toBe(initial);
  });
});
