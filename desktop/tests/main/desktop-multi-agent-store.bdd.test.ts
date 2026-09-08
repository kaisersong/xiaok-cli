// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DesktopMultiAgentStore, encodeMultiAgentRow } from '../../electron/desktop-multi-agent-store.js';

describe('BDD: durable Desktop multi-agent groups', () => {
  const roots: string[] = [];
  const stores: DesktopMultiAgentStore[] = [];
  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });
  function setup(options: { maxBytes?: number; reserveBytes?: number } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-multi-agent-store-'));
    roots.push(root);
    const dbPath = join(root, 'groups.sqlite');
    const store = new DesktopMultiAgentStore(dbPath, { bootId: 'boot-1', ...options });
    stores.push(store);
    store.registerThread({ threadId: 't1', profileId: 'p1', workspaceId: 'w1', cwd: root });
    const group = store.createGroup('t1');
    return { root, dbPath, store, group };
  }

  it('U1 Given only roots or another thread child, Then history comes only from committed local child rows and survives reset/restart until purge', () => {
    const { root, dbPath, store, group } = setup();
    store.registerThread({ threadId: 'foreign', profileId: 'other-profile', workspaceId: 'other-workspace', cwd: root });
    const foreign = store.createGroup('foreign');
    store.putAgent(foreign.groupId, { id: 'foreign-child', parentId: `root_${foreign.groupId}`, taskName: 'foreign', canonicalName: '/root/foreign',
      depth: 1, status: 'closed', turn: 1, resourcesReleased: true, activationState: 'settled' });
    expect(store.threadHasAgentHistory('t1')).toBe(false);
    expect(store.threadHasAgentHistory('missing')).toBe(false);
    expect(store.threadHasAgentHistory('foreign')).toBe(true);
    const child = { id: 'local-child', parentId: `root_${group.groupId}`, taskName: 'local', canonicalName: '/root/local',
      depth: 1, status: 'closed' as const, turn: 1, resourcesReleased: true, activationState: 'settled' as const, closeReason: 'ttl' as const };
    expect(() => store.transaction(() => { store.putAgent(group.groupId, child); throw new Error('rollback child'); })).toThrow('rollback child');
    expect(store.threadHasAgentHistory('t1')).toBe(false);
    store.putAgent(group.groupId, child);
    store.putGroup({ ...store.requireGroup(group.groupId), historicalOnly: true }, true);
    store.clearActiveGroup('t1', group.groupId);
    const empty = store.createGroup('t1');
    expect(store.threadHasAgentHistory('t1')).toBe(true);
    expect(store.listAgents(empty.groupId).items).toHaveLength(1);
    store.close();
    const reopened = new DesktopMultiAgentStore(dbPath, { bootId: 'boot-2' }); stores.push(reopened);
    reopened.recoverPreviousBoot();
    expect(reopened.activeGroup('t1')).toBeNull();
    expect(reopened.threadHasAgentHistory('t1')).toBe(true);
    const revision = reopened.getThread('t1')!.threadRevision!;
    reopened.beginThreadDeletion('t1', { operationId: 'purge-history', actorId: 'user', bootId: reopened.bootId, expectedRevision: revision,
      requestHash: 'purge', startedAt: 1, result: { operationId: 'purge-history', state: 'cleanup_pending' } });
    expect(reopened.threadHasAgentHistory('t1')).toBe(true);
    reopened.deleteThreadHistory('t1', 'purge-history');
    expect(reopened.threadHasAgentHistory('t1')).toBe(false);
    expect(reopened.threadHasAgentHistory('foreign')).toBe(true);
    expect(reopened.getThread('t1')).toMatchObject({ deleteState: 'deleted', profileId: 'p1', workspaceId: 'w1' });
    expect(() => reopened.createGroup('t1')).toThrow(/deletion/);
    expect(() => reopened.registerThread({ threadId: 't1', profileId: 'forged', workspaceId: 'w1', cwd: root })).toThrow(/ownership/);
  });

  it('U1 Given more than fifty newer root-only groups, Then SQL filters child groups before paging without changing the audit default or duplicating joins', () => {
    const { store, group } = setup();
    store.clearActiveGroup('t1', group.groupId);
    const children: string[] = [];
    for (let index = 0; index < 3; index++) {
      const item = store.createGroup('t1');
      store.putGroup({ ...item, createdAt: 100 }, true);
      for (let child = 0; child <= index; child++) store.putAgent(item.groupId, {
        id: `page-child-${index}-${child}`, parentId: `root_${item.groupId}`, taskName: 'child', canonicalName: `/root/child-${child}`,
        depth: 1, status: 'closed', turn: 1, activationState: 'settled', resourcesReleased: true,
      });
      children.push(item.groupId); store.clearActiveGroup('t1', item.groupId);
    }
    for (let index = 0; index < 55; index++) {
      const empty = store.createGroup('t1'); store.putGroup({ ...empty, createdAt: 1000 + index }, true);
      store.clearActiveGroup('t1', empty.groupId);
    }
    const audit = store.listGroups('t1');
    expect(audit.items).toHaveLength(50);
    expect(audit.items.every(item => !children.includes(item.groupId))).toBe(true);
    const first = store.listGroups('t1', undefined, 2, { onlyWithChildren: true });
    expect(first.items).toHaveLength(2); expect(first.nextCursor).not.toBeNull();
    const second = store.listGroups('t1', first.nextCursor!, 2, { onlyWithChildren: true });
    expect(second.items).toHaveLength(1); expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map(item => item.groupId)).toEqual(children.sort().reverse());
  });

  it.each(['profileId', 'workspaceId', 'cwd'] as const)('U1 Given a bound thread, Then changing %s cannot repurpose its history', field => {
    const { root, store } = setup();
    const binding = { threadId: 't1', profileId: 'p1', workspaceId: 'w1', cwd: root };
    expect(() => store.registerThread({ ...binding, [field]: field === 'cwd' ? join(root, 'foreign') : 'foreign' })).toThrow(/ownership/);
    expect(store.getThread('t1')).toMatchObject(binding);
  });

  it('A15/A19 Given content referenced only by retained durable events, Then rollback deletion cannot leave broken history links', () => {
    const { store, group } = setup(); const agentId = `root_${group.groupId}`;
    const content = store.putContent(group.groupId, agentId, 'event-owned text');
    store.appendEvent(group.groupId, { agentId, kind: 'result', payload: { contentId: content.contentId, preview: 'event-owned text' } });
    const usage = store.getByteUsage(group.groupId);
    expect(() => store.deleteUnreferencedContent(group.groupId, content.contentId)).toThrow(/referenced/);
    expect(store.getByteUsage(group.groupId)).toBe(usage);
  });

  it.each([false, true])('A15/A36 Given an applied cleanup-pending operation on historical=%s old boot, Then recovery reports unknown physical completion and preserves its operation identity', historicalOnly => {
    const { store, dbPath, group } = setup();
    store.putOperation({ groupId: group.groupId, operationId: 'cleanup-op', command: 'reset', requestHash: 'request', applyState: 'applied', result: { state: 'cleanup_pending' } });
    if (historicalOnly) { store.putGroup({ ...group, historicalOnly: true }, true); store.clearActiveGroup('t1', group.groupId); }
    store.close(); stores.splice(stores.indexOf(store), 1);
    const recovered = new DesktopMultiAgentStore(dbPath, { bootId: 'boot-2' }); stores.push(recovered); recovered.recoverPreviousBoot();
    expect(recovered.getOperation(group.groupId, 'cleanup-op')).toMatchObject({ operationId: 'cleanup-op', applyState: 'unknown' });
  });

  it('A31 Given a new group, When its transaction commits, Then root identity exists before any child foreign key', () => {
    const { store, group } = setup();
    const rootId = `root_${group.groupId}`;
    expect(store.getAgent(group.groupId, rootId)).toMatchObject({ id: rootId, parentId: null, status: 'pending', turn: 0 });
    store.putAgent(group.groupId, { id: 'c1', parentId: rootId, taskName: 'child', canonicalName: '/root/child', depth: 1, status: 'pending', turn: 0 });
    expect(store.getAgent(group.groupId, 'c1')?.parentId).toBe(rootId);
    expect(() => store.putAgent(group.groupId, { id: 'bad', parentId: 'missing', taskName: 'bad', canonicalName: '/root/bad', depth: 1, status: 'pending', turn: 0 })).toThrow();
    expect(store.getAgent(group.groupId, 'bad')).toBeNull();
  });

  it('U1 Given twenty same-name historical children, Then stable main-issued ordinals survive updates and reopening without counting root', () => {
    const { store, group, dbPath } = setup();
    for (let n = 1; n <= 20; n++) {
      const row = store.putAgent(group.groupId, { id: `child-${n}`, parentId: `root_${group.groupId}`, taskName: 'review', canonicalName: `/root/review-${n}`,
        depth: 1, status: 'closed', turn: 1, resourcesReleased: true, presentationOrdinal: 999 });
      expect(row.presentationOrdinal).toBe(n);
    }
    const first = store.getAgent(group.groupId, 'child-1')!;
    expect(store.putAgent(group.groupId, { ...first, turn: 2, presentationOrdinal: 20 }).presentationOrdinal).toBe(1);
    expect(store.getAgent(group.groupId, `root_${group.groupId}`)?.presentationOrdinal).toBeUndefined();
    store.close(); const reopened = new DesktopMultiAgentStore(dbPath, { bootId: 'boot-2' }); stores.push(reopened);
    for (let n = 20; n >= 1; n--) expect(reopened.getAgent(group.groupId, `child-${n}`)?.presentationOrdinal).toBe(n);
  });

  it('U1 Given another SQLite writer holds the lock, Then ordinal allocation is atomic, rollback consumes no ordinal and the next explicit write stays unique', () => {
    const { store, group, dbPath } = setup(); const external = new DatabaseSync(dbPath);
    const row = { id: 'first', parentId: `root_${group.groupId}`, taskName: 'review', canonicalName: '/root/first', depth: 1, status: 'pending' as const, turn: 0 };
    try {
      external.exec('BEGIN IMMEDIATE');
      expect(() => store.putAgent(group.groupId, row)).toThrow(/locked|busy/i);
      external.exec('ROLLBACK');
      expect(store.getAgent(group.groupId, row.id)).toBeNull();
      expect(store.putAgent(group.groupId, row).presentationOrdinal).toBe(1);
      expect(store.putAgent(group.groupId, { ...row, id: 'second', canonicalName: '/root/second' }).presentationOrdinal).toBe(2);
    } finally { external.close(); }
  });

  it('A18 Given admission is frozen, Then only main settlement handoffs may still be journaled, not ordinary or user messages', () => {
    const { store, group } = setup(); const rootId = `root_${group.groupId}`;
    store.putAgent(group.groupId, { id: 'child', parentId: rootId, taskName: 'child', canonicalName: '/root/child', depth: 1, status: 'closed', turn: 1 });
    store.putGroup({ ...store.requireGroup(group.groupId), mutationBlockedReason: 'group_reset_pending' }, true);
    expect(() => store.sendMessage(group.groupId, { sender: { kind: 'agent', agentId: 'child' }, receiverId: rootId, text: 'not a handoff' })).toThrow(/pending/);
    expect(() => store.sendMessage(group.groupId, { sender: { kind: 'user', actorId: 'user' }, receiverId: rootId, kind: 'error', text: 'forged' }, true)).toThrow();
    expect(() => store.sendMessage(group.groupId, { sender: { kind: 'agent', agentId: 'child' }, receiverId: rootId, text: 'not a handoff' }, true)).toThrow();
    const result = store.sendMessage(group.groupId, { sender: { kind: 'agent', agentId: 'child' }, receiverId: rootId, kind: 'error', text: 'agent_closed' }, true);
    expect(store.listMessages(group.groupId, rootId)).toMatchObject([{ messageId: result.messageId, kind: 'error' }]);
    store.putGroup({ ...store.requireGroup(group.groupId), historicalOnly: true }, true);
    expect(() => store.sendMessage(group.groupId, { sender: { kind: 'agent', agentId: 'child' }, receiverId: rootId, kind: 'error', text: 'old boot' }, true)).toThrow(/historical/);
  });

  it('A43 Given user and agent senders, When their messages are persisted, Then neither sender can impersonate the other', () => {
    const { store, group } = setup();
    const rootId = `root_${group.groupId}`;
    const user = store.sendMessage(group.groupId, { sender: { kind: 'user', actorId: 'p1' }, receiverId: rootId, text: 'user instruction' });
    const main = store.sendMessage(group.groupId, { sender: { kind: 'agent', agentId: rootId }, receiverId: rootId, text: 'main note' });
    expect(store.listMessages(group.groupId, rootId).map(message => message.sender)).toEqual([
      { kind: 'user', actorId: 'p1' }, { kind: 'agent', agentId: rootId },
    ]);
    expect(user.messageId).not.toBe(main.messageId);
    expect(() => store.sendMessage(group.groupId, {
      sender: { kind: 'agent', agentId: 'foreign-agent' }, receiverId: rootId, text: 'forged',
    })).toThrow();
  });

  it('A24 Given an unread message, When drain rolls back or confirm succeeds, Then claim state has one durable owner', () => {
    const { store, group } = setup();
    const rootId = `root_${group.groupId}`;
    const sent = store.sendMessage(group.groupId, { sender: { kind: 'user', actorId: 'p1' }, receiverId: rootId, text: 'sentinel' });
    const first = store.drainInput(group.groupId, rootId, 'turn-1');
    expect(first.messages.map(message => message.messageId)).toEqual([sent.messageId]);
    expect(store.drainInput(group.groupId, rootId, 'turn-1').messages).toEqual([]);
    store.returnClaim(group.groupId, first.claimId!);
    expect(store.listMessages(group.groupId, rootId)[0]).toMatchObject({ deliveryState: 'unread', claimId: null, turnId: null });
    const second = store.drainInput(group.groupId, rootId, 'turn-2');
    expect(second.claimId).not.toBe(first.claimId);
    store.confirmApplied(group.groupId, second.claimId!, 'turn-2');
    store.confirmApplied(group.groupId, second.claimId!, 'turn-2');
    expect(store.listMessages(group.groupId, rootId)[0]?.deliveryState).toBe('context_applied');
    expect(store.drainInput(group.groupId, rootId, 'turn-3').messages).toEqual([]);
  });

  it('A24 Given a claimed batch, When the wrong turn confirms it, Then nothing is consumed', () => {
    const { store, group } = setup();
    const rootId = `root_${group.groupId}`;
    store.sendMessage(group.groupId, { sender: { kind: 'user', actorId: 'p1' }, receiverId: rootId, text: 'sentinel' });
    const batch = store.drainInput(group.groupId, rootId, 'turn-1');
    expect(() => store.confirmApplied(group.groupId, batch.claimId!, 'turn-2')).toThrow(/stale|claim|turn/);
    expect(store.listMessages(group.groupId, rootId)[0]?.deliveryState).toBe('consuming');
  });

  it('A11/A25 Given an old boot with a claimed message, When reopened twice, Then history is read-only and claims are safely returned', () => {
    const { store, group, dbPath } = setup();
    const rootId = `root_${group.groupId}`;
    store.sendMessage(group.groupId, { sender: { kind: 'user', actorId: 'p1' }, receiverId: rootId, text: 'sentinel' });
    store.drainInput(group.groupId, rootId, 'turn-1');
    store.close();
    const reopened = new DesktopMultiAgentStore(dbPath, { bootId: 'boot-2' });
    stores.push(reopened);
    reopened.recoverPreviousBoot();
    reopened.recoverPreviousBoot();
    expect(reopened.activeGroup('t1')).toBeNull();
    expect(reopened.getGroup(group.groupId)).toMatchObject({ historicalOnly: true });
    expect(reopened.getAgent(group.groupId, rootId)?.status).toBe('interrupted');
    expect(reopened.listMessages(group.groupId, rootId)[0]).toMatchObject({ deliveryState: 'unread', claimId: null, turnId: null });
    expect(() => reopened.sendMessage(group.groupId, { sender: { kind: 'user', actorId: 'p1' }, receiverId: rootId, text: 'must not replay' })).toThrow(/historical|read.only/);
  });

  it('A29 Given confirmed context before a crash, When recovered, Then receipt stays unknown and the message is not unread again', () => {
    const { store, group, dbPath } = setup();
    const rootId = `root_${group.groupId}`;
    store.sendMessage(group.groupId, { sender: { kind: 'user', actorId: 'p1' }, receiverId: rootId, text: 'confirmed' });
    const batch = store.drainInput(group.groupId, rootId, 'turn-1');
    store.confirmApplied(group.groupId, batch.claimId!, 'turn-1');
    store.close();
    const reopened = new DesktopMultiAgentStore(dbPath, { bootId: 'boot-2' });
    stores.push(reopened);
    reopened.recoverPreviousBoot();
    expect(reopened.listMessages(group.groupId, rootId)[0]?.deliveryState).toBe('context_applied');
  });

  it('A35 Given cursor 100, When events 101 through 121 exist, Then paginated replay returns every durable detail without renumbering', () => {
    const { store, group } = setup();
    const rootId = `root_${group.groupId}`;
    for (let ordinal = 1; ordinal <= 121; ordinal += 1) {
      store.appendEvent(group.groupId, { kind: ordinal === 110 ? 'result' : 'output', agentId: rootId, payload: { text: `event-${ordinal}` } });
    }
    const first = store.readEvents(group.groupId, 100, 10);
    const second = store.readEvents(group.groupId, first.at(-1)!.seq, 100);
    expect([...first, ...second].map(event => event.seq)).toEqual(Array.from({ length: 21 }, (_, index) => index + 101));
    expect(first.at(-1)?.payload).toEqual({ text: 'event-110' });
    expect(store.getGroup(group.groupId)?.lastSeq).toBe(121);
  });

  it('A29 Given 61 historical agents, When paging and reopening, Then stable pages contain every ID exactly once', () => {
    const { store, group } = setup();
    const rootId = `root_${group.groupId}`;
    for (let i = 0; i < 61; i += 1) store.putAgent(group.groupId, {
      id: `child-${i}`, parentId: rootId, taskName: `child_${i}`, canonicalName: `/root/child_${i}`,
      depth: 1, status: 'closed', turn: 1, resourcesReleased: true, executionActive: false,
    });
    const one = store.listAgents(group.groupId, undefined, 50);
    const two = store.listAgents(group.groupId, one.nextCursor!, 50);
    const ids = [...one.items, ...two.items].map(agent => agent.id);
    expect(ids.length).toBe(62);
    expect(new Set(ids).size).toBe(62);
    expect(two.nextCursor).toBeNull();
  });

  it('A23 Given multibyte result text, When content is read in tiny byte pages, Then base64 bytes reconstruct exactly and cross-group reads fail', () => {
    const { store, group } = setup();
    const source = '中文😀正文';
    const content = store.putContent(group.groupId, `root_${group.groupId}`, source);
    let offset = 0;
    const buffers: Buffer[] = [];
    do {
      const page = store.readContent(group.groupId, content.contentId, offset, 3);
      buffers.push(Buffer.from(page.base64, 'base64'));
      offset = page.nextOffset;
    } while (offset < content.byteLength);
    expect(Buffer.concat(buffers).toString('utf8')).toBe(source);
    expect(() => store.readContent('foreign-group', content.contentId, 0, 64)).toThrow();
  });

  it('A36 Given canonical row encoding, When key order varies, Then frozen bytes remain identical', () => {
    const literal = '{"a":1,"z":"😀"}';
    expect(encodeMultiAgentRow({ z: '😀', a: 1 })).toBe(literal);
    expect(encodeMultiAgentRow({ a: 1, z: '😀' })).toBe(literal);
    expect(() => encodeMultiAgentRow({ value: Number.NaN })).toThrow();
  });

  it('A36 Given only messages grow, When ordinary quota is reached, Then the failed transaction rolls back every row and byte counter', () => {
    const { store, group } = setup({ maxBytes: 16_384, reserveBytes: 2_048 });
    const rootId = `root_${group.groupId}`;
    let rejected = false;
    for (let index = 0; index < 30; index += 1) {
      const before = store.getByteUsage(group.groupId);
      const count = store.listMessages(group.groupId, rootId).length;
      try { store.sendMessage(group.groupId, { sender: { kind: 'user', actorId: 'p1' }, receiverId: rootId, text: `${index}:${'x'.repeat(1000)}` }); }
      catch (error) {
        expect(String(error)).toMatch(/quota/);
        expect(store.getByteUsage(group.groupId)).toBe(before);
        expect(store.listMessages(group.groupId, rootId)).toHaveLength(count);
        rejected = true;
        break;
      }
    }
    expect(rejected).toBe(true);
    expect(store.getByteUsage(group.groupId)).toBe(store.recomputeByteUsage(group.groupId));
  });

  it('A15 Given an existing database with unknown schema, When opened, Then it is rejected without deleting its contents', () => {
    const { store, dbPath } = setup();
    store.close();
    const raw = new DatabaseSync(dbPath);
    raw.exec('PRAGMA user_version = 999');
    raw.close();
    expect(() => new DesktopMultiAgentStore(dbPath, { bootId: 'boot-2' })).toThrow(/schema|version/);
    const check = new DatabaseSync(dbPath);
    expect(check.prepare('PRAGMA user_version').get()).toEqual({ user_version: 999 });
    expect(check.prepare('SELECT count(*) AS n FROM groups').get()).toEqual({ n: 1 });
    check.close();
  });

  it('A43 Given a sender union, When opposite identity fields are smuggled in, Then the whole mutation is rejected', () => {
    const { store, group } = setup();
    const rootId = `root_${group.groupId}`;
    const before = store.getByteUsage(group.groupId);
    expect(() => store.sendMessage(group.groupId, {
      sender: { kind: 'user', actorId: 'p1', agentId: rootId } as never, receiverId: rootId, text: 'forged',
    })).toThrow(/sender/);
    expect(store.listMessages(group.groupId, rootId)).toHaveLength(0);
    expect(store.getByteUsage(group.groupId)).toBe(before);
  });

  it('A23 Given content owned by another group, When a local message references it, Then no message or event is committed', () => {
    const { store, group, root } = setup();
    store.registerThread({ threadId: 't2', profileId: 'p1', workspaceId: 'w1', cwd: root });
    const other = store.createGroup('t2');
    const content = store.putContent(other.groupId, `root_${other.groupId}`, 'private result');
    expect(() => store.sendMessage(group.groupId, {
      sender: { kind: 'user', actorId: 'p1' }, receiverId: `root_${group.groupId}`, text: 'pointer', contentId: content.contentId,
    })).toThrow(/content|group/);
    expect(store.readEvents(group.groupId)).toHaveLength(0);
  });

  it('A36 Given a populated group, When history is listed, Then its actual logical byte usage is returned', () => {
    const { store, group } = setup();
    expect(store.listGroups('t1').items[0]?.byteUsage).toBe(store.getByteUsage(group.groupId));
  });

  it('A36 Given unreferenced content, When deleted twice, Then accounting decreases exactly once and other groups cannot delete it', () => {
    const { store, group } = setup();
    const content = store.putContent(group.groupId, `root_${group.groupId}`, 'discarded content');
    const before = store.getByteUsage(group.groupId);
    expect(() => store.deleteUnreferencedContent('foreign-group', content.contentId)).toThrow();
    expect(store.getByteUsage(group.groupId)).toBe(before);
    store.deleteUnreferencedContent(group.groupId, content.contentId);
    const after = store.getByteUsage(group.groupId);
    expect(after).toBeLessThan(before);
    store.deleteUnreferencedContent(group.groupId, content.contentId);
    expect(store.getByteUsage(group.groupId)).toBe(after);
    expect(after).toBe(store.recomputeByteUsage(group.groupId));
  });
});
