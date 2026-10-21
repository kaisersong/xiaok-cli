import { expect, it } from 'vitest';
import { createSemanticCompactionOwner, assertSemanticCompactionOwner } from '../../../src/runtime/sol-pi/semantic-compaction-owner.js';
import { AgentRuntime } from '../../../src/ai/runtime/agent-runtime.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { AgentRunController } from '../../../src/ai/runtime/controller.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
it('does not accept restored JSON or a caller-shaped semantic owner',()=>{
 expect(()=>createSemanticCompactionOwner({policy:{semanticCompaction:{mode:'mechanism-experiment'}}} as never)).toThrow();
 expect(()=>assertSemanticCompactionOwner({} as never,{} as never)).toThrow();
});
it('the actual Runtime rejects forged semantic owners before a model invocation',()=>{
 const registry=new ToolRegistry({autoMode:true},[]);
 try{
  expect(()=>new AgentRuntime({adapter:{getModelName:()=> 'fixture',async *stream(){yield {type:'done' as const};}},registry,session:new AgentSessionState(),controller:new AgentRunController(),systemPrompt:'test',semanticCompactionOwner:{} as never})).toThrow(/SEMANTIC_OWNER/);
 }finally{registry.dispose();}
});
