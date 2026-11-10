// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { LayeredMemoryStore } from '../../../src/ai/memory/layered-store.js';
import { EmbeddingClient, getLiveEmbeddingModelIds } from '../../../src/ai/memory/embedding.js';
import {MemorySettingsService} from '../../electron/memory-settings-service.js';
import {DEFAULT_CONFIG,type Config} from '../../../src/types.js';
import { OnnxEmbeddingEngine } from '../../../src/ai/memory/onnx-engine.js';
const roots: string[] = []; const stores: LayeredMemoryStore[] = [];
afterEach(async () => { vi.restoreAllMocks(); for(const s of stores.splice(0)) await s.close(); for(const r of roots.splice(0)) rmSync(r,{recursive:true,force:true}); });
function fixture(){const root=mkdtempSync(join(tmpdir(),'memory-owner-'));roots.push(root);const store=new LayeredMemoryStore({dbPath:join(root,'memory.db'),compaction:{autoCompact:false,l0MinMessages:1}});stores.push(store);return {root,store};}
function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(r=>{resolve=r});return {promise,resolve}; }
describe('actual memory owner lifecycle',()=>{
 it('cancels through the same owner, retains busy until the original body settles and fences late writes',async()=>{
  const {store}=fixture();await store.writeRawMessage!('s','user','synthetic preference');
  const body=deferred<string>();let signal:AbortSignal|undefined;
  store.setLLMFn(async(_prompt,s)=>{signal=s;return body.promise});
  const pending=store.compact({requestSource:'user',force:true});const observed=pending.catch(e=>e);
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(()=>store.cancelCompaction({requestSource:'agent'})).toThrow('memory_compaction_forbidden');
  expect(store.cancelCompaction({requestSource:'user'})).toBe(true);expect(signal!.aborted).toBe(true);
  await expect(store.compact({requestSource:'user'})).rejects.toThrow('memory_compaction_busy');
  body.resolve('{"summaries":[{"summary":"late","tags":[]}]}');await observed;
  expect(store.getStats().l1).toBe(0);expect(store.cancelCompaction({requestSource:'user'})).toBe(false);
 });
 it('joins old admitted vector writes before clearing and opening the new embedding generation',async()=>{
  const {root,store}=fixture();await store.configureEmbedding({provider:'api',model:'old',dimensions:2,apiUrl:'https://synthetic.invalid'},{requestSource:'user'});
  const body=deferred<Response>();vi.spyOn(globalThis,'fetch').mockImplementation(()=>body.promise);
  const db=new Database(join(root,'memory.db'));
  const client=(store as unknown as {embeddingClient:EmbeddingClient}).embeddingClient;
  const pending=client.embedAndStore('old-row',1,'old text');
  const change=store.configureEmbedding({provider:'api',model:'new',dimensions:2,apiUrl:'https://synthetic.invalid'},{requestSource:'user'});
  let settled=false;void change.then(()=>{settled=true});await Promise.resolve();expect(settled).toBe(false);
  await expect(client.embed('new admission')).rejects.toThrow('embedding_configuration_changed');
  body.resolve(new Response(JSON.stringify({data:[{embedding:[1,0]}]})));await pending;await change;
  expect(db.prepare('SELECT COUNT(*) AS n FROM memory_embeddings').get()).toEqual({n:0});expect(store.getEmbeddingModelId()).toBe('new');db.close();
 });
 it('awaits the actual ONNX release promise before clearing its session',async()=>{
  const engine=new OnnxEmbeddingEngine('synthetic');const release=deferred<void>();const session={release:vi.fn(()=>release.promise)};
  (engine as unknown as {session:unknown}).session=session;
  const pending=engine.close();expect((engine as unknown as {session:unknown}).session).toBe(session);
  release.resolve();await pending;expect((engine as unknown as {session:unknown}).session).toBeNull();
 });
 it('recovers a failed reconfiguration only after the original release actually succeeds',async()=>{
  const {root}=fixture();const db=new Database(join(root,'memory.db'));const client=new EmbeddingClient(db,{provider:'local',model:'old-held',dimensions:2,apiUrl:''});
  const close=vi.spyOn(OnnxEmbeddingEngine.prototype,'close').mockRejectedValueOnce(undefined).mockResolvedValue(undefined);
  await expect(client.configure({provider:'local',model:'new-held',dimensions:2,apiUrl:''})).rejects.toBeUndefined();
  expect(getLiveEmbeddingModelIds()).toContain('old-held');await expect(client.embed('blocked')).rejects.toThrow('embedding_configuration_changed');
  await client.configure({provider:'local',model:'new-held',dimensions:2,apiUrl:''});expect(close).toHaveBeenCalledTimes(2);
  expect(client.getModelId()).toBe('new-held');expect(getLiveEmbeddingModelIds()).not.toContain('old-held');expect(getLiveEmbeddingModelIds()).toContain('new-held');
  await client.close();db.close();
 });
 it('does not treat the same configured model ID as proof that a failed runtime reconfiguration recovered',async()=>{
  const {store}=fixture();let config:Config={...structuredClone(DEFAULT_CONFIG),memory:{embedding:{provider:'local',model:'all-MiniLM-L6-v2',dimensions:384}}};
  const service=new MemorySettingsService({load:async()=>structuredClone(config),save:async next=>{config=next},store,isDownloaded:()=>true});
  const close=vi.spyOn(OnnxEmbeddingEngine.prototype,'close').mockRejectedValueOnce(undefined).mockResolvedValue(undefined);
  await expect(service.setEmbeddingModel('bge-small-zh-v1.5',{requestSource:'user'})).rejects.toBeUndefined();
  await service.setEmbeddingModel('all-MiniLM-L6-v2',{requestSource:'user'});
  expect(close).toHaveBeenCalledTimes(2);
  const client=(store as unknown as {embeddingClient:EmbeddingClient}).embeddingClient;await expect(client.embedBatch([])).resolves.toEqual([]);
 });
 it('protects both the admitted target and old local model while the original close is still pending',async()=>{
  const {root}=fixture();const db=new Database(join(root,'memory.db'));const client=new EmbeddingClient(db,{provider:'local',model:'old-reserved',dimensions:2,apiUrl:''});
  const release=deferred<void>();vi.spyOn(OnnxEmbeddingEngine.prototype,'close').mockImplementationOnce(()=>release.promise).mockResolvedValue(undefined);
  const pending=client.configure({provider:'local',model:'target-reserved',dimensions:2,apiUrl:''});
  try {expect(getLiveEmbeddingModelIds()).toEqual(expect.arrayContaining(['old-reserved','target-reserved']));}
  finally {release.resolve();await pending;await client.close();db.close();}
 });
 it('retains a failed native release in the actual live stock and retries close without dropping the old model',async()=>{
  const {root}=fixture();const db=new Database(join(root,'memory.db'));
  const client=new EmbeddingClient(db,{provider:'local',model:'synthetic-held',dimensions:2,apiUrl:''});
  vi.spyOn(OnnxEmbeddingEngine.prototype,'close').mockRejectedValueOnce(undefined).mockResolvedValueOnce();
  await expect(client.close()).rejects.toBeUndefined();expect(getLiveEmbeddingModelIds()).toContain('synthetic-held');
  await client.close();expect(getLiveEmbeddingModelIds()).not.toContain('synthetic-held');db.close();
 });
});
