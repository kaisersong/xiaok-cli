// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from 'vitest';import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {ConnectorsStore} from '../../electron/connectors-store.js';import {ConnectorsService} from '../../electron/connectors-service.js';import {ToolRegistry} from '../../../src/ai/tools/index.js';
import {captureConnectorsOutput} from '../../electron/connectors-typed-ipc.js';
let own:string,store:ConnectorsStore,service:ConnectorsService,registry:ToolRegistry;const user={requestSource:'user'};
beforeEach(()=>{own=mkdtempSync(join(tmpdir(),'connectors-owner-'));store=new ConnectorsStore({dataRoot:own});registry=new ToolRegistry({autoMode:true},[]);service=new ConnectorsService({store,toolRegistry:registry});});afterEach(()=>{try{registry.dispose();}finally{rmSync(own,{recursive:true,force:true});}});
const bytes=()=>existsSync(join(own,'connectors.json'))?readFileSync(join(own,'connectors.json'),'utf8'):null;
const call=(target:object,key:string,args:unknown[])=>Reflect.apply((target as Record<string,Function>)[key]!,target,args);
it.each([undefined,{requestSource:'invalid'}, {requestSource:'agent'},{requestSource:'scheduler'}])('rejects config writer siblings with unqualified actor %j before input/file/registry effects',async(actor)=>{for(const [target,key]of [[service,'setConfig'],[store,'save']] as const){let hits=0;const input={get search(){hits++;return {provider:'tavily',tavilyApiKey:'tvly-own-only'};}};const before=bytes();await expect(Promise.resolve().then(()=>call(target,key,[input,actor]))).rejects.toThrow(/connectors_request_source_/);expect(hits).toBe(0);expect(bytes()).toBe(before);}});
it.each([{requestSource:'agent'},{requestSource:'scheduler'},undefined])('keeps secret settings read user-only for actor %j',async(actor)=>{await call(service,'setConfig',[{search:{provider:'tavily',tavilyApiKey:'tvly-own-only'},fetch:{provider:'basic'}},user]);const before=bytes();expect(()=>call(service,'getConfig',[actor])).toThrow(/connectors_request_source_/);expect(bytes()).toBe(before);});
it('takes a snapshot before the actual write queue rather than retaining caller input',async()=>{const input={search:{provider:'tavily',tavilyApiKey:'tvly-own-only'},fetch:{provider:'basic'}};const pending=call(service,'setConfig',[input,user]);input.search.provider='brave';const saved=await pending;expect(saved.config.search.provider).toBe('tavily');expect(JSON.parse(bytes()!).search.provider).toBe('tavily');});
it('returns isolated complete secret snapshot without granting a live config mutation route',async()=>{await call(service,'setConfig',[{search:{provider:'tavily',tavilyApiKey:'tvly-own-only'},fetch:{provider:'basic'}},user]);const snapshot=await call(service,'getConfig',[user]);const before=bytes();snapshot.config.search.provider='brave';snapshot.config.search.tavilyApiKey='changed-own-key';const current=await call(service,'getConfig',[user]);expect(current.config.search.provider).toBe('tavily');expect(current.config.search.tavilyApiKey).toBe('tvly-own-only');expect(bytes()).toBe(before);});
it('refuses a valid user input getter before normalizing or writing it',async()=>{let hits=0;const input={get search(){hits++;return {provider:'tavily'};}};await expect(Promise.resolve().then(()=>call(service,'setConfig',[input,user]))).rejects.toThrow('connectors_input_invalid');expect(hits).toBe(0);expect(bytes()).toBe(null);});
it('keeps legacy normalizer fallback and full known string keys for a qualified user',async()=>{const saved=await call(service,'setConfig',[{search:{provider:'unknown',tavilyApiKey:'  tavily: tvly-own-only ',drop:true},fetch:null,extra:true},user]);expect(saved.config.search.provider).toBe('duckduckgo');expect(saved.config.search.tavilyApiKey).toBe('tvly-own-only');expect(saved.config.fetch.provider).toBe('basic');});

it.each([undefined,{requestSource:'invalid'},{requestSource:'agent'},{requestSource:'scheduler'}])('refuses settings diagnostics with actor %j before network',async(actor)=>{const fetcher=vi.fn(async()=>new Response('own fixture',{status:503}));vi.stubGlobal('fetch',fetcher);const localRegistry=new ToolRegistry({autoMode:true},[]);try{const local=new ConnectorsService({store,toolRegistry:localRegistry});await expect(Promise.resolve().then(()=>call(local,'testProvider',['fetch',actor]))).rejects.toThrow(/connectors_request_source_/);expect(fetcher).not.toHaveBeenCalled();}finally{localRegistry.dispose();vi.unstubAllGlobals();}});
it('rejects invalid diagnostic kind before a qualified user can send HTTP',async()=>{const fetcher=vi.fn(async()=>new Response('own fixture',{status:503}));vi.stubGlobal('fetch',fetcher);const localRegistry=new ToolRegistry({autoMode:true},[]);try{const local=new ConnectorsService({store,toolRegistry:localRegistry});await expect(Promise.resolve().then(()=>call(local,'testProvider',['invalid-kind',user]))).rejects.toThrow('connectors_input_invalid');expect(fetcher).not.toHaveBeenCalled();}finally{localRegistry.dispose();vi.unstubAllGlobals();}});

it.each([undefined,{requestSource:'invalid'},{requestSource:'agent'},{requestSource:'scheduler'}])('rejects actor %j before resolving the model-config DeepSeek secret',actor=>{
 const resolver=vi.fn(async()=> 'sk-owned-deepseek-model');
 const guarded=new ConnectorsService({store,toolRegistry:registry,resolveDeepseekApiKey:resolver}),before=bytes();
 expect(()=>call(guarded,'getConfig',[actor])).toThrow(/connectors_request_source_/);
 expect(resolver).not.toHaveBeenCalled();expect(bytes()).toBe(before);
});

it('passes actual DeepSeek service snapshots through strict IPC while keeping model and caller keys out of snapshots and storage',async()=>{
 const modelKey='sk-owned-deepseek-model',inputKey='sk-owned-deepseek-input';
 const local=new ConnectorsService({store,toolRegistry:registry,resolveDeepseekApiKey:async()=>modelKey});
 const saved=await local.setConfig({search:{provider:'deepseek',deepseekApiKey:inputKey},fetch:{provider:'deepseek',deepseekApiKey:inputKey}},{requestSource:'user'});
 const snapshot=await local.getConfig({requestSource:'user'});
 expect(captureConnectorsOutput('saveConnectorsConfig',saved)).toEqual(saved);
 expect(captureConnectorsOutput('getConnectorsConfig',snapshot)).toEqual(snapshot);
 for(const value of [saved,snapshot]){
  expect(value.config.search.provider).toBe('deepseek');expect(value.config.fetch.provider).toBe('deepseek');
  expect(Object.hasOwn(value.config.search,'deepseekApiKey')).toBe(false);expect(Object.hasOwn(value.config.fetch,'deepseekApiKey')).toBe(false);
  expect(JSON.stringify(value)).not.toContain(modelKey);expect(JSON.stringify(value)).not.toContain(inputKey);
 }
 const runtimes=await local.listProviders();
 expect(runtimes.find(value=>value.provider_name==='web_search.deepseek')?.runtime_state).toBe('ready');
 expect(runtimes.find(value=>value.provider_name==='web_fetch.deepseek')?.runtime_state).toBe('ready');
 expect(bytes()).not.toContain('deepseekApiKey');expect(bytes()).not.toContain(modelKey);expect(bytes()).not.toContain(inputKey);
});
