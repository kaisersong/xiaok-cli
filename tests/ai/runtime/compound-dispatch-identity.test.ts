import { expect, it } from 'vitest';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { AgentRuntime } from '../../../src/ai/runtime/agent-runtime.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { AgentRunController } from '../../../src/ai/runtime/controller.js';
import type { ModelAdapter, StreamChunk, ToolExecutionContext } from '../../../src/types.js';
it('binds native invocations to the host provider request rather than model supplied IDs',async()=>{
 const identities:Array<{provider?:string;tool?:string}>=[];let requests=0;
 const registry=new ToolRegistry({autoMode:true},[{definition:{name:'record',description:'record host dispatch facts',inputSchema:{type:'object',properties:{hostProviderInvocationId:{type:'string'}}}},permission:'safe',execute:async(_input,context?:ToolExecutionContext)=>{identities.push({provider:context?.hostProviderInvocationId,tool:context?.toolInvocationId});return 'ok';}}]);
 const adapter:ModelAdapter={getModelName:()=> 'fixture',async *stream(){requests++;const chunks:StreamChunk[]=requests===1?[{type:'tool_use',id:'repeat',name:'record',input:{hostProviderInvocationId:'model-forged'}},{type:'tool_use',id:'second',name:'record',input:{}}]:requests===2?[{type:'tool_use',id:'repeat',name:'record',input:{}}]:[{type:'text',delta:'done'}];for(const c of chunks)yield c;yield {type:'done'};}};
 try{await new AgentRuntime({adapter,registry,session:new AgentSessionState(),controller:new AgentRunController(),maxIterations:4,systemPrompt:'fixture'}).run('test',()=>{});
 expect(identities).toHaveLength(3);expect(identities[0].provider).toEqual(expect.any(String));expect(identities[0].provider).not.toBe('model-forged');expect(identities[1].provider).toBe(identities[0].provider);expect(identities[2].provider).not.toBe(identities[0].provider);expect(identities.map(i=>i.tool)).toEqual(['repeat','second','repeat']);
 }finally{registry.dispose();}
});
