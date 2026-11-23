import {afterEach,expect,it} from 'vitest';
import {Agent} from '../../../src/ai/agent.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';
import {ToolRegistry} from '../../../src/ai/tools/index.js';
import {createAdapterFromBinding} from '../../../src/ai/models.js';
import {OpenAIAdapter} from '../../../src/ai/adapters/openai.js';
import type {Message,StreamChunk} from '../../../src/types.js';
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
const old:Message[]=[
 {role:'user',content:[{type:'text',text:'Remember the corrected value is 47.'}]},
 {role:'assistant',content:[{type:'text',text:'The corrected value is 47.'},{type:'tool_use',id:'old-tool',name:'resume_probe',input:{}}]},
 {role:'user',content:[{type:'tool_result',tool_use_id:'old-tool',content:'OLD_TOOL_PRIVATE_CANARY'}]},
 {role:'assistant',content:[{type:'text',text:'Saved the public correction.'}]},
];
function fixture(withReasoning=true){
 const registry=new ToolRegistry({autoMode:true}),seen:Message[][]=[],toolContexts:string[]=[],events:string[]=[];
 registry.registerTool({permission:'safe',definition:{name:'resume_probe',description:'Fixture only',inputSchema:{type:'object',properties:{}}},execute:async(_input,context)=>{toolContexts.push(JSON.stringify(context));return 'new tool result';}});
 const adapter=createAdapterFromBinding({providerId:'kimi',providerType:'first_party',modelId:'k3',wireModel:'k3',protocol:'openai_legacy',apiKey:'fixture-only',baseUrl:'https://api.kimi.com/coding/v1',headers:{},capabilities:['tools','thinking']}) as OpenAIAdapter;
 adapter.stream=async function*(messages):AsyncIterable<StreamChunk>{
  seen.push(structuredClone(messages));
  if(withReasoning)yield {type:'thinking',delta:'LIVE_REASONING_CANARY',signature:'reasoning_content',reasoningProvenance:{captureVersion:1,source:'reasoning_content',fieldPresence:'present'}};
  if(seen.length===1)yield {type:'tool_use',id:'new-tool',name:'resume_probe',input:{}};
  else yield {type:'text',delta:'47'};
  yield {type:'done'};
 };
 const agent=new Agent(adapter,registry,'System');
 cleanups.push(async()=>{agent.dispose();await agent.waitForStoppedResources();registry.dispose();adapter.dispose();});
 const state=new AgentSessionState();state.replaceMessages(structuredClone(old));const snapshot=state.exportSnapshot();
 return {agent,snapshot,seen,toolContexts,events,run:async(input='What is the corrected value?')=>{try{await agent.runTurn(input,()=>{},undefined,undefined,event=>events.push(event.type));}catch(raw){events.push('run_rejected');}}};
}
it('resumes through public provider context while canonical history and live tool reasoning stay intact',async()=>{
 const f=fixture();f.agent.restoreSession(f.snapshot);await f.run();
 expect(f.events).toContain('run_completed');expect(f.events).not.toContain('run_failed');expect(f.seen).toHaveLength(2);
 expect(f.seen[0]![0]!.role).toBe('user');const prefix=JSON.stringify(f.seen[0]![0]);
 expect(prefix).toContain('47');expect(prefix).toContain('synthesized');expect(prefix).not.toContain('OLD_TOOL_PRIVATE_CANARY');expect(prefix).not.toContain('old-tool');
 expect(f.seen[0]!.some(message=>message.role==='assistant')).toBe(false);
 expect(JSON.stringify(f.seen[1])).toContain('LIVE_REASONING_CANARY');expect(JSON.stringify(f.seen[1])).toContain('new-tool');
 expect(f.agent.getSessionState().getMessages().slice(0,old.length)).toEqual(old);expect(f.snapshot.messages).toEqual(old);
 expect(f.toolContexts).toHaveLength(1);expect(f.toolContexts[0]).not.toContain('LIVE_REASONING_CANARY');
});
it('does not turn missing reasoning in the new live tool round into a synthetic old transcript',async()=>{
 const f=fixture(false);f.agent.restoreSession(f.snapshot);await f.run();
 expect(f.seen).toHaveLength(1);expect(f.events).toContain('run_rejected');
});
it('rejects a changed restored prefix instead of rebinding it to public recovery',async()=>{
 const f=fixture();f.agent.restoreSession(f.snapshot);f.agent.getSessionState().replaceMessages([{role:'user',content:[{type:'text',text:'changed'}]},...old.slice(1)]);await f.run();
 expect(f.seen).toHaveLength(0);expect(f.events).toContain('run_rejected');
});
it('does not synthesize a restored protected observation closure',async()=>{
 const f=fixture();f.agent.restoreSession({...f.snapshot,protectedObservationClosure:{version:1,requiresReauthorization:true,observations:[]}});await f.run();
 expect(f.seen).toHaveLength(0);expect(f.events).toContain('run_rejected');
});
it('does not grant recovery to an initial live session without a host restore',async()=>{
 const f=fixture();f.agent.getSessionState().replaceMessages(structuredClone(old));await f.run();
 expect(f.seen).toHaveLength(0);expect(f.events).toContain('run_rejected');
});

it('keeps a large canonical history and stale usage intact instead of auto-compacting it',async()=>{
 const f=fixture(),messages=[{role:'user' as const,content:[{type:'text' as const,text:'large old context '.repeat(100000)}]},...old];
 const snapshot={...f.snapshot,messages,usage:{inputTokens:1000000,outputTokens:10}};f.agent.restoreSession(snapshot);await f.run();
 expect(f.events).toContain('run_completed');expect(f.seen).toHaveLength(2);expect(JSON.stringify(f.seen[0]).length).toBeLessThan(50000);
 expect(f.agent.getSessionState().getMessages().slice(0,messages.length)).toEqual(messages);expect(f.events).not.toContain('compact_triggered');
});
it('refuses profile switching and manual compaction before changing recovered canonical history',()=>{
 const f=fixture();f.agent.restoreSession(f.snapshot);
 expect(()=>f.agent.setAdapter({getModelName:()=> 'generic',stream:async function*(){}})).toThrow('KIMI_K3_PUBLIC_RESUME_MODEL_SWITCH_UNSUPPORTED');
 expect(()=>f.agent.forceCompact()).toThrow('KIMI_K3_PUBLIC_RESUME_COMPACTION_UNSUPPORTED');
 expect(f.agent.getSessionState().getMessages()).toEqual(old);
});

it('a direct graph restore invalidates rather than recaptures provider recovery',async()=>{
 const f=fixture();f.agent.restoreSession(f.snapshot);f.agent.getSessionState().restoreSnapshot(f.snapshot);await f.run();
 expect(f.seen).toHaveLength(0);expect(f.events).toContain('run_rejected');
});
it('refuses an oversized live tail without compacting the recovered canonical prefix',async()=>{
 const f=fixture();f.agent.restoreSession(f.snapshot);await f.run('new text '.repeat(300000));
 expect(f.seen).toHaveLength(0);expect(f.events).toContain('run_rejected');expect(f.events).not.toContain('compact_triggered');
 expect(f.agent.getSessionState().getMessages().slice(0,old.length)).toEqual(old);
});
