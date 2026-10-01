// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';

const v2 = readFileSync(new URL('../fixtures/multi-agent-v2.sql', import.meta.url), 'utf8');
const ordinalSql = "CREATE UNIQUE INDEX operations_presentation_ordinal ON operations(group_id,json_extract(data_json,'$.presentationReservation.ordinal')) WHERE json_extract(data_json,'$.presentationReservation.ordinal') IS NOT NULL";
const agentSql = "CREATE UNIQUE INDEX operations_presentation_agent ON operations(group_id,json_extract(data_json,'$.presentationReservation.agentId')) WHERE json_extract(data_json,'$.presentationReservation.agentId') IS NOT NULL";
const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-multi-agent-v2-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'groups.sqlite');
  const db = new DatabaseSync(file);
  cleanup.push(() => db.close());
  db.exec(v2);
  db.prepare('INSERT INTO thread_bindings(thread_id,profile_id,workspace_id,cwd,thread_revision,pending_approval_count) VALUES(?,?,?,?,?,?)').run('t', 'p', 'w', root, 12, 3);
  db.prepare('INSERT INTO boot_owners VALUES(?,?,?)').run('old-boot', 1, 'exited');
  db.prepare('INSERT INTO groups VALUES(?,?,?,?,?,?,?,?)').run('g', 't', 'old-boot', 1, 1, 0, '{"groupId":"g"}', 15);
  db.prepare('INSERT INTO workspace_execution_authorizations VALUES(?,?,?,?,?,?,?)').run('p', 'w', 4, 0, 123, 'user', '{"receipt":{"state":"applied","executionAllowed":false}}');
  return { file, db };
}
function open(file: string) {
  const store = new DesktopMultiAgentStore(file, { bootId: 'new-boot' });
  cleanup.push(() => store.close());
  return store;
}
const version = (db: DatabaseSync) => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
function schema(db: DatabaseSync) { return db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(); }
function rows(db: DatabaseSync) {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
  return names.map(({ name }) => ({ name, rows: db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all() }));
}
function operation(db: DatabaseSync, id: string, ordinal: number, agentId: string) {
  const json = JSON.stringify({ presentationReservation: { ordinal, agentId } });
  db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run('g', id, json, Buffer.byteLength(json));
}

describe('actual v2 to v3 presentation index migration', () => {
  it.each(['missing', 'partial', 'already-present'])('upgrades v2 with %s new indexes, retains every row and reopens idempotently', state => {
    const { file, db } = fixture();
    operation(db, 'old-operation', 1, 'old-agent');
    if (state !== 'missing') db.exec(ordinalSql);
    if (state === 'already-present') db.exec(agentSql);
    const before = rows(db);
    open(file).close();
    expect(version(db)).toBe(3);
    expect(rows(db)).toEqual(before);
    const upgraded = schema(db);
    expect(upgraded.filter(row => String(row.name).startsWith('operations_presentation_'))).toHaveLength(2);
    open(file).close();
    expect(version(db)).toBe(3);
    expect(schema(db)).toEqual(upgraded);
    expect(rows(db)).toEqual(before);
  });

  it.each(['ordinal', 'agentId'])('rolls back both new indexes and the version on a real duplicate %s', key => {
    const { file, db } = fixture();
    operation(db, 'one', 1, 'one');
    operation(db, 'two', key === 'ordinal' ? 1 : 2, key === 'agentId' ? 'one' : 'two');
    const beforeSchema = schema(db), beforeRows = rows(db);
    expect(() => open(file)).toThrow(/UNIQUE/);
    expect(version(db)).toBe(2);
    expect(schema(db)).toEqual(beforeSchema);
    expect(rows(db)).toEqual(beforeRows);
  });

  it.each(['old-index', 'new-index'])('refuses a malformed %s in v2 without silently repairing it', mutation => {
    const { file, db } = fixture();
    db.exec(mutation === 'old-index' ? 'DROP INDEX agents_page'
      : 'CREATE INDEX operations_presentation_ordinal ON operations(operation_id)');
    const beforeSchema = schema(db), beforeRows = rows(db);
    expect(() => open(file)).toThrow(/multi_agent_schema_invalid/);
    expect(version(db)).toBe(2);
    expect(schema(db)).toEqual(beforeSchema);
    expect(rows(db)).toEqual(beforeRows);
  });

  it('refuses a damaged v3 instead of treating it as a pending v2 migration', () => {
    const { file, db } = fixture();
    open(file).close();
    db.exec('DROP INDEX operations_presentation_ordinal');
    const before = schema(db);
    expect(() => open(file)).toThrow(/multi_agent_schema_invalid:operations_presentation_ordinal/);
    expect(version(db)).toBe(3);
    expect(schema(db)).toEqual(before);
  });
});
