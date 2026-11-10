// @vitest-environment node
import {afterEach,describe,it,expect,vi} from 'vitest';
import * as fs from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {DEFAULT_CONFIG,type Config} from '../../../src/types.js';
import {MODEL_REGISTRY,getModelDir,downloadModel,isModelDownloaded} from '../../../src/ai/memory/model-registry.js';
import {MemorySettingsService} from '../../electron/memory-settings-service.js';
import {EmbeddingClient} from '../../../src/ai/memory/embedding.js';
import Database from 'better-sqlite3';
import {LayeredMemoryStore} from '../../../src/ai/memory/layered-store.js';
import {acquireSaveLock} from '../../../src/ai/runtime/session-store/mutation-lock.js';
vi.mock('node:fs',async importOriginal=>{const original=await importOriginal<typeof import('node:fs')>();return{...original,rmSync:vi.fn(original.rmSync),unlinkSync:vi.fn(original.unlinkSync)};});
const roots:string[]=[];const stores:LayeredMemoryStore[]=[];
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();for(const store of stores.splice(0))await store.close();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true,maxRetries:3});});
function fixture(){const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'embedding-management-')));roots.push(root);vi.stubEnv('XIAOK_CONFIG_DIR',root);
 const config:Config={...structuredClone(DEFAULT_CONFIG),memory:{embedding:{provider:'local',model:'all-MiniLM-L6-v2'}}};
 const store=new LayeredMemoryStore({dbPath:join(root,'memory.db')});stores.push(store);
 fs.writeFileSync(join(root,'config.json'),JSON.stringify(config));
 for(const m of MODEL_REGISTRY){fs.mkdirSync(getModelDir(m.id),{recursive:true});for(const file of m.requiredFiles)fs.writeFileSync(join(getModelDir(m.id),file),'synthetic weights');}
 const save=vi.fn();const service=new MemorySettingsService({load:async()=>config,save,store});return{root,config,store,save,service,target:'bge-small-zh-v1.5'};
}
describe('embedding management uses production service and real temporary files',()=>{
 it('deletes only the inactive managed files, preserves DB/config/other model, and can redownload',async()=>{const f=fixture();const beforeDB=fs.readFileSync(join(f.root,'memory.db'));const beforeConfig=fs.readFileSync(join(f.root,'config.json'));
 await f.service.deleteEmbeddingModel(f.target,{requestSource:'user'});
 expect(fs.existsSync(getModelDir(f.target))).toBe(false);expect(isModelDownloaded('all-MiniLM-L6-v2')).toBe(true);
 expect(fs.readFileSync(join(f.root,'memory.db'))).toEqual(beforeDB);expect(fs.readFileSync(join(f.root,'config.json'))).toEqual(beforeConfig);expect(f.save).not.toHaveBeenCalled();
 });
 it('rejects configured and actually running models before file mutation',async()=>{const f=fixture();await expect(f.service.deleteEmbeddingModel('all-MiniLM-L6-v2',{requestSource:'user'})).rejects.toThrow('embedding_model_active');
 f.config.memory!.embedding!.model=f.target;await expect(f.service.deleteEmbeddingModel(f.target,{requestSource:'user'})).rejects.toThrow('embedding_model_active');
 await expect(f.service.deleteEmbeddingModel('all-MiniLM-L6-v2',{requestSource:'user'})).rejects.toThrow('embedding_model_active');expect(isModelDownloaded(f.target)).toBe(true);
 });
 it.each(['agent','scheduler',undefined])('rejects unauthorized source %s',async source=>{const f=fixture();await expect(f.service.deleteEmbeddingModel(f.target,source?{requestSource:source} as never:undefined as never)).rejects.toThrow('memory_settings_user_only');expect(isModelDownloaded(f.target)).toBe(true);});
 it.each(['../memory.db','C:\\outside','\\\\server\\share','/absolute/model','unknown',''])('rejects non-registry path ID %s',async id=>{const f=fixture();await expect(f.service.deleteEmbeddingModel(id,{requestSource:'user'})).rejects.toThrow('invalid_embedding_model');expect(isModelDownloaded(f.target)).toBe(true);});
 it('removes partial downloads but refuses unknown files before deleting anything',async()=>{const f=fixture();fs.unlinkSync(join(getModelDir(f.target),'model.onnx_data'));await f.service.deleteEmbeddingModel(f.target,{requestSource:'user'});expect(fs.existsSync(getModelDir(f.target))).toBe(false);
 fs.mkdirSync(getModelDir(f.target));fs.writeFileSync(join(getModelDir(f.target),'model.onnx'),'synthetic');fs.writeFileSync(join(getModelDir(f.target),'private-note.txt'),'synthetic user note');await expect(f.service.deleteEmbeddingModel(f.target,{requestSource:'user'})).rejects.toThrow('embedding_model_unsafe_files');expect(fs.existsSync(join(getModelDir(f.target),'model.onnx'))).toBe(true);
 });
 it('rejects symlink model directory and file, retaining external files',async()=>{const f=fixture();const external=join(f.root,'outside');fs.mkdirSync(external);fs.writeFileSync(join(external,'model.onnx'),'external sentinel');
 fs.rmSync(getModelDir(f.target),{recursive:true});fs.symlinkSync(external,getModelDir(f.target),'junction');await expect(f.service.deleteEmbeddingModel(f.target,{requestSource:'user'})).rejects.toThrow('embedding_model_unsafe_path');fs.unlinkSync(getModelDir(f.target));fs.mkdirSync(getModelDir(f.target));fs.symlinkSync(join(external,'model.onnx'),join(getModelDir(f.target),'model.onnx'));
 await expect(f.service.deleteEmbeddingModel(f.target,{requestSource:'user'})).rejects.toThrow('embedding_model_unsafe_files');expect(fs.readFileSync(join(external,'model.onnx'),'utf8')).toBe('external sentinel');
 });
 it('rejects a symlink managed root and hardlinked files',async()=>{const f=fixture();fs.linkSync(join(getModelDir(f.target),'model.onnx'),join(f.root,'linked-weight'));await expect(f.service.deleteEmbeddingModel(f.target,{requestSource:'user'})).rejects.toThrow('embedding_model_unsafe_files');fs.unlinkSync(join(f.root,'linked-weight'));
 const embedding=join(f.root,'embedding');fs.renameSync(embedding,join(f.root,'outside-embedding'));fs.symlinkSync(join(f.root,'outside-embedding'),embedding,'junction');await expect(f.service.deleteEmbeddingModel(f.target,{requestSource:'user'})).rejects.toThrow('embedding_model_unsafe_path');expect(fs.existsSync(join(f.root,'outside-embedding',f.target,'model.onnx'))).toBe(true);
 });
 it('refuses deletion while another model file operation holds the production lock',async()=>{
  const f=fixture();const release=acquireSaveLock(join(f.root,'embedding',`.model-files-${f.target}.lock`));
  try {await expect(f.service.deleteEmbeddingModel(f.target,{requestSource:'user'})).rejects.toThrow('session_save_locked');expect(fs.readFileSync(join(getModelDir(f.target),'model.onnx'),'utf8')).toBe('synthetic weights');expect(isModelDownloaded(f.target)).toBe(false);}
  finally {release();}
  expect(isModelDownloaded(f.target)).toBe(true);
 });
 it('restores the original directory after filesystem removal fails, and retries successfully',async()=>{
  const f=fixture(),actual=await vi.importActual<typeof import('node:fs')>('node:fs');let injected=false;
  vi.mocked(fs.unlinkSync).mockImplementation(target=>{
    if(!injected && String(target).includes('.delete-') && String(target).endsWith('model.onnx')) {injected=true;throw Object.assign(new Error('synthetic locked model weight'),{code:'EPERM'});}
    return actual.unlinkSync(target);
  });
  await expect(f.service.deleteEmbeddingModel(f.target,{requestSource:'user'})).rejects.toThrow('synthetic locked model weight');
  expect(injected).toBe(true);expect(isModelDownloaded(f.target)).toBe(true);
  await f.service.deleteEmbeddingModel(f.target,{requestSource:'user'});expect(fs.existsSync(getModelDir(f.target))).toBe(false);
 });
 it('serializes download and deletion and releases its file lock without network for complete fixtures',async()=>{const f=fixture();await downloadModel(f.target);expect(fs.existsSync(join(f.root,'embedding',`.model-files-${f.target}.lock`))).toBe(false);
 await Promise.all([f.service.downloadEmbeddingModel(f.target,{requestSource:'user'}),f.service.deleteEmbeddingModel(f.target,{requestSource:'user'})]);expect(fs.existsSync(getModelDir(f.target))).toBe(false);
 });
});

