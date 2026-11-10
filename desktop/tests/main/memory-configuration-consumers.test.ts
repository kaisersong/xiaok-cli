// @vitest-environment node
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { DEFAULT_CONFIG, type Config } from '../../../src/types.js';
import { normalizeMemoryConfiguration, isCompactionModel } from '../../../src/ai/memory/configuration.js';
import { LayeredMemoryStore } from '../../../src/ai/memory/layered-store.js';
import { MemorySettingsService } from '../../electron/memory-settings-service.js';
import { EmbeddingClient } from '../../../src/ai/memory/embedding.js';
import { loadConfig, saveConfig, updateConfigCredential as updateConfig } from '../../../src/utils/config.js';

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'memory-consumer-')); roots.push(root);
  const store = new LayeredMemoryStore({ dbPath: join(root, 'memory.db'), compaction: { l0MinMessages: 1 } });
  return { root, store };
}
function config(): Config {
  return { ...structuredClone(DEFAULT_CONFIG), defaultModelId: 'text-a',
    providers: { fixture: { type: 'custom', protocol: 'openai_legacy', baseUrl: 'http://127.0.0.1:1' } },
    models: { 'text-a': { provider: 'fixture', model: 'text-a', label: 'Text A', capabilities: ['text_generation'] },
      'text-b': { provider: 'fixture', model: 'text-b', label: 'Text B', capabilities: ['text_generation'] },
      decision: { provider: 'fixture', model: 'decision', label: 'Decision', capabilities: ['decision'] } },
    memory: { modelId: 'bge-small-zh-v1.5', compaction: { l0MinMessages: 1 } } };
}
describe('memory settings → real consumers (synthetic only)', () => {
  it('migrates historical embedding independently and keeps explicit values', () => {
    const c = config(); const next = normalizeMemoryConfiguration(c);
    expect(next.embedding?.model).toBe('bge-small-zh-v1.5');
    expect(next.compaction?.modelId).toBeNull();
    expect(next.modelId).toBeUndefined();
    c.memory = { modelId: 'text-a', embedding: { model: 'all-MiniLM-L6-v2' }, compaction: { modelId: 'text-b' } };
    expect(normalizeMemoryConfiguration(c).compaction?.modelId).toBe('text-b');
    c.memory = { modelId: 'unknown-old' };
    expect(normalizeMemoryConfiguration(c).legacyModelId).toBe('unknown-old');
    c.memory = { modelId: 'unknown-old', compaction: { modelId: 'text-b' } };
    expect(normalizeMemoryConfiguration(c).legacyModelUnresolved).toBe(false);
  });
  it('persists migration and selections using the production config store and reloads after close', async () => {
    const { root, store } = fixture(); vi.stubEnv('XIAOK_CONFIG_DIR', root);
    const c = config(); await saveConfig(c);
    const service = new MemorySettingsService({ load: loadConfig, save: saveConfig, update: updateConfig, store });
    expect((await service.settings({ requestSource: 'user' })).embeddingModelId).toBe('bge-small-zh-v1.5');
    await service.setCompactionModel('text-b', { requestSource: 'user' });
    store.close();
    const restarted = new LayeredMemoryStore({ dbPath: join(root, 'memory.db') });
    const fresh = new MemorySettingsService({ load: loadConfig, save: saveConfig, store: restarted });
    expect((await fresh.settings({ requestSource: 'user' })).compactionModelId).toBe('text-b');
    const saved = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
    expect(saved.memory.modelId).toBeUndefined(); expect(saved.memory.embedding.model).toBe('bge-small-zh-v1.5');
    expect(saved.providers).toEqual(c.providers); restarted.close();
  });
  it('refreshes config at commit so another settings writer is preserved', async () => {
    const { root, store } = fixture(); vi.stubEnv('XIAOK_CONFIG_DIR', root); await saveConfig(config());
    const service = new MemorySettingsService({ load: loadConfig, save: saveConfig, store, update: async mutate => {
      await updateConfig(current => ({ ...current, skillDebug: true, memory: { ...current.memory, embedding: { model: 'bge-small-zh-v1.5' } } }));
      return updateConfig(mutate);
    } });
    await service.setCompactionModel('text-b', { requestSource: 'user' });
    expect(await loadConfig()).toMatchObject({ skillDebug: true, memory: { embedding: { model: 'bge-small-zh-v1.5' }, compaction: { modelId: 'text-b' } } });
    store.close();
  });
  it('rejects embedding/decision models and unauthorized writers', async () => {
    const c = config(); const { store } = fixture();
    const service = new MemorySettingsService({ load: async () => c, save: async () => {}, store });
    expect(isCompactionModel(c, 'decision')).toBe(false);
    await expect(service.setCompactionModel('bge-small-zh-v1.5', { requestSource: 'user' })).rejects.toThrow();
    await expect(service.setEmbeddingModel('all-MiniLM-L6-v2', { requestSource: 'agent' })).rejects.toThrow();
    await expect(service.compact({ requestSource: 'scheduler' })).rejects.toThrow();
    await expect(service.settings({ requestSource: 'agent' })).rejects.toThrow();
    expect(() => service.cancel({ requestSource: 'agent' })).toThrow();
    store.close();
  });
  it('persists independent selections, survives restart, uses the selected LLM and invalidates the actual DB', async () => {
    let c = config(); const { store, root } = fixture(); const seen: string[] = [];
    const deps = { load: async () => structuredClone(c), save: async (next: Config) => { c = structuredClone(next); }, store,
      isDownloaded: () => true,
      createLLM: (_c: Config, id: string) => async () => { seen.push(id); return '{"summaries":[{"summary":"Synthetic preference","tags":[]}]}'; } };
    const service = new MemorySettingsService(deps);
    await service.setCompactionModel('text-b', { requestSource: 'user' });
    await service.setEmbeddingModel('all-MiniLM-L6-v2', { requestSource: 'user' });
    expect((await new MemorySettingsService(deps).settings({ requestSource: 'user' })).compactionModelId).toBe('text-b');
    expect(c.memory?.embedding?.model).toBe('all-MiniLM-L6-v2');
    await store.writeRawMessage('synthetic', 'user', 'Synthetic preference');
    expect((await service.compact({ requestSource: 'user' })).status).toBe('completed');
    expect(seen).toEqual(['text-b']);
    const db = new Database(join(root, 'memory.db'));
    db.prepare('INSERT INTO memory_embeddings (memory_id,layer,embedding) VALUES (?,1,?)').run('fixture', Buffer.alloc(4));
    await service.setEmbeddingModel('bge-small-zh-v1.5', { requestSource: 'user' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM memory_embeddings').get()).toEqual({ n: 0 });
    db.close(); store.close();
  });
  it('reports no LLM, no input, failures, cancellation and busy truthfully', async () => {
    const {store}=fixture();
    await expect(store.compact({requestSource:'user'})).rejects.toThrow('memory_model_unavailable');
    store.setLLMFn(async()=>'{"summaries":[]}');
    expect(await store.compact({requestSource:'user'})).toEqual({status:'unchanged',l1:0,l2:0,l3:0});
    await store.writeRawMessage('synthetic','user','Only synthetic text');
    store.setLLMFn(async()=>{throw undefined});
    await expect(store.compact({requestSource:'user'})).rejects.toBeUndefined();
    let resolve!:(value:string)=>void;store.setLLMFn(()=>new Promise(r=>{resolve=r}));
    const controller=new AbortController();const pending=store.compact({requestSource:'user',signal:controller.signal});const result=pending.catch(error=>error);
    await expect(store.compact({requestSource:'user'})).rejects.toThrow('memory_compaction_busy');
    controller.abort();let finished=false;void result.then(()=>{finished=true});await Promise.resolve();expect(finished).toBe(false);
    resolve('{"summaries":[{"summary":"Late synthetic reply","tags":[]}]}');await result;
    expect(store.getStats().l1).toBe(0);await store.close();
  });
  it('does not consume truncated messages or promote project evidence into global layers', async () => {
    const { root, store } = fixture(); const db = new Database(join(root, 'memory.db'));
    db.prepare('INSERT INTO memory_l0_raw (id,session_id,role,content,scope,cwd) VALUES (?,?,?,?,?,?)').run('long', 's', 'user', 'x'.repeat(40000), 'project', '/synthetic-project');
    db.prepare('INSERT INTO memory_l0_raw (id,session_id,role,content,scope,cwd) VALUES (?,?,?,?,?,?)').run('short', 's', 'user', 'synthetic project preference', 'project', '/synthetic-project');
    store.setLLMFn(async () => '{"summaries":[{"summary":"Synthetic project preference","tags":[]}]}');
    expect((await store.compact({requestSource:'user'})).status).toBe('completed');
    expect(db.prepare('SELECT compacted FROM memory_l0_raw WHERE id=?').get('long')).toEqual({ compacted: 0 });
    expect(db.prepare('SELECT scope,cwd,source_ids FROM memory_l1_extracted').get()).toEqual({ scope: 'project', cwd: '/synthetic-project', source_ids: '["short"]' });
    expect(await store.listRelevant({ cwd: '/other-synthetic-project', query: 'preference' })).toEqual([]);
    const relevant = await store.listRelevant({ cwd: '/synthetic-project', query: 'preference' });
    expect(relevant.length).toBeGreaterThan(0);
    expect(relevant.every(r => r.scope === 'project' && r.cwd === '/synthetic-project')).toBe(true);
    await store.configureEmbedding({ provider: 'api', model: 'synthetic-vectors', dimensions: 2, apiUrl: 'http://synthetic.invalid' },{requestSource:'user'});
    const vector = Buffer.from(new Float32Array([1, 0]).buffer);
    db.prepare('INSERT INTO memory_embeddings (memory_id,layer,embedding) VALUES (?,0,?)').run('short', vector);
    const extractedId = (db.prepare('SELECT id FROM memory_l1_extracted').get() as { id: string }).id;
    db.prepare('INSERT INTO memory_embeddings (memory_id,layer,embedding) VALUES (?,1,?)').run(extractedId, vector);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ embedding: [1, 0] }] })));
    expect(await store.listRelevant({ cwd: '/other-synthetic-project', query: 'no-keyword-match' })).toEqual([]);
    const vectors = await store.listRelevant({ cwd: '/synthetic-project', query: 'no-keyword-match' });
    expect(vectors).toHaveLength(2);
    expect(vectors.every(r => r.scope === 'project' && r.cwd === '/synthetic-project')).toBe(true);
    db.close(); store.close();
  });
  it('changing compaction selection cancels the admitted owner without releasing a pending provider body early', async()=>{
    const {store}=fixture();let c=config();c.memory={compaction:{modelId:'text-a'}};
    await store.writeRawMessage('s','user','Synthetic timeout fixture');
    let resolve!:(reply:string)=>void;let entered!:(value:void)=>void;const ready=new Promise<void>(r=>{entered=r});
    const service=new MemorySettingsService({load:async()=>structuredClone(c),save:async next=>{c=next},store,createLLM:()=>async()=>{entered();return new Promise(r=>{resolve=r})}});
    const pending=service.compact({requestSource:'user'});const result=pending.catch(error=>error);await ready;
    await expect(service.compact({requestSource:'user'})).rejects.toThrow('memory_compaction_busy');
    await service.setCompactionModel('text-b',{requestSource:'user'});
    let finished=false;void result.then(()=>{finished=true});await Promise.resolve();expect(finished).toBe(false);
    resolve('{"summaries":[{"summary":"Late","tags":[]}]}');await result;expect(store.getStats().l1).toBe(0);await store.close();
  });
  it('surfaces missing credentials and unavailable backend without invoking a provider',async()=>{
    const {store}=fixture();const c=config();c.memory={compaction:{modelId:'text-a'}};
    c.providers.fixture={type:'first_party',protocol:'openai_legacy'};
    vi.stubEnv('XIAOK_FIXTURE_API_KEY','');vi.stubEnv('FIXTURE_API_KEY','');
    await store.writeRawMessage('s','user','Synthetic credential fixture');
    const service=new MemorySettingsService({load:async()=>c,save:async()=>{},store});
    await expect(service.compact({requestSource:'user'})).rejects.toThrow();expect(store.getStats().l1).toBe(0);
    const createLLM=vi.fn();const unavailable=new MemorySettingsService({load:async()=>c,save:async()=>{},store:{save:async()=>{},listRelevant:async()=>[]},createLLM});
    await expect(unavailable.compact({requestSource:'user'})).rejects.toThrow('memory_backend_unavailable');expect(createLLM).not.toHaveBeenCalled();await store.close();
  });
  it('rejects malformed and empty responses without consuming sources and preserves earlier real commits on later failure',async()=>{
    const {store,root}=fixture();await store.writeRawMessage('s','user','Synthetic validation fixture');
    for(const reply of ['private body','{"summaries":[{"summary":12,"tags":[]}]}','{"summaries":[]}']){
      store.setLLMFn(async()=>reply);await expect(store.compact({requestSource:'user'})).rejects.toThrow();expect(store.getStats().l1).toBe(0);
    }
    await store.writeRawMessage('s2','user','Synthetic second session');
    const failure=Error('synthetic failure');store.setLLMFn(vi.fn().mockResolvedValueOnce('{"summaries":[{"summary":"synthetic committed","tags":[]}]}').mockRejectedValueOnce(failure));
    await expect(store.compact({requestSource:'user'})).rejects.toBe(failure);expect(store.getStats().l1).toBe(1);
    const db=new Database(join(root,'memory.db'));expect(db.prepare('SELECT COUNT(*) AS n FROM memory_l0_raw WHERE compacted=0').get()).toEqual({n:1});db.close();await store.close();
  });
  it('prevents an old admitted embedding write from repopulating the cache after a completed model switch',async()=>{
    const {root,store}=fixture();await store.configureEmbedding({provider:'api',model:'old',dimensions:2,apiUrl:'https://synthetic.invalid'},{requestSource:'user'});
    const db=new Database(join(root,'memory.db'));let resolve!:(reply:Response)=>void;vi.spyOn(globalThis,'fetch').mockImplementation(()=>new Promise(r=>{resolve=r}));
    const client=(store as unknown as {embeddingClient:EmbeddingClient}).embeddingClient;
    const pending=client.embedAndStore('synthetic',1,'synthetic fixture');const change=store.configureEmbedding({provider:'local',model:'bge-small-zh-v1.5',dimensions:512,apiUrl:''},{requestSource:'user'});
    resolve(new Response(JSON.stringify({data:[{embedding:[1,0]}]})));await pending;await change;
    expect(db.prepare('SELECT COUNT(*) AS n FROM memory_embeddings').get()).toEqual({n:0});db.close();await store.close();
  });

});
