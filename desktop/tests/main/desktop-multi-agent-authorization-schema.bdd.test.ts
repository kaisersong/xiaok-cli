// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';

// Shared v2 DDL contract owner: authorization R5 + approval R3 appendix A.
// The only SQL migration input copied here is frozen v1, never candidate v2.
const v1 = readFileSync(new URL('../fixtures/multi-agent-v1.sql', import.meta.url), 'utf8');
const table = 'workspace_execution_authorizations';
type AuthorizerDb = DatabaseSync & { setAuthorizer(callback: ((action: number, one: string | null) => number) | null): void };
const hasAuthorizer = typeof (DatabaseSync.prototype as unknown as Partial<AuthorizerDb>).setAuthorizer === 'function';

describe('BDD W9/AP10: one production SQLite v2 migration', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { vi.restoreAllMocks(); for (const action of cleanup.splice(0).reverse()) action(); });
  function path() {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-auth-schema-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    return join(root, 'groups.sqlite');
  }
  function database(file: string) { const db = new DatabaseSync(file); cleanup.push(() => { try { db.close(); } catch { /* already closed */ } }); return db; }
  function store(file: string) { const result = new DesktopMultiAgentStore(file); cleanup.push(() => result.close()); return result; }
  function legacy(file: string) {
    const db = database(file); db.exec(v1);
    db.prepare('INSERT INTO thread_bindings(thread_id,profile_id,workspace_id,cwd,thread_revision,delete_state,delete_json) VALUES(?,?,?,?,?,?,?)')
      .run('old-thread', 'profile', 'workspace', process.cwd(), 12, 'deleted', '{"operationId":"old-delete","result":{"state":"completed"}}');
    return db;
  }
  const version = (db: DatabaseSync) => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  const columns = (db: DatabaseSync, name: string) => db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>;

  it.each([0, 1])('Given schema %i, When the real store opens, Then both features commit together at version 2 and preserve existing fields', inputVersion => {
    const file = path(); const before = inputVersion ? legacy(file) : database(file);
    const old = inputVersion ? before.prepare('SELECT * FROM thread_bindings').all() : [];
    store(file);
    expect(version(before), 'one joint migration, not two incompatible v2s').toBe(2);
    expect(columns(before, table).map(column => [column.name, column.type, column.notnull, column.pk])).toEqual([
      ['profile_id', 'TEXT', 1, 1], ['workspace_id', 'TEXT', 1, 2], ['permission_revision', 'INTEGER', 1, 0],
      ['execution_allowed', 'INTEGER', 1, 0], ['updated_at', 'INTEGER', 1, 0], ['actor_id', 'TEXT', 0, 0], ['last_receipt_json', 'TEXT', 0, 0],
    ]);
    expect(columns(before, 'thread_bindings').find(column => column.name === 'pending_approval_count')).toMatchObject({ type: 'INTEGER', notnull: 1, dflt_value: '0' });
    if (inputVersion) expect(before.prepare('SELECT thread_id,profile_id,workspace_id,cwd,active_group_id,thread_revision,delete_state,delete_json FROM thread_bindings').all()).toEqual(old);
    const indices = before.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all() as Array<{ name: string; sql: string }>;
    expect(indices.map(index => index.name).sort()).toEqual(['agents_page', 'agents_presentation_ordinal', 'groups_page', 'messages_claim', 'messages_receiver', 'operations_approval_requests', 'root_turns_boot']);
    const index = indices.find(item => item.name === 'operations_approval_requests')!.sql.replace(/\s+/g, '').toLowerCase();
    expect(index).toContain("onoperations(group_id,json_extract(data_json,'$.result.approval.bootid'),operation_id)");
    expect(index).toContain("wherejson_extract(data_json,'$.command')='approval_request'");
    const plan = before.prepare("EXPLAIN QUERY PLAN SELECT operation_id,data_json FROM operations WHERE group_id=? AND json_extract(data_json,'$.result.approval.bootId')=? AND json_extract(data_json,'$.command')='approval_request' AND operation_id>? ORDER BY operation_id LIMIT 50").all('group', 'old-boot', '') as Array<{ detail: string }>;
    expect(plan.some(row => row.detail.includes('operations_approval_requests'))).toBe(true);
  });

  it('Given a valid v2 denied row, Then reopening never reruns ALTER, regresses version or clears the latest receipt', () => {
    const file = path(); const first = store(file); const db = database(file);
    expect(version(db)).toBe(2);
    const receipt = '{"requestHash":"frozen-hash","receipt":{"operationId":"retained","state":"applied","executionAllowed":false}}';
    db.prepare(`INSERT INTO ${table} VALUES(?,?,?,?,?,?,?)`).run('profile', 'workspace', 4, 0, 123, 'desktop-user:profile', receipt);
    first.close(); store(file);
    expect(version(db)).toBe(2);
    expect(db.prepare(`SELECT * FROM ${table}`).get()).toMatchObject({ permission_revision: 4, execution_allowed: 0, actor_id: 'desktop-user:profile', last_receipt_json: receipt });
  });

  it.each([
    ['negative revision', -1, 1, null], ['fractional revision', 0.5, 1, null], ['unsafe revision', 9007199254740992, 1, null],
    ['text revision', 'invalid', 1, null], ['invalid allowed', 0, 2, null], ['invalid receipt JSON', 0, 1, '{broken'],
  ])('Given %s, Then actual SQLite rejects it while a valid row remains writable', (_label, revision, allowed, receipt) => {
    const file = path(); store(file); const db = database(file);
    expect(version(db)).toBe(2);
    const insert = db.prepare(`INSERT INTO ${table} VALUES(?,?,?,?,?,?,?)`);
    expect(() => insert.run('bad', 'workspace', revision as string | number, allowed as number, 0, null, receipt as string | null)).toThrow();
    insert.run('valid', 'workspace', 0, 1, 0, null, null);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toMatchObject({ n: 1 });
  });

  it('Given a pending approval counter, Then SQLite rejects negatives and keeps the original deletion receipt', () => {
    const file = path(); const db = legacy(file); store(file);
    expect(version(db)).toBe(2);
    expect(() => db.prepare('UPDATE thread_bindings SET pending_approval_count=-1').run()).toThrow();
    expect(db.prepare('SELECT pending_approval_count,delete_json FROM thread_bindings').get()).toMatchObject({ pending_approval_count: 0, delete_json: '{"operationId":"old-delete","result":{"state":"completed"}}' });
  });

  it.skipIf(!hasAuthorizer).each([0, 1])('Given schema %i and a real SQLite denial halfway through v2 DDL, Then the whole migration rolls back without partial authorization tables or approval columns', inputVersion => {
    const file = path(); const db = inputVersion ? legacy(file) : database(file); const original = DatabaseSync.prototype.exec;
    let denied = 0;
    vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function(this: DatabaseSync, sql: string) {
      const native = this as AuthorizerDb;
      if (typeof native.setAuthorizer !== 'function') throw new Error('Native SQLite authorizer is required for this DDL fault test');
      native.setAuthorizer((action, name) => { if (action === 1 && name === 'operations_approval_requests') { denied++; return 1; } return 0; });
      return original.call(this, sql);
    });
    expect(() => store(file), 'production migration must reach the frozen v2 index').toThrow();
    expect(denied).toBe(1);
    expect(version(db)).toBe(inputVersion);
    expect(db.prepare('SELECT name FROM sqlite_master WHERE name=?').get(table)).toBeUndefined();
    expect(columns(db, 'thread_bindings').some(column => column.name === 'pending_approval_count')).toBe(false);
    if (inputVersion) expect(db.prepare('SELECT delete_state FROM thread_bindings').get()).toMatchObject({ delete_state: 'deleted' });
    else expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
  });

  it('Given v1 before the deletion compatibility columns, Then the joint migration preserves the old row and installs deletion plus approval defaults together', () => {
    const file = path(); const db = legacy(file);
    db.exec('ALTER TABLE thread_bindings DROP COLUMN delete_json; ALTER TABLE thread_bindings DROP COLUMN delete_state');
    store(file);
    expect(version(db)).toBe(2);
    expect(db.prepare('SELECT thread_id,thread_revision,delete_state,delete_json,pending_approval_count FROM thread_bindings').get())
      .toMatchObject({ thread_id: 'old-thread', thread_revision: 12, delete_state: 'none', delete_json: null, pending_approval_count: 0 });
  });

  it.each(['missing-column', 'missing-index', 'wrong-index', 'wrong-check'])('Given malformed v2 (%s), Then reopening fails closed without repairing or deleting user rows', mutation => {
    const file = path(); const first = store(file); const db = database(file);
    expect(version(db)).toBe(2); first.close();
    if (mutation === 'missing-column') db.exec(`ALTER TABLE ${table} DROP COLUMN actor_id`);
    if (mutation === 'missing-index' || mutation === 'wrong-index') db.exec('DROP INDEX operations_approval_requests');
    if (mutation === 'wrong-index') db.exec('CREATE INDEX operations_approval_requests ON operations(group_id,operation_id)');
    if (mutation === 'wrong-check') {
      // Deliberately corrupt schema input, not an alternative migration.
      db.enableDefensive(false);
      try {
        db.exec('PRAGMA writable_schema=ON');
        db.prepare("UPDATE sqlite_master SET sql=replace(sql,'9007199254740991','9007199254740000') WHERE name=?").run(table);
      } finally { db.exec('PRAGMA writable_schema=OFF'); db.enableDefensive(true); }
    }
    const schema = db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all();
    expect(() => store(file)).toThrow();
    expect(db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all()).toEqual(schema);
    expect(version(db)).toBe(2);
  });

  it('Given an unknown higher version, Then the real store refuses it without dropping the file contents', () => {
    const file = path(); const db = legacy(file); db.exec('PRAGMA user_version=3');
    expect(() => store(file)).toThrow(/unsupported/);
    expect(version(db)).toBe(3);
    expect(db.prepare('SELECT thread_id FROM thread_bindings').get()).toMatchObject({ thread_id: 'old-thread' });
  });
});