it.each(['ALL-MINILM-L6-V2','custom-local-alias','branch/../all-MiniLM-L6-v2'])('refuses uncertain or case-aliased live local model %s',async alias=>{
 const f=fixture();f.target='all-MiniLM-L6-v2';f.config.memory!.embedding={provider:'local',model:'bge-small-zh-v1.5'};fs.writeFileSync(join(f.root,'config.json'),JSON.stringify(f.config));await f.store.configureEmbedding({provider:'api',model:'synthetic-api',dimensions:2,apiUrl:'https://synthetic.invalid'},{requestSource:'user'});const db=new Database(join(f.root,'live-alias.db'));const client=new EmbeddingClient(db,{provider:'local',model:alias,dimensions:384,apiUrl:''});
 try {await expect(f.service.deleteEmbeddingModel(f.target,{requestSource:'user'})).rejects.toThrow('embedding_model_active');expect(fs.existsSync(getModelDir(f.target))).toBe(true);}
 finally {await client.close();db.close();}
});
it('refuses an unrecognized configured local model even without a matching live client',async()=>{
 const f=fixture();f.config.memory!.embedding={provider:'local',model:'unrecognized-alias'};fs.writeFileSync(join(f.root,'config.json'),JSON.stringify(f.config));
 await expect(f.service.deleteEmbeddingModel(f.target,{requestSource:'user'})).rejects.toThrow('embedding_model_active');expect(fs.existsSync(getModelDir(f.target))).toBe(true);
});
