import {createServer} from 'node:http';
import {describe,it,expect} from 'vitest';
import {OpenAIAdapter} from '../../../src/ai/adapters/openai.js';
import {buildOpenAIHarnessContext,resolveKimiHarnessFeatureFlags} from '../../../src/ai/providers/model-harness-profile.js';
import {AgentRuntime} from '../../../src/ai/runtime/agent-runtime.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';
import {AgentRunController} from '../../../src/ai/runtime/controller.js';
import {ToolRegistry} from '../../../src/ai/tools/index.js';
import {normalizeRuntimeError} from '../../../src/ai/runtime/runtime-errors.js';
import type {ModelAdapter} from '../../../src/types.js';
const frame=(value:unknown)=>`data: ${JSON.stringify(value)}\n\n`;
const tool=(id:string)=>({choices:[{index:0,delta:{tool_calls:[{index:0,id,type:'function',function:{name:'effect',arguments:'{}'}}]},finish_reason:'tool_calls'}]});

describe('provider failure through actual HTTP, SDK and AgentRuntime',()=>{
  it.each(['quota','rate'] as const)('%s preserves completed tools and emits only safe failure facts',async kind=>{
    const requests:unknown[]=[];
    const server=createServer(async(req,res)=>{
      let body='';for await(const part of req)body+=part;requests.push(JSON.parse(body));
      const count=requests.length;
      if(count===2){
        res.writeHead(429,{'content-type':'application/json','retry-after':'1','x-request-id':'PRIVATE_CANARY'});
        res.end(JSON.stringify({error:{code:kind==='quota'?'1310':'1302',message:kind==='quota'?'您的限额将在 2026-12-10 09:30:00 重置。PRIVATE_CANARY':'PRIVATE_CANARY'}}));return;
      }
      res.writeHead(200,{'content-type':'text/event-stream'});
      res.end((count===1?frame(tool('completed')):frame({choices:[{index:0,delta:{content:'finished'},finish_reason:'stop'}]}))+'data: [DONE]\n\n');
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const port=(server.address() as {port:number}).port;
    const adapter=new OpenAIAdapter({apiKey:'fictional',harnessContext:buildOpenAIHarnessContext({identity:{providerId:'glm',providerType:'first_party',protocol:'openai_legacy',canonicalBaseUrl:`http://127.0.0.1:${port}/v1`,wireModel:'GLM-5.3',capabilities:['tools']},flags:resolveKimiHarnessFeatureFlags({})})});
    let effects=0;const events:unknown[]=[];
    const registry=new ToolRegistry({autoMode:true},[{permission:'safe',definition:{name:'effect',description:'fictional effect',inputSchema:{type:'object',properties:{}}},execute:async()=>{effects++;return 'COMPLETED_EFFECT';}}]);
    const session=new AgentSessionState();
    try{
      const runtime=new AgentRuntime({adapter,registry,session,controller:new AgentRunController(),systemPrompt:''});
      const error=await runtime.run('fictional test',e=>events.push(e)).then(()=>undefined,e=>e);
      expect(effects).toBe(1);
      expect(JSON.stringify(session.getMessages())).toContain('COMPLETED_EFFECT');
      expect(JSON.stringify(events)).not.toContain('PRIVATE_CANARY');
      if(kind==='quota'){
        expect(requests).toHaveLength(2);
        expect(normalizeRuntimeError(error)).toMatchObject({code:'model_failed',retryable:false,message:expect.stringContaining('1310')});
        expect(events).not.toContainEqual(expect.objectContaining({type:'model_recovery'}));
      }else{
        expect(error).toBeUndefined();expect(requests).toHaveLength(3);
        expect(JSON.stringify(requests[2])).toContain('COMPLETED_EFFECT');
        expect(events).toContainEqual(expect.objectContaining({type:'model_recovery',failure:expect.objectContaining({provider:'glm',providerCode:'1302',category:'rate_limit',status:429})}));
      }
    }finally{registry.dispose();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it.each(['PRIVATE_CANARY', { status: 401, message: 'PRIVATE_CANARY', toString: () => 'PRIVATE_CANARY' }])('never exposes a non-Error model rejection to public events', async rejection => {
    const events: unknown[] = [];
    const adapter: ModelAdapter = { getModelName: () => 'fixture', async *stream() { throw rejection; } };
    const registry = new ToolRegistry({ autoMode: true }, []);
    try {
      const runtime = new AgentRuntime({ adapter, registry, session: new AgentSessionState(), controller: new AgentRunController(), systemPrompt: '' });
      const error = await runtime.run('fictional', e => events.push(e)).catch(e => e);
      expect(normalizeRuntimeError(error).code).toBe('model_failed');
      expect(JSON.stringify(events) + normalizeRuntimeError(error).message).not.toContain('PRIVATE_CANARY');
    } finally { registry.dispose(); }
  });
  it('reports a local model-read failure as xiaok without exposing its raw exception',async()=>{
    const original=new TypeError('PRIVATE_CANARY');const events:unknown[]=[];
    const adapter:ModelAdapter={getModelName:()=> 'fixture',async *stream(){throw original;}};
    const registry=new ToolRegistry({autoMode:true},[]);
    try{
      const runtime=new AgentRuntime({adapter,registry,session:new AgentSessionState(),controller:new AgentRunController(),systemPrompt:''});
      await expect(runtime.run('fictional',e=>events.push(e))).rejects.toBe(original);
      expect(events).toContainEqual(expect.objectContaining({type:'run_failed',error:expect.objectContaining({code:'model_failed',message:expect.stringContaining('xiaok')})}));
      expect(JSON.stringify(events)).not.toContain('PRIVATE_CANARY');
    }finally{registry.dispose();}
  });
});
