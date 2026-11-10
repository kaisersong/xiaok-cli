import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import * as fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
const f=vi.hoisted(()=>({root:'',roots:[] as string[],hold:false,release:null as null|(()=>void),urls:[] as string[],payload:false,unlock:false,first:null as Error|null,keep:false,configured:'bge-small-zh-v1.5'}));
vi.mock('../../../src/utils/config.js',()=>({getConfigDir:()=>f.root,loadConfig:async()=>({memory:{embedding:{model:f.configured}}})}));
vi.mock('node:fs',async original=>{
 const originalFs=await original<typeof import('node:fs')>();
 return {...originalFs,createWriteStream:(...args:Parameters<typeof originalFs.createWriteStream>)=>{
  const stream=originalFs.createWriteStream(...args),close=stream.close;
  if(f.hold)stream.close=function(callback?:Parameters<typeof close>[0]){return close.call(this,error=>{f.release=()=>callback?.(error);});};
  return stream;
 },unlinkSync:(path:fs.PathLike)=>{
  if(f.unlock&&String(path).endsWith('.lock'))throw undefined;
  if(f.payload&&String(path).endsWith('model.onnx'))throw f.first;
  return originalFs.unlinkSync(path);
 }};
});
vi.mock('node:https',()=>({get:(url:string,optionsOrCallback:unknown,callback?:Function)=>{
 f.urls.push(url);const cb=callback??optionsOrCallback as Function;
 const request=new EventEmitter() as EventEmitter&{destroy():unknown};
 request.destroy=()=>{queueMicrotask(()=>request.emit('close'));return request;};
 queueMicrotask(()=>{const response=new PassThrough() as PassThrough&{statusCode:number;headers:object};response.statusCode=200;response.headers={};cb(response);response.end('synthetic payload');response.once('close',()=>request.emit('close'));});
 return request;
}}));
import * as api from '../../../src/ai/memory/model-registry.js';
import {acquireSaveLock} from '../../../src/ai/runtime/session-store/mutation-lock.js';
const id='all-MiniLM-L6-v2';
function release(){const callback=f.release;f.release=null;callback?.();}
function root(){const p=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'model-files-')));fs.chmodSync(p,0o700);f.roots.push(p);f.root=p;return p;}
function model(){const dir=join(f.root,'embedding',id);fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(join(dir,'model.onnx'),'fixed model');fs.writeFileSync(join(dir,'tokenizer.json'),'{}');return dir;}
function remove(){expect(typeof api.deleteEmbeddingModelFiles).toBe('function');return api.deleteEmbeddingModelFiles;}
beforeEach(()=>{f.hold=false;f.release=null;f.urls=[];f.payload=false;f.unlock=false;f.first=null;f.keep=false;f.configured='bge-small-zh-v1.5';root();});
afterEach(()=>{release();if(f.keep)f.roots.pop();for(const p of f.roots.splice(0))fs.rmSync(p,{recursive:true,force:true});});
describe('fixed ordinary model file owner; no Native or network inference claim',()=>{
 it('removes only the real registry flat directory',async()=>{const dir=model();expect(api.isModelDownloaded(id)).toBe(true);await remove()(id,{requestSource:'user'});expect(fs.existsSync(dir)).toBe(false);});
 it.each(['agent','scheduler'] as const)('rejects %s before user file mutation',async requestSource=>{const dir=model();await expect(remove()(id,{requestSource})).rejects.toThrow('memory_settings_user_only');expect(fs.readFileSync(join(dir,'model.onnx'),'utf8')).toBe('fixed model');});
 it('rejects an unknown ID rather than taking a caller path',async()=>{await expect(remove()('../outside',{requestSource:'user'})).rejects.toThrow('invalid_embedding_model');});
 it('rejects configured active weights even when there is no born client',async()=>{const dir=model(),fn=remove();f.configured=id;await expect(fn(id,{requestSource:'user'})).rejects.toThrow('embedding_model_active');expect(fs.readFileSync(join(dir,'model.onnx'),'utf8')).toBe('fixed model');});
 it('does not expose complete files as usable after an unknown model-lock release',async()=>{
  const dir=model();fs.unlinkSync(join(dir,'model.onnx'));f.unlock=true;f.keep=true;
  await expect(api.downloadModel(id)).rejects.toBeUndefined();expect(fs.existsSync(join(dir,'model.onnx'))).toBe(true);expect(api.isModelDownloaded(id)).toBe(false);
 });
 it('refuses a symlink directory and preserves outside bytes',async()=>{const fn=remove(),outside=join(f.root,'outside');fs.mkdirSync(outside);fs.writeFileSync(join(outside,'model.onnx'),'outside');fs.mkdirSync(join(f.root,'embedding'));fs.symlinkSync(outside,join(f.root,'embedding',id),'dir');await expect(fn(id,{requestSource:'user'})).rejects.toThrow('embedding_model_unsafe_path');expect(fs.readFileSync(join(outside,'model.onnx'),'utf8')).toBe('outside');});
 it('refuses hardlinked files and unexpected descendants before staging',async()=>{const dir=model(),fn=remove();fs.linkSync(join(dir,'model.onnx'),join(f.root,'alias'));expect(api.isModelDownloaded(id)).toBe(false);await expect(fn(id,{requestSource:'user'})).rejects.toThrow('embedding_model_unsafe_files');fs.unlinkSync(join(f.root,'alias'));fs.mkdirSync(join(dir,'unexpected'));await expect(fn(id,{requestSource:'user'})).rejects.toThrow('embedding_model_unsafe_files');expect(fs.existsSync(dir)).toBe(true);});
 it('refuses an embedding root alias',async()=>{const fn=remove(),outside=join(f.root,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,join(f.root,'embedding'),'dir');expect(api.isModelDownloaded(id)).toBe(false);await expect(fn(id,{requestSource:'user'})).rejects.toThrow('embedding_model_unsafe_path');});
 it('shares the original per-model lock with another writer',async()=>{model();const fn=remove(),unlock=acquireSaveLock(join(f.root,'embedding',`.model-files-${id}.lock`));try{await expect(fn(id,{requestSource:'user'})).rejects.toThrow('session_save_locked');}finally{unlock();}});
 it('denies an actual local client via the fixed original private reader',async()=>{
  model();const fn=remove();const {EmbeddingClient,getLiveEmbeddingModelIds}=await import('../../../src/ai/memory/embedding.js');
  // No SQLite/Native qualification: this exact real client guard needs no DB methods.
  const client=new EmbeddingClient({} as never,{provider:'local',model:id,dimensions:384,apiUrl:''});
  try{expect(getLiveEmbeddingModelIds()).toContain(id);await expect(fn(id,{requestSource:'user'})).rejects.toThrow('embedding_model_active');}finally{await client.close();}
  expect(getLiveEmbeddingModelIds()).not.toContain(id);await fn(id,{requestSource:'user'});
 });
 it('does not trust later public registry filename mutation',async()=>{
  const dir=model(),fn=remove(),entry=api.MODEL_REGISTRY[0]!,before=entry.downloadFiles[0]!.filename;entry.downloadFiles[0]!.filename='../../outside';
  try{await fn(id,{requestSource:'user'});expect(fs.existsSync(dir)).toBe(false);}finally{entry.downloadFiles[0]!.filename=before;}
 });
 it('keeps the original lock until the actual WriteStream close callback settles',async()=>{
  const dir=model();fs.unlinkSync(join(dir,'model.onnx'));f.hold=true;f.keep=true;let done=false;const work=api.downloadModel(id).then(()=>{done=true;});const observed=work.then(()=>null,raw=>raw);
  try{for(let n=0;n<50&&!f.release;n++)await new Promise<void>(yes=>setImmediate(yes));expect(f.release).not.toBeNull();expect(done).toBe(false);expect(fs.existsSync(join(f.root,'embedding',`.model-files-${id}.lock`))).toBe(true);release();await work;f.keep=false;expect(done).toBe(true);}finally{release();await observed;}
 });
 it('joins an original known Promise even alongside an unknown accessor, without reading it',async()=>{
  model();const fn=remove();f.payload=true;f.keep=true;f.first=new Error('original_with_tails');
  let finish!:()=>void,reads=0,settled=false;const held=new Promise<void>(yes=>{finish=yes;});
  Object.defineProperty(f.first,Symbol('known-held'),{value:held});Object.defineProperty(f.first,'unknown',{get(){reads++;return null;}});
  const work=fn(id,{requestSource:'user'}),outcome=work.then(()=>({fulfilled:true}),raw=>({fulfilled:false,raw}));
  void outcome.then(()=>{settled=true;});
  try{await new Promise<void>(yes=>setImmediate(yes));expect(settled).toBe(false);expect(reads).toBe(0);finish();expect(await outcome).toEqual({fulfilled:false,raw:f.first});expect(reads).toBe(0);expect(fs.existsSync(join(f.root,'embedding',`.model-files-${id}.lock`))).toBe(true);}finally{finish();await outcome;}
 });
 it('keeps primary delete and bare undefined unlock failures in order',async()=>{
  model();const fn=remove();f.payload=true;f.unlock=true;f.first=new Error('first_delete');f.keep=true;
  const raw=await fn(id,{requestSource:'user'}).then(()=>null,raw=>raw);expect(raw).toBeInstanceOf(AggregateError);expect(raw.cause).toBe(f.first);expect(raw.errors).toContain(f.first);expect(raw.errors).toContain(undefined);
 });
});
