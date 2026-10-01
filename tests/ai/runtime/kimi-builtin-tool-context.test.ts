import {describe, expect, it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {ToolRegistry} from '../../../src/ai/tools/index.js';
import {AgentRuntime} from '../../../src/ai/runtime/agent-runtime.js';
import {AgentRunController} from '../../../src/ai/runtime/controller.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';
import {createAdapterFromBinding} from '../../../src/ai/models.js';
import {PromptBuilder} from '../../../src/ai/prompts/builder.js';
import type {StreamChunk, ToolExecutionContext} from '../../../src/types.js';
import {OpenAIAdapter} from '../../../src/ai/adapters/openai.js';

describe('K3 with the full builtin registry',()=>{
  it.each(['image_generate','read','ask_user'])('executes %s and continues without leaking reasoning',async name=>{
    const registry=new ToolRegistry({autoMode:true});
    let captured:ToolExecutionContext|undefined;
    registry.registerTool({permission:'safe',definition:{name,description:'Test only, no side effects',inputSchema:{type:'object',properties:{}}},execute:async(_input,context)=>{captured=context;return 'visible result';}});
    const adapter=createAdapterFromBinding({providerId:'kimi',providerType:'first_party',modelId:'k3',wireModel:'k3',protocol:'openai_legacy',apiKey:'test-only',baseUrl:'https://api.kimi.com/coding/v1',headers:{},capabilities:['tools','thinking']}) as OpenAIAdapter;
    let calls=0;
    adapter.stream=async function*():AsyncIterable<StreamChunk>{
      calls++;
      yield {type:'thinking',delta:'PRIVATE_K3_REASONING_CANARY',signature:'reasoning_content',reasoningProvenance:{captureVersion:1,source:'reasoning_content',fieldPresence:'present'}};
      if(calls===1)yield {type:'tool_use',id:'test-1',name,input:{}};
      else yield {type:'text',delta:'completed after tool'};
      yield {type:'done'};
    };
    try{
      const prompt=await new PromptBuilder({memoryStore:{listRelevant:async()=>[]} as never,harnessMemoryStore:{listActive:()=>[]}}).build({cwd:process.cwd(),channel:'chat'});
      const runtime=new AgentRuntime({adapter,registry,session:new AgentSessionState(),controller:new AgentRunController(),systemPrompt:prompt.rendered,promptSnapshot:prompt});
      const events:string[]=[];
      await runtime.run('生成一张xiaok的图片',event=>events.push(event.type));
      expect(events).toContain('run_completed');expect(events).not.toContain('run_failed');
      expect(calls).toBe(2);expect(captured).toBeDefined();
      expect(captured!.toolDefinitions.some(def=>def.name==='bash')).toBe(true);
      expect(JSON.stringify(captured)).not.toContain('PRIVATE_K3_REASONING_CANARY');
      expect(captured).not.toHaveProperty('promptCache');
    }finally{registry.dispose();adapter.dispose();}
  });
});

describe('builtin bash definition is plain platform-specific data',()=>{
  it.each(['win32','darwin'] as const)('exports a data description for %s',async value=>{
    const moduleUrl=new URL('../../../src/ai/tools/bash.js',import.meta.url).href;
    const script=`Object.defineProperty(process,'platform',{value:${JSON.stringify(value)}});const {bashTool}=await import(${JSON.stringify(moduleUrl)});const d=Object.getOwnPropertyDescriptor(bashTool.definition,'description');console.log(JSON.stringify({hasValue:Object.hasOwn(d,'value'),hasGetter:typeof d.get==='function',description:bashTool.definition.description}));`;
    const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'});
    expect(child.status,child.stderr).toBe(0);
    const definition=JSON.parse(child.stdout);
    expect(definition.hasValue).toBe(true);expect(definition.hasGetter).toBe(false);
    expect(definition.description).toContain(value==='win32'?'Windows cmd /c':'POSIX sh');
  });
});
