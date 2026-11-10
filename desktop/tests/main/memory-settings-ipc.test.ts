// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';
import {registerMemorySettingsIpc} from '../../electron/memory-settings-ipc.js';
import {MemorySettingsService} from '../../electron/memory-settings-service.js';
import {createPreloadApi} from '../../electron/preload-api.js';
import {resetIpcSchemaRegistryForTests} from '../../electron/ipc-runtime.js';
import {MEMORY_IPC_CONTRACTS} from '../../electron/memory-ipc-contract.js';
import {DEFAULT_CONFIG,type Config} from '../../../src/types.js';
afterEach(()=>resetIpcSchemaRegistryForTests());
function fixture(){
 let config:Config={...structuredClone(DEFAULT_CONFIG),defaultModelId:'text',providers:{fixture:{type:'custom',protocol:'openai_legacy'}},models:{text:{provider:'fixture',model:'text',label:'Text',capabilities:['text_generation']}}};
 const cancel=vi.fn(()=>true),save=vi.fn(async(next:Config)=>{config=next});
 const service=new MemorySettingsService({load:async()=>structuredClone(config),save,store:{save:async()=>{},listRelevant:async()=>[],cancelCompaction:cancel}});
 const handlers=new Map<string,Function>();let current=true;const event={};
 registerMemorySettingsIpc({registrar:{handle:(name,handler)=>{handlers.set(name,handler)}},service,source:received=>{
  const check=()=>{if(received!==event||!current)throw Error('memory_settings_forbidden')};check();return {requestSource:'user',assertCurrent:check};
 }});
 const invoke=vi.fn((name:string,...args:unknown[])=>Promise.resolve(handlers.get(name)!(event,...args)));
 const api=createPreloadApi({invoke,on:()=>{},removeListener:()=>{}} as never);
 return {api,service,save,cancel,event,handlers,revoke:()=>{current=false}};
}
describe('real memory settings registrar and preload',()=>{
 it('carries the actual snapshot and cancellation acknowledgement through the whitelist',async()=>{
  const f=fixture();expect(await f.api.memoryGetSettings()).toMatchObject({version:1,compactionModelId:null,resolvedCompactionModelId:'text'});
  expect(await f.api.memoryCancelCompaction()).toBe(true);expect(f.cancel).toHaveBeenCalledWith({requestSource:'user'});
  await expect(f.api.deleteEmbeddingModel('../memory.db')).rejects.toThrow('invalid_embedding_model');
 });
 it('authorizes the real host before parsing and refuses revoked callers without mutation',async()=>{
  const f=fixture();f.revoke();let reads=0;const hostile=new Proxy({}, {get(){reads++;throw Error('must not read')}});
  await expect(f.handlers.get('desktop:deleteEmbeddingModel')!({},hostile)).rejects.toThrow('memory_settings_forbidden');
  await expect(f.api.memoryCancelCompaction()).rejects.toThrow('memory_settings_forbidden');expect(reads).toBe(0);expect(f.cancel).not.toHaveBeenCalled();expect(f.save).not.toHaveBeenCalled();
 });
 it('rejects extra no-argument payloads and agent/scheduler writers at the production service',async()=>{
  const f=fixture();await expect(f.handlers.get('desktop:memoryCancelCompaction')!(f.event,'extra')).rejects.toThrow();expect(f.cancel).not.toHaveBeenCalled();
  for(const requestSource of ['agent','scheduler',undefined] as const){
   await expect(f.service.setCompactionModel('text',{requestSource} as never)).rejects.toThrow('memory_settings_user_only');
   await expect(f.service.deleteEmbeddingModel('bge-small-zh-v1.5',{requestSource} as never)).rejects.toThrow('memory_settings_user_only');
  }expect(f.save).not.toHaveBeenCalled();
 });
});

it('keeps no-argument compatibility while accepting only the closed confirmed-model request',()=>{
 const schema=MEMORY_IPC_CONTRACTS.memoryCompact.input;
 expect(schema.safeParse([]).success).toBe(true);expect(schema.safeParse([{expectedModelId:'text'}]).success).toBe(true);
 for(const args of [[{}],[{expectedModelId:'text',requestSource:'user'}],[{expectedModelId:'text'},'extra']])expect(schema.safeParse(args).success).toBe(false);
});
