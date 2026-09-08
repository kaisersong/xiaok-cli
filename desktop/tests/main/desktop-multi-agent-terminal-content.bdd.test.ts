// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, constants } from 'node:sqlite';
import { DesktopMultiAgentStore, encodeMultiAgentRow } from '../../electron/desktop-multi-agent-store.js';
import type { MultiAgentContent } from '../../shared/multi-agent-types.js';

type NativeDb = DatabaseSync & { setAuthorizer(callback: ((action: number, table: string | null) => number) | null): void };
const nativeAuthorizer = typeof (DatabaseSync.prototype as unknown as NativeDb).setAuthorizer === 'function';

describe('R1 terminal content settlement stays inside the existing store boundary', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const action of cleanup.splice(0).reverse()) action(); });
  function setup(quota = false) {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-terminal-content-bdd-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const dbPath = join(root, 'facts.sqlite');
    const store = new DesktopMultiAgentStore(dbPath, { bootId: 'probe-boot', now: () => 1788740000000,
      ...(quota ? { maxBytes: 8192, reserveBytes: 2048 } : {}) });
    cleanup.push(() => store.close());
    store.registerThread({ threadId: 'probe', profileId: 'p', workspaceId: 'w', cwd: root });
    const group = store.createGroup('probe'), agentId = `root_${group.groupId}`;
    const db = (store as unknown as { db: NativeDb }).db;
    const rows = () => db.prepare('SELECT content_id,data_json,logical_bytes FROM contents ORDER BY content_id').all();
    const block = () => store.putGroup({ ...store.requireGroup(group.groupId), mutationBlockedReason: 'group_reset_pending' }, true);
    // Calls the actual current method. Before implementation its ignored fourth
    // argument exposes the missing settlement permission; no gate is recreated.
    const put = (text: string, settlement?: boolean, target = group.groupId) => (
      store.putContent as (groupId: string, id: string, text: string, settlement?: boolean) => MultiAgentContent
    ).call(store, target, agentId, text, settlement);
    return { root, dbPath, store, group, agentId, db, rows, block, put };
  }

  it.each([undefined, false])('TC1 blocked ordinary content with settlement=%s remains denied without row or quota changes', settlement => {
    const f = setup(); f.block(); const rows = f.rows(), usage = f.store.getByteUsage(f.group.groupId);
    expect(() => f.put('ordinary content', settlement)).toThrow('group_reset_pending');
    expect(f.rows()).toEqual(rows); expect(f.store.getByteUsage(f.group.groupId)).toBe(usage);
  });

  it('TC2 a same-boot terminal settlement preserves full UTF-8 content, hash, and the existing blocked reason', () => {
    const f = setup(); f.block(); const usage = f.store.getByteUsage(f.group.groupId);
    const text = '实际终态内容 丙😀\nsecond line', content = f.put(text, true);
    const page = f.store.readContent(f.group.groupId, content.contentId, 0);
    expect(Buffer.from(page.base64, 'base64').toString('utf8')).toBe(text);
    expect(page).toMatchObject({ byteLength: Buffer.byteLength(text), nextOffset: Buffer.byteLength(text),
      sha256: createHash('sha256').update(text).digest('hex'), truncated: false });
    expect(f.rows()).toHaveLength(1);
    expect(f.store.getByteUsage(f.group.groupId)).toBe(usage + Buffer.byteLength(encodeMultiAgentRow(content)));
    expect(f.store.getByteUsage(f.group.groupId)).toBe(f.store.recomputeByteUsage(f.group.groupId));
    expect(f.store.requireGroup(f.group.groupId).mutationBlockedReason).toBe('group_reset_pending');
  });

  it.each(['historical', 'other-boot'] as const)('TC3 settlement cannot mutate a %s group', kind => {
    const f = setup(); f.block();
    if (kind === 'historical') f.store.putGroup({ ...f.store.requireGroup(f.group.groupId), historicalOnly: true }, true);
    const before = f.rows(), usage = f.store.getByteUsage(f.group.groupId), group = f.store.requireGroup(f.group.groupId);
    let target = f.store;
    if (kind === 'other-boot') {
      f.store.close(); target = new DesktopMultiAgentStore(f.dbPath, { bootId: 'new-boot' }); cleanup.push(() => target.close());
    }
    expect(() => (target.putContent as (g: string, a: string, t: string, s: boolean) => MultiAgentContent)
      .call(target, f.group.groupId, f.agentId, 'late content', true)).toThrow('historical group is read-only');
    const db = (target as unknown as { db: DatabaseSync }).db;
    expect(db.prepare('SELECT content_id,data_json,logical_bytes FROM contents ORDER BY content_id').all()).toEqual(before);
    expect(target.getByteUsage(f.group.groupId)).toBe(usage); expect(target.requireGroup(f.group.groupId)).toEqual(group);
  });

  it.each([undefined, true])('TC4 unknown group settlement=%s is still denied without creating content', settlement => {
    const f = setup(), before = f.rows(), usage = f.store.getByteUsage(f.group.groupId);
    expect(() => f.put('unknown content', settlement, 'missing-group')).toThrow('unknown multi-agent group');
    expect(f.rows()).toEqual(before); expect(f.store.getByteUsage(f.group.groupId)).toBe(usage);
  });

  it('TC5 terminal content cannot use the control reserve even when its real encoded row fits 4KiB', () => {
    const f = setup(true); f.store.putContent(f.group.groupId, f.agentId, 'x'.repeat(2500));
    const row = f.db.prepare('SELECT data_json FROM groups WHERE group_id=?').get(f.group.groupId) as { data_json: string };
    const persisted = JSON.parse(row.data_json), { permissionRevision, ...preV2Fields } = persisted;
    expect(permissionRevision).toBe(0);
    expect(Buffer.byteLength(encodeMultiAgentRow(persisted)) - Buffer.byteLength(encodeMultiAgentRow(preV2Fields))).toBe(23);
    expect(f.store.getByteUsage(f.group.groupId)).toBe(3421); // original 3398 + the measured required v2 field
    f.block(); const before = f.rows(), usage = f.store.getByteUsage(f.group.groupId);
    const text = 'y'.repeat(6144 - usage + 1);
    const candidate: MultiAgentContent = { contentId: randomUUID(), groupId: f.group.groupId, agentId: f.agentId, utf8Text: text,
      byteLength: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex'), truncated: false };
    const logicalBytes = Buffer.byteLength(encodeMultiAgentRow(candidate));
    expect(logicalBytes).toBeLessThanOrEqual(4096);
    expect(usage + logicalBytes).toBe(6426); expect(usage + logicalBytes).toBeGreaterThan(6144); expect(usage + logicalBytes).toBeLessThanOrEqual(8192);
    expect(() => f.put(text, true)).toThrow('multi_agent_quota_exhausted');
    expect(f.rows()).toEqual(before); expect(f.store.getByteUsage(f.group.groupId)).toBe(usage);
  });

  it('TC6 a successful terminal content write still rolls back with its outer real transaction', () => {
    const f = setup(); f.block(); const before = f.rows(), usage = f.store.getByteUsage(f.group.groupId);
    const sentinel = new Error('after actual terminal content insertion'); let inserted: MultiAgentContent | undefined, failure: unknown;
    try { f.store.transaction(() => { inserted = f.put('rollback final result', true); expect(f.rows()).toHaveLength(1); throw sentinel; }); }
    catch (error) { failure = error; }
    expect.soft(failure).toBe(sentinel);
    expect(inserted, 'must reach actual insertion before testing rollback').toBeDefined();
    expect(f.rows()).toEqual(before); expect(f.store.getByteUsage(f.group.groupId)).toBe(usage);
  });

  it.skipIf(!nativeAuthorizer)('TC7 a real SQLite contents INSERT denial propagates and preserves rows and quota', () => {
    const f = setup(); f.block(); const before = f.rows(), usage = f.store.getByteUsage(f.group.groupId);
    let denied = 0;
    f.db.setAuthorizer((action, table) => {
      if (action === constants.SQLITE_INSERT && table === 'contents') { denied++; return constants.SQLITE_DENY; }
      return constants.SQLITE_OK;
    });
    try { expect.soft(() => f.put('native failure', true)).toThrow(/not authorized/i); }
    finally { f.db.setAuthorizer(null); }
    expect(denied, 'must reach the real SQLite authorizer, not the ordinary blocked gate').toBe(1);
    expect(f.rows()).toEqual(before); expect(f.store.getByteUsage(f.group.groupId)).toBe(usage);
  });
  // TC8 is the existing three reset cases in desktop-multi-agent-activity-
  // admission.bdd.test.ts: real factory/core/SQLite, not a duplicated fixture.
});
