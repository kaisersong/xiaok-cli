// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';

describe('BDD: durable snapshots and commit-only event publication', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
  function setup() {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-multi-projection-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite')); cleanup.push(() => store.close());
    const service = new DesktopMultiAgentService({ store, coordinator: new DesktopExecutionCoordinator(), createSession: vi.fn() });
    cleanup.push(() => service.dispose());
    service.registerThread({ threadId: 'thread', profileId: 'profile', workspaceId: 'workspace', cwd: root });
    const access = service.createUserAccess({ requestSource: 'user', actorId: 'user-id', threadId: 'thread', profileId: 'profile', workspaceId: 'workspace' });
    const group = store.createGroup('thread'); const rootId = `root_${group.groupId}`;
    return { store, service, access, group, rootId };
  }
  it('A10/A15 Given a transaction that publishes then rolls back, When a subscriber is installed, Then it sees only committed events in sequence', () => {
    const { store, group, rootId } = setup(); const sequences: number[] = [];
    store.subscribe(event => { expect(store.readEvents(group.groupId).some(item => item.eventId === event.eventId)).toBe(true); sequences.push(event.seq); });
    expect(() => store.transaction(() => {
      store.appendEvent(group.groupId, { agentId: rootId, kind: 'output', payload: { text: 'must not leak' } });
      throw new Error('rollback');
    })).toThrow('rollback');
    expect(sequences).toEqual([]);
    store.appendEvent(group.groupId, { agentId: rootId, kind: 'output', payload: { text: 'committed' } });
    expect(sequences).toEqual([1]);
  });
  it('A10 Given one reentrant observer and one failing observer, When events commit, Then all other observers remain ordered and the database keeps transaction semantics', () => {
    const { store, group, rootId } = setup(); const received: number[] = [];
    store.subscribe(event => { if (event.seq === 1) store.appendEvent(group.groupId, { agentId: rootId, kind: 'output', payload: { text: 'second' } }); });
    store.subscribe(() => { throw new Error('observer failure'); });
    store.subscribe(event => received.push(event.seq));
    store.appendEvent(group.groupId, { agentId: rootId, kind: 'output', payload: { text: 'first' } });
    expect(received).toEqual([1, 2]); expect(store.readEvents(group.groupId).map(event => event.seq)).toEqual([1, 2]);
  });
  it('A8/A22 Given foreign profile/workspace/thread or a forged read token, When snapshots are requested, Then the service rejects before disclosure', () => {
    const { service, group } = setup();
    for (const mismatch of [{ profileId: 'foreign' }, { workspaceId: 'foreign' }, { requestSource: 'agent' as const }]) {
      expect(() => service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 'thread', profileId: 'profile', workspaceId: 'workspace', ...mismatch })).toThrow(/scope|ownership|permitted/);
    }
    expect(() => service.getSnapshot({ access: { accessId: 'forged' }, groupId: group.groupId })).toThrow(/access|authority/);
  });

  it('A10/A23 Given many large events and UTF-8 content, When the user reads pages, Then every envelope stays below 64KiB without skipping a sequence or splitting decoded text', () => {
    const { store, service, access, group, rootId } = setup();
    for (let index = 0; index < 30; index++) store.appendEvent(group.groupId, { agentId: rootId, kind: 'output', payload: { text: '中'.repeat(4000) } });
    let afterSeq = 0; const sequences: number[] = [];
    do {
      const page = service.readEvents({ access, groupId: group.groupId, afterSeq });
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(64 * 1024);
      sequences.push(...page.items.map(event => event.seq)); afterSeq = page.nextAfterSeq;
      if (!page.hasMore) break;
    } while (afterSeq < 100);
    expect(sequences).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
    const content = store.putContent(group.groupId, rootId, '🙂正文'.repeat(20_000));
    const buffers: Buffer[] = []; let offset = 0;
    do {
      const page = service.readContent({ access, groupId: group.groupId, contentId: content.contentId, offset });
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(64 * 1024);
      buffers.push(Buffer.from(page.base64, 'base64')); offset = page.nextOffset;
    } while (offset < content.byteLength);
    expect(Buffer.concat(buffers).toString('utf8')).toBe(content.utf8Text);
    expect(service.listGroups({ access }).items).toEqual([]);
    expect(store.listGroups('thread').items.map(item => item.groupId)).toEqual([group.groupId]);
    expect(service.getSnapshot({ access, groupId: group.groupId }).group?.groupId).toBe(group.groupId);
    expect(() => service.readContent({ access: { accessId: 'forged' }, groupId: group.groupId, contentId: content.contentId, offset: 0 })).toThrow(/access|authority/);
  });
  it('A10/U4 Given 120 historical agents and eight residents, When snapshot and history pages are read, Then root/residents are present and every wire payload is bounded', () => {
    const { store, service, access, group, rootId } = setup();
    for (let index = 0; index < 128; index++) store.putAgent(group.groupId, { id: `agent-${index}`, parentId: rootId, taskName: `agent_${index}`,
      canonicalName: `/root/agent_${index}`, depth: 1, status: index < 8 ? 'running' : 'closed', turn: 1, turnId: `turn-${index}`,
      resourcesReleased: index >= 8, sessionResident: index < 8, executionActive: index < 8,
      lastResult: '结果'.repeat(150), error: 'failure'.repeat(60), cleanupError: 'detail'.repeat(60),
    });
    const snapshot = service.getSnapshot({ access });
    expect(snapshot.root?.id).toBe(rootId); expect(snapshot.residentAgents).toHaveLength(8);
    expect(snapshot.agents.length).toBeLessThanOrEqual(50); expect(snapshot.counts.total).toBe(129);
    expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThanOrEqual(64 * 1024);
    const ids = new Set(snapshot.agents.map(agent => agent.id)); let cursor = snapshot.nextAgentCursor;
    while (cursor) {
      const page = service.readAgents({ access, groupId: group.groupId, cursor });
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(64 * 1024);
      for (const agent of page.items) { expect(ids.has(agent.id)).toBe(false); ids.add(agent.id); }
      cursor = page.nextCursor;
    }
    expect(ids.size).toBe(129);
  });
  it('A24 Given unread, claimed and confirmed messages, When snapshots are read, Then counts reflect durable state without changing delivery', () => {
    const { service, store, group, rootId, access } = setup();
    store.sendMessage(group.groupId, { sender: { kind: 'user', actorId: 'user' }, receiverId: rootId, text: 'message' });
    expect(service.getSnapshot({ access })).toMatchObject({ root: { unreadMessages: 1 }, counts: { unread: 1 } });
    const claim = store.drainInput(group.groupId, rootId, 'turn');
    expect(service.getSnapshot({ access })).toMatchObject({ root: { unreadMessages: 1 }, counts: { unread: 1 } });
    store.confirmApplied(group.groupId, claim.claimId!, 'turn');
    expect(service.getSnapshot({ access })).toMatchObject({ root: { unreadMessages: 0 }, counts: { unread: 0 } });
  });
  it('A10 Given listener registration followed by a synchronous snapshot, When a later committed event is emitted, Then the service stream contains it once and unsubscribe stops only delivery', () => {
    const { service, store, group, rootId, access } = setup(); const listener = vi.fn();
    const unsubscribe = service.subscribe(access, listener);
    const snapshot = service.getSnapshot({ access });
    const event = store.appendEvent(group.groupId, { agentId: rootId, kind: 'output', payload: { text: 'after snapshot' } });
    expect(event.seq).toBe(snapshot.lastSeq + 1); expect(listener).toHaveBeenCalledExactlyOnceWith(event);
    unsubscribe(); store.appendEvent(group.groupId, { agentId: rootId, kind: 'output', payload: { text: 'still durable' } });
    expect(listener).toHaveBeenCalledOnce(); expect(store.requireGroup(group.groupId).lastSeq).toBe(2);
  });
});
