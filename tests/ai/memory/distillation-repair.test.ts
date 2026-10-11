import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LayeredMemoryStore, resolveLayeredConfig } from '../../../src/ai/memory/layered-store.js';
import { compactL0toL1 } from '../../../src/ai/memory/compaction.js';
import { runMigrations } from '../../../src/ai/memory/migrations.js';

vi.mock('../../../src/ai/memory/embedding.js', () => ({
  EmbeddingClient: class {
    embedAndStore = vi.fn(async () => {});
    close = vi.fn(async () => {});
    embed = vi.fn(async () => { throw new Error('offline embeddings'); });
  },
}));

describe('local memory distillation repair', () => {
  let root: string;
  let store: LayeredMemoryStore;
  let db: Database.Database;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'xiaok-memory-distillation-'));
    store = new LayeredMemoryStore({ dbPath: join(root, 'memory.db'), compaction: { autoCompact: false } });
    db = new Database(join(root, 'memory.db'));
  });
  afterEach(() => { store.close(); db.close(); rmSync(root, { recursive: true, force: true }); vi.useRealTimers(); });

  function seed(scope = 'global', cwd: string | null = null) {
    for (let i = 0; i < 3; i++) db.prepare(
      'INSERT INTO memory_l1_extracted(id,summary,scope,cwd) VALUES(?,?,?,?)',
    ).run(`${scope}-${i}`, `history ${i}`, scope, cwd);
  }
  function model() {
    return vi.fn(async (prompt: string) => prompt.includes('"scenarios"')
      ? JSON.stringify({ scenarios: [{ scenario: 'tools', key_facts: ['use TypeScript'] }, { scenario: 'style', key_facts: ['be concise'] }] })
      : JSON.stringify({ traits: [{ trait: 'concise', evidence: ['style'], confidence: 0.8 }] }));
  }
  it('defaults to automatic distillation and starts only after a model is attached', async () => {
    expect(resolveLayeredConfig().compaction?.autoCompact).toBe(true);
    store.close();
    vi.useFakeTimers();
    store = new LayeredMemoryStore({ dbPath: join(root, 'memory.db') });
    seed(); const llm = model(); store.setLLMFn(llm);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.getStats()).toMatchObject({ l2: 2, l3: 1 });
    const calls = llm.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(llm).toHaveBeenCalledTimes(calls);
  });
  it('rejects missing model instead of reporting successful compaction', async () => {
    await expect(store.compact({ requestSource: 'user' })).rejects.toThrow('memory_model_unavailable');
  });
  it('distills existing L1 with no new raw messages; force reruns history without duplicates', async () => {
    seed(); const llm = model(); store.setLLMFn(llm);
    expect(await store.compact({ requestSource: 'user' })).toMatchObject({ status: 'completed', l2: 2, l3: 1 });
    expect(await store.compact({ requestSource: 'user' })).toMatchObject({ status: 'unchanged' });
    expect(llm).toHaveBeenCalledTimes(2);
    await store.compact({ force: true, requestSource: 'user' });
    expect(llm).toHaveBeenCalledTimes(4);
    expect(store.getStats()).toMatchObject({ l1: 3, l2: 2, l3: 1 });
    expect(store.getPersonaTraits()[0].confidence).toBe(0.8);
  });
  it('advances existing L2 to L3 independently of L0 and L1', async () => {
    db.prepare('INSERT INTO memory_l2_scenario(id,scenario,key_facts) VALUES(?,?,?)').run('a', 'tools', '["TypeScript"]');
    db.prepare('INSERT INTO memory_l2_scenario(id,scenario,key_facts) VALUES(?,?,?)').run('b', 'style', '["concise"]');
    const llm = model(); store.setLLMFn(llm);
    await store.compact({ requestSource: 'user' });
    expect(store.getStats().l3).toBe(1);
    expect(llm).toHaveBeenCalledTimes(1);
  });
  it('uses the full original content of a directly saved memory', async () => {
    for (let i = 0; i < 3; i++) await store.save({ id: `direct${i}`, scope: 'global', title: 'short title', summary: `complete content ${i}`, tags: [], updatedAt: Date.now() });
    const llm = model(); store.setLLMFn(llm); await store.compact({ requestSource: 'user' });
    expect(llm.mock.calls[0][0]).toContain('complete content 0');
    expect(store.getStats().l1).toBe(3);
  });
  it('preserves previous derived facts after an invalid model response', async () => {
    seed(); store.setLLMFn(model()); await store.compact({ requestSource: 'user' });
    store.setLLMFn(async () => '{"scenarios":[{"scenario":null}]}');
    await expect(store.compact({ force: true, requestSource: 'user' })).rejects.toThrow();
    expect(store.getStats()).toMatchObject({ l2: 2, l3: 1 });
  });
  it('rejects concurrent work, agent mutation and stale responses after delete', async () => {
    seed(); let release!: (s: string) => void;
    store.setLLMFn(() => new Promise(resolve => { release = resolve; }));
    const pending = store.compact({ requestSource: 'user' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await expect(store.compact({ requestSource: 'user' })).rejects.toThrow('memory_compaction_busy');
    await expect(store.compact({ force: true, requestSource: 'agent' })).rejects.toThrow('memory_compaction_forbidden');
    await store.delete('global-0');
    release(JSON.stringify({ scenarios: [{ scenario: 'old', key_facts: ['deleted fact'] }] }));
    await expect(pending).rejects.toThrow('memory_inputs_changed');
    expect(store.getStats().l2).toBe(0);
  });
  it('does not commit a model response after the store has closed', async () => {
    seed(); let release!: (s: string) => void;
    store.setLLMFn(() => new Promise(resolve => { release = resolve; }));
    const pending = store.compact({ requestSource: 'user' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    store.close();
    release(JSON.stringify({ scenarios: [{ scenario: 'old', key_facts: ['fact'] }] }));
    await expect(pending).rejects.toThrow('memory_store_closed');
    expect(db.prepare('SELECT COUNT(*) c FROM memory_l2_scenario').get()).toEqual({ c: 0 });
  });
  it('keeps project scenarios and traits out of other projects and global persona', async () => {
    seed('project', '/project/a'); store.setLLMFn(model()); await store.compact({ requestSource: 'user' });
    expect(store.getPersonaTraits()).toEqual([]);
    expect(await store.listRelevant({ cwd: '/project/b', query: 'concise' })).toEqual([]);
    expect((await store.listRelevant({ cwd: '/project/a', query: 'concise' })).some(r => r.scope === 'project')).toBe(true);
  });
  it('preserves standalone project history while another scope has new L1', async () => {
    seed();
    for (const id of ['a', 'b']) db.prepare('INSERT INTO memory_l2_scenario(id,scenario,key_facts,scope,cwd) VALUES(?,?,?,?,?)')
      .run(id, id, '["history"]', 'project', '/standalone');
    store.setLLMFn(model()); await store.compact({ requestSource: 'user' });
    expect(db.prepare('SELECT COUNT(*) c FROM memory_l2_scenario WHERE cwd=?').get('/standalone')).toEqual({ c: 2 });
    expect(db.prepare('SELECT COUNT(*) c FROM memory_l3_persona WHERE cwd=?').get('/standalone')).toEqual({ c: 1 });
  });
  it('rebuilds identical inputs after clear and removes derived groups whose inputs disappear', async () => {
    seed(); const llm = model(); store.setLLMFn(llm); await store.compact({ requestSource: 'user' });
    store.clearAll(); seed(); await store.compact({ requestSource: 'user' });
    expect(store.getStats()).toMatchObject({ l2: 2, l3: 1 });
    for (let i = 0; i < 3; i++) await store.delete(`global-${i}`);
    await store.compact({ requestSource: 'user' });
    expect(store.getStats()).toMatchObject({ l2: 0, l3: 0 });
  });
  it('submits every part of long history and retains old facts if a later batch fails', async () => {
    seed();
    db.prepare('UPDATE memory_l1_extracted SET summary=? WHERE id=?').run('BEGIN ' + 'x'.repeat(80_000) + ' END', 'global-0');
    const llm = model(); store.setLLMFn(llm); await store.compact({ requestSource: 'user' });
    const prompts = llm.mock.calls.map(call => call[0]).join('');
    expect(prompts).toContain('BEGIN'); expect(prompts).toContain('END');
    expect(llm.mock.calls.filter(call => call[0].includes('"scenarios"')).length).toBeGreaterThan(2);
    const prior = store.listLayer(2);
    let calls = 0;
    store.setLLMFn(async () => { if (++calls === 2) throw new Error('second batch failed'); return '{"scenarios":[{"scenario":"replacement","key_facts":["partial"]}]}'; });
    await expect(store.compact({ requestSource: 'user', force: true })).rejects.toThrow('second batch failed');
    expect(store.listLayer(2)).toEqual(prior);
  });
});

describe('raw compaction does not discard unseen historical messages', () => {
  it('marks only the messages actually presented to the model', async () => {
    const db = new Database(':memory:'); runMigrations(db);
    try {
      db.prepare('INSERT INTO memory_l0_raw(id,session_id,role,content) VALUES(?,?,?,?)').run('large', 's', 'user', 'x'.repeat(50_000));
      for (let i = 0; i < 6; i++) db.prepare('INSERT INTO memory_l0_raw(id,session_id,role,content) VALUES(?,?,?,?)').run(`s${i}`, 's', 'user', 'short');
      await compactL0toL1(db, async () => '{"summaries":[{"summary":"short facts","tags":[]}]}');
      expect(db.prepare('SELECT compacted FROM memory_l0_raw WHERE id=?').get('large')).toEqual({ compacted: 0 });
    } finally { db.close(); }
  });
});
