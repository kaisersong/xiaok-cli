// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDesktopToolLoop } from '../../electron/desktop-services.js';
import { DesktopManagedAgentSession } from '../../electron/desktop-managed-agent-session.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import type { Message, ModelAdapter } from '../../../src/types.js';
const roots:string[]=[];
afterEach(async()=>{vi.unstubAllEnvs();await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true,maxRetries:3})));});
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'desktop-metrics-'));roots.push(root);vi.stubEnv('XIAOK_METRICS_DIR',root);
 const registry=new ToolRegistry({autoMode:true},[{permission:'safe',definition:{name:'read',description:'fixture',inputSchema:{type:'object',properties:{}}},execute:async()=>'你😀'}]);
 let calls=0;
 const adapter:Pick<ModelAdapter,'stream'>={async *stream(){
  if(++calls===1)yield {type:'tool_use',id:'PRIVATE-ID',name:'read',input:{}};else yield {type:'text',delta:'done'};
  yield {type:'usage',usage:{inputTokens:10,outputTokens:2,cacheReadInputTokens:5}};
 }};
 const context={adapter,registry,allToolDefs:registry.getToolDefinitions(),systemPrompt:'PRIVATE SYSTEM',messages:[{role:'user',content:[{type:'text',text:'PRIVATE USER'}]}] as Message[],
 signal:new AbortController().signal,taskDeadline:Date.now()+30000,sessionId:'PRIVATE-SESSION',turnId:'turn',intentId:'intent',stepId:'step',taskId:'task',materials:[],emitRuntimeEvent:vi.fn(async()=>{}),skillInvocation:null,skillCatalog:{} as never,dataRoot:root,taskStartTime:Date.now(),
 strategies:{compact:{enabled:false,shouldCompact:()=>false,doCompact:async()=>{}},buildApiView:(m:Message[])=>m,processToolResult:(s:string)=>s,trackAutoProgress:false,trackReferenceReads:false,emitSkillArtifactTrace:false}};
 return {root,registry,adapter,context};
}
async function report(root:string){const file=(await readdir(root)).find(n=>n.startsWith('metrics-')&&n.endsWith('.json'))!;return JSON.parse(await readFile(join(root,file),'utf8'));}
describe('actual Desktop main and managed child metric boundaries',()=>{
 it('records main loop history and per-invocation usage without changing result',async()=>{
  const {root,context}=await setup();expect((await runDesktopToolLoop(context)).reply).toBe('done');
  const r=await report(root);expect(r.surface).toBe('desktop');expect(r.events.find((e:any)=>e.kind==='history_result').bytes).toBe(7);
  expect(r.events.filter((e:any)=>e.kind==='provider_usage')).toHaveLength(2);expect(JSON.stringify(r)).not.toContain('PRIVATE');
 });
 it('records actual managed session as child, not main',async()=>{
  const {root,registry,adapter,context}=await setup();
  const session=new DesktopManagedAgentSession({adapter,systemPrompt:'PRIVATE',forkContext:false,
   getTurnContext:()=>({groupId:'g',agentId:'a',turn:1,turnId:'child-turn',cwd:root,signal:context.signal,effectiveDeadline:Date.now()+30000}) as never,
   createRegistry:()=>({registry,dispose:()=>{}}),dataRoot:root,materials:[],skillCatalog:{} as never,emitRuntimeEvent:async()=>{}});
  expect(await session.run('PRIVATE')).toBe('done');
  const r=await report(root);expect(r.surface).toBe('desktop-child');expect(r.events.filter((e:any)=>e.kind==='adapter_request')).toHaveLength(2);
  expect(r.events.find((e:any)=>e.kind==='history_result').bytes).toBe(7);
 });
});
