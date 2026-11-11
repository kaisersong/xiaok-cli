import { describe, it, expect } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ConversationActivityStore } from '../../../src/runtime/conversation-activity/store.js';

// Crash durability of the activity writer (WAL + synchronous=NORMAL, FULL for terminal states).
// A child process writes through the real store and acks each committed write on stdout; the
// parent kills it hard (SIGKILL / taskkill /F) and reopens the file. Process death is not power
// loss: every acked commit must survive, and an open transaction must leave exactly nothing.
const storeUrl = new URL('../../../src/runtime/conversation-activity/store.js', import.meta.url).href;

const CHILD = String.raw`
const [storeUrl, file, mode, total] = process.argv.slice(1);
const { ConversationActivityStore } = await import(storeUrl);
const now = 1000;
const origin = { profileId: 'profile', threadId: 'thread', workspaceId: 'workspace', actorId: 'user' };
const event = (s, kind = 'progress') => ({ schemaVersion: 1, eventId: 'event-' + s, source: 'task_host', logicalSourceId: 'host', sourceDataEpoch: 'epoch', workId: 'task', runId: '', transportGeneration: 1, sourceSequence: s, kind, occurredAt: now, receivedAt: now, summary: 'phase ' + s, evidenceRefs: [] });
const store = new ConversationActivityStore(file, { now: () => now });
store.prepareAssociation({ operationId: 'operation', creationIdempotencyKey: 'creation', origin });
store.bindWork({ operationId: 'operation', watchId: 'watch', source: 'task_host', logicalSourceId: 'host', sourceDataEpoch: 'epoch', workId: 'task', runId: '' });
const ack = (line) => process.stdout.write(line + '\n');
const hold = () => setInterval(() => {}, 1 << 30);
if (mode === 'acked') {
  const n = Number(total);
  for (let s = 1; s <= n; s++) { store.ingest('watch', event(s, s === n ? 'completed' : 'progress')); ack('ack ' + s); }
  hold();
} else if (mode === 'random') {
  let s = 0;
  const tick = () => { for (let i = 0; i < 20; i++) { s++; store.ingest('watch', event(s)); ack('ack ' + s); } setImmediate(tick); };
  tick();
} else if (mode === 'midtx') {
  const n = Number(total);
  for (let s = 1; s <= n; s++) { store.ingest('watch', event(s)); ack('ack ' + s); }
  const db = store.db;
  db.exec('CREATE TABLE crash_probe(id INTEGER PRIMARY KEY, payload BLOB NOT NULL)');
  db.exec('PRAGMA cache_size=1');
  db.exec('BEGIN');
  db.exec("UPDATE source_events SET content_json = content_json || ' '");
  const insert = db.prepare('INSERT INTO crash_probe(payload) VALUES (randomblob(4096))');
  for (let i = 0; i < 4000; i++) insert.run();
  ack('in transaction');
  hold();
}
`;

function startChild(file: string, mode: string, total = 0) {
  const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', CHILD, storeUrl, file, mode, String(total)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout!.setEncoding('utf8').on('data', (d: string) => { out += d; });
  child.stderr!.setEncoding('utf8').on('data', (d: string) => { err += d; });
  const waitFor = (line: string, timeoutMs = 60_000) => new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (out.split('\n').includes(line)) return resolve();
      if (child.exitCode !== null) return reject(new Error(`child exited ${child.exitCode} before "${line}": ${err}`));
      if (Date.now() - started > timeoutMs) return reject(new Error(`no "${line}" within ${timeoutMs}ms: ${err}`));
      setTimeout(poll, 2);
    };
    poll();
  });
  return { child, waitFor, acked: () => out.split('\n').filter((l) => l.startsWith('ack ')).length };
}

async function killHard(child: ChildProcess) {
  const exited = new Promise((resolve) => child.once('exit', resolve));
  if (process.platform === 'win32') spawnSync('taskkill', ['/F', '/PID', String(child.pid)], { stdio: 'ignore' });
  else child.kill('SIGKILL');
  await exited;
}

function inspect(file: string) {
  // Reopen through the real writer first (recovery + its open-time pragma assertions), then read raw.
  new ConversationActivityStore(file, { now: () => 1000 }).close();
  const db = new DatabaseSync(file);
  try {
    const integrity = (db.prepare('PRAGMA integrity_check').all() as Array<Record<string, string>>).map((r) => Object.values(r)[0]);
    const rows = db.prepare('SELECT content_json FROM source_events').all() as Array<{ content_json: string }>;
    const sequences = rows.map((r) => (JSON.parse(r.content_json) as { sourceSequence: number }).sourceSequence).sort((a, b) => a - b);
    const probe = db.prepare("SELECT name FROM sqlite_master WHERE name = 'crash_probe'").get()
      ? Number((db.prepare('SELECT count(*) AS n FROM crash_probe').get() as { n: number }).n) : null;
    return { integrity, sequences, contents: rows.map((r) => r.content_json), probe };
  } finally { db.close(); }
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('conversation activity writer survives a hard kill', () => {
  it.each([1, 2, 3])('keeps every acked commit, terminal included, after a kill right after the last ack (round %s)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'activity-crash-'));
    const file = join(root, 'a.sqlite');
    try {
      const run = startChild(file, 'acked', 200);
      await run.waitFor('ack 200');
      await killHard(run.child);
      const after = inspect(file);
      expect(after.integrity).toEqual(['ok']);
      expect(after.sequences).toEqual(range(200));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it.each([1, 2, 3, 4, 5])('stays uncorrupted and keeps an acked prefix after a kill at a random moment (round %s)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'activity-crash-'));
    const file = join(root, 'a.sqlite');
    try {
      const run = startChild(file, 'random');
      await run.waitFor('ack 1');
      await new Promise((r) => setTimeout(r, 20 + Math.floor(Math.random() * 300)));
      await killHard(run.child);
      const acked = run.acked();
      const after = inspect(file);
      expect(after.integrity).toEqual(['ok']);
      // A commit may land after its ack was cut off, never the reverse. The writer compacts progress
      // to the latest 256 events per watch, so the rows are exactly the gapless window ending at the
      // newest committed sequence.
      const newest = after.sequences.at(-1) ?? 0;
      expect(newest).toBeGreaterThanOrEqual(acked);
      expect(after.sequences).toEqual(range(newest).slice(-256));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it.each([1, 2, 3])('leaves exactly zero rows from a transaction killed midway after it spilled pages (round %s)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'activity-crash-'));
    const file = join(root, 'a.sqlite');
    try {
      const run = startChild(file, 'midtx', 50);
      await run.waitFor('in transaction');
      await killHard(run.child);
      const after = inspect(file);
      expect(after.integrity).toEqual(['ok']);
      expect(after.probe).toBe(0);
      expect(after.sequences).toEqual(range(50));
      expect(after.contents.every((c) => !c.endsWith(' '))).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
