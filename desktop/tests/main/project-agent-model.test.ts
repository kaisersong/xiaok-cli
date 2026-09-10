import { describe, it, expect } from 'vitest';
import { createProjectAgentModel, validateProjectAgentModelSelection } from '../../electron/project-agent-model.js';
import type { Config, ModelAdapter, StreamChunk } from '../../../src/types.js';
const config = (): Config => ({schemaVersion:2, defaultProvider:'local',defaultModelId:'current',providers:{local:{type:'custom',protocol:'openai_legacy',baseUrl:'http://localhost:1234/v1'}},models:{current:{provider:'local',model:'current',label:'Current',capabilities:['tools']},vision:{provider:'local',model:'vision',label:'Vision',capabilities:['tools','image_in']}}} as Config);
const input=()=>({messages:[{role:'user' as const,content:[{type:'text' as const,text:'work'}]}],tools:[],systemPrompt:'test',invocationId:'test',deadline:Date.now()+10000,options:{signal:new AbortController().signal}});
const collect=async(stream:AsyncIterable<StreamChunk>)=>{const out=[];for await(const c of stream)out.push(c);return out};
function setup(selected:string|null='vision', fail?: (model:string)=>AsyncIterable<StreamChunk>){let cfg=config();const calls:string[]=[]; const factory=(binding:any):ModelAdapter=>({getModelName:()=>binding.wireModel,stream:()=>{calls.push(binding.modelId);return fail?fail(binding.modelId):(async function*(){yield {type:'text',delta:binding.modelId} as const;yield {type:'done'} as const;})()}});return {calls,setConfig:(v:Config)=>{cfg=v},getConfig:()=>cfg,create:()=>createProjectAgentModel({modelId:selected,loadConfig:async()=>cfg,createAdapter:factory})};}
describe('project agent model selection and request fallback',()=>{
 it('uses explicit selection and declared vision capability',async()=>{const s=setup();const model=await s.create();expect(model.binding.modelId).toBe('vision');expect(model.binding.capabilities).toContain('image_in');await collect(model.stream(input()));expect(s.calls).toEqual(['vision']);});
 it('follows current model and resolves deleted selections to current',async()=>{for(const id of [null,'deleted'])expect((await setup(id).create()).binding.modelId).toBe('current')});
 it('reloads default after failure and drops incomplete tool calls',async()=>{const s=setup('vision',async function*(name){if(name==='vision'){yield {type:'tool_use',id:'discard',name:'write',input:{}};s.setConfig({...s.getConfig(),defaultModelId:'new',models:{...s.getConfig().models,new:{provider:'local',model:'new',label:'New'}}});throw new Error('HTTP 503')}yield {type:'text',delta:'ok'};yield {type:'done'}});const model=await s.create();expect(await collect(model.stream(input()))).toEqual([{type:'text',delta:'ok'},{type:'done'}]);expect(s.calls).toEqual(['vision','new']);await collect(model.stream(input()));expect(s.calls).toEqual(['vision','new','new']);});
 it.each(['AbortError','KIMI_K3_HISTORY_INVALID','provider_conversation_authorization_invalid'])('does not fallback on cancellation or authorization: %s',async(kind)=>{const s=setup('vision',async function*(){const err=new Error(kind);if(kind==='AbortError')err.name=kind;throw err;});await expect(collect((await s.create()).stream(input()))).rejects.toThrow(kind);expect(s.calls).toEqual(['vision']);});
 it('does not loop when fallback fails or selection equals current',async()=>{for(const id of ['vision','current']){const s=setup(id,async function*(){throw new Error('HTTP 503')});await expect(collect((await s.create()).stream(input()))).rejects.toThrow('503');expect(s.calls).toEqual(id==='vision'?['vision','current']:['current'])}});
 it('requires user source, existing model, and xiaok runtime for mutation',()=>{const cfg=config();expect(()=>validateProjectAgentModelSelection('vision','xiaok',cfg,'user')).not.toThrow();expect(()=>validateProjectAgentModelSelection('vision','xiaok',cfg,'agent')).toThrow();expect(()=>validateProjectAgentModelSelection('missing','xiaok',cfg,'user')).toThrow();expect(()=>validateProjectAgentModelSelection('vision','kimi',cfg,'user')).toThrow();});
 it('does not leak private reasoning across fallback and keeps completed tool results', async () => {
  const cfg = config(); let received: unknown;
  const model = await createProjectAgentModel({modelId:'vision',loadConfig:async()=>cfg,createAdapter:binding=>({getModelName:()=>binding.wireModel,async *stream(messages){if(binding.modelId==='vision')throw new Error('404');received=messages;yield {type:'text',delta:'done'};yield {type:'done'};}})});
  const req=input();req.messages.push({role:'assistant',content:[{type:'thinking',thinking:'private'},{type:'tool_use',id:'once',name:'write',input:{}}]} as any,{role:'user',content:[{type:'tool_result',tool_use_id:'once',content:'file created'}]} as any);
  await collect(model.stream(req));expect(JSON.stringify(received)).not.toContain('private');expect(JSON.stringify(received)).toContain('file created');
 });
 it('rejects unsupported image input instead of silently pretending to see it',async()=>{
  const s=setup('current');const req=input();req.messages[0].content.push({type:'image',source:{type:'base64',media_type:'image/png',data:'AA=='}} as any);
  await expect(collect((await s.create()).stream(req))).rejects.toThrow('image_not_supported');expect(s.calls).toEqual([]);
 });
 it('rechecks workspace authority before fallback and does not send after revocation',async()=>{
  const s=setup('vision',async function*(){throw new Error('404')});let checks=0;
  await expect(collect((await s.create()).stream({...input(),beforeRequest:async()=>{if(++checks>1)throw new Error('workspace_revoked')}}))).rejects.toThrow('workspace_revoked');expect(s.calls).toEqual(['vision']);
 });
 it('falls back when adapter construction fails',async()=>{
  const model=await createProjectAgentModel({modelId:'vision',loadConfig:async()=>config(),createAdapter:binding=>{if(binding.modelId==='vision')throw new Error('unsupported model');return {getModelName:()=>binding.wireModel,async *stream(){yield {type:'text',delta:'current'};yield {type:'done'}}}}});expect(model.binding.modelId).toBe('current');
 });

});
