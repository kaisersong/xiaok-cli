import {AgentRuntime} from '../../../src/ai/runtime/agent-runtime.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';
import {AgentRunController} from '../../../src/ai/runtime/controller.js';
import {recoverModelStream} from '../../../src/ai/runtime/model-stream-recovery.js';
import {ModelStreamPhysicalOwner} from '../../../src/ai/runtime/model-stream-physical-owner.js';
import {afterEach,expect,it,vi} from 'vitest';
import {Agent} from '../../../src/ai/agent.js';
import {ToolRegistry} from '../../../src/ai/tools/index.js';
import type {ModelAdapter,StreamChunk} from '../../../src/types.js';
import {createNamedSubAgentSession} from '../../../src/ai/agents/subagent-executor.js';
const clean:Array<()=>unknown>=[];
afterEach(async()=>{for(const close of clean.splice(0).reverse())await close();vi.unstubAllEnvs();vi.restoreAllMocks();});
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
const tick=()=>new Promise<void>(r=>setTimeout(r,10));
interface PhysicalAgent {stopNewRuns(reason?:unknown):void;waitForStoppedResources():Promise<void>;waitForIdleResources():Promise<void>}
function heldAdapter(done=false){
 const entered=deferred<void>(),returnEntered=deferred<void>(),read=deferred<IteratorResult<StreamChunk>>(),closing=deferred<IteratorResult<StreamChunk>>();
 let nextCalls=0,returnCalls=0;
 const iterator:AsyncIterableIterator<StreamChunk>={
  [Symbol.asyncIterator](){return this;},
  next(){nextCalls++;entered.resolve();return done?Promise.resolve({done:false,value:nextCalls%2?{type:'text',delta:'complete original answer'}:{type:'done'}}):read.promise;},
  return(){returnCalls++;returnEntered.resolve();return closing.promise;},
 };
 const adapter:ModelAdapter={getModelName:()=> 'synthetic-owned-reader',stream:()=>iterator};
 clean.push(()=>{read.resolve({done:true,value:undefined});closing.resolve({done:true,value:undefined});});
 return{adapter,entered,returnEntered,read,closing,counts:()=>({nextCalls,returnCalls})};
}
function actualAgent(adapter:ModelAdapter){const registry=new ToolRegistry({autoMode:true},[]),agent=new Agent(adapter,registry,'system');clean.push(()=>{agent.dispose();registry.dispose();});return{agent,physical:agent as unknown as PhysicalAgent,registry};}
it('visible original cancellation finishes while original next and return still hold physical close',async()=>{
 const f=heldAdapter(),{agent,physical}=actualAgent(f.adapter),abort=new AbortController(),reason=new DOMException('original A','AbortError');
 const run=agent.runTurn('work',()=>{},abort.signal).then(()=>undefined,e=>e);await f.entered.promise;abort.abort(reason);expect(await run).toBe(reason);
 physical.stopNewRuns(reason);const closed=physical.waitForStoppedResources();expect(physical.waitForStoppedResources()).toBe(closed);let settled=false;void closed.then(()=>{settled=true;},()=>{settled=true;});
 await tick();expect(settled).toBe(false);expect(()=>agent.clearHistory()).toThrow('agent_disposed');
 f.read.resolve({done:false,value:{type:'text',delta:'uncommitted late output'}});await f.returnEntered.promise;await tick();expect(settled).toBe(false);
 f.closing.resolve({done:true,value:undefined});await closed;expect(settled).toBe(true);expect(f.counts()).toEqual({nextCalls:1,returnCalls:1});
});
it.each(['Error','AbortError'])('abandoned original read B named %s stays distinct from cancellation A',async name=>{
 const f=heldAdapter(),{agent,physical}=actualAgent(f.adapter),abort=new AbortController(),reason=new DOMException('A','AbortError'),failure=Object.assign(Error('independent raw B'),{name});
 const run=agent.runTurn('work',()=>{},abort.signal).catch(e=>e);await f.entered.promise;abort.abort(reason);expect(await run).toBe(reason);
 physical.stopNewRuns(reason);const closed=physical.waitForStoppedResources().catch(e=>e);f.read.reject(failure);f.closing.resolve({done:true,value:undefined});
 const result=await closed;expect(result).toBeInstanceOf(AggregateError);expect(result.errors).toContain(failure);expect(result.errors).not.toContain(reason);
});
it.each(['success','failure'])('normal done retains the actual held return until %s',async outcome=>{
 const f=heldAdapter(true),{agent,physical}=actualAgent(f.adapter);await agent.runTurn('work',()=>{});await f.returnEntered.promise;
 const failure=Error('original return cleanup B');physical.stopNewRuns();let settled=false;const closed=physical.waitForStoppedResources().then(()=>{settled=true;return undefined;},e=>{settled=true;return e;});await tick();expect(settled).toBe(false);
 if(outcome==='failure')f.closing.reject(failure);else f.closing.resolve({done:true,value:undefined});
 const result=await closed;if(outcome==='failure'){expect(result).toBeInstanceOf(AggregateError);expect(result.errors).toContain(failure);}else expect(result).toBeUndefined();
});
it('a completed visible turn cannot drop pending physical return by replacing history or adapter',async()=>{
 const f=heldAdapter(true),{agent,physical}=actualAgent(f.adapter);await agent.runTurn('work',()=>{});await f.returnEntered.promise;
 expect(()=>agent.clearHistory()).toThrow();expect(()=>agent.restoreSession(agent.exportSession())).toThrow();expect(()=>agent.setAdapter({...f.adapter})).toThrow();
 let settled=false;const idle=physical.waitForIdleResources().then(()=>{settled=true;});await tick();expect(settled).toBe(false);f.closing.resolve({done:true,value:undefined});await idle;
 expect(()=>agent.clearHistory()).not.toThrow();await agent.runTurn('next',()=>{});physical.stopNewRuns();await physical.waitForStoppedResources();
});
it('actual named dispose waits for original model resources after its visible run aborts',async()=>{
 const f=heldAdapter(),registry=new ToolRegistry({autoMode:true},[]),session=await createNamedSubAgentSession({agentDef:{name:'real-child',systemPrompt:'',source:'builtin'},cwd:process.cwd(),sessionId:'physical-child',adapter:()=>f.adapter,createRegistry:()=>registry,buildSystemPrompt:async()=> 'system'});
 const run=session.run('work').catch(e=>e);await f.entered.promise;let settled=false;const originalClosing=session.dispose(),closing=originalClosing.then(()=>{settled=true;return undefined;},e=>{settled=true;return e;});
 await run;await tick();expect(settled).toBe(false);f.read.resolve({done:false,value:{type:'text',delta:'uncommitted late output'}});await f.returnEntered.promise;await tick();expect(settled).toBe(false);f.closing.resolve({done:true,value:undefined});expect(await closing).toBeUndefined();expect(settled).toBe(true);expect(session.dispose()).toBe(originalClosing);
});
it('actual named suspend keeps the original registry and blocks a concurrent next run until raw return drains',async()=>{
 const f=heldAdapter(true),registry=new ToolRegistry({autoMode:true},[]),dispose=vi.spyOn(registry,'dispose'),session=await createNamedSubAgentSession({agentDef:{name:'real-child',systemPrompt:'',source:'builtin'},cwd:process.cwd(),sessionId:'physical-suspend',adapter:()=>f.adapter,createRegistry:()=>registry,buildSystemPrompt:async()=> 'system'});
 await session.run('work');await f.returnEntered.promise;let settled=false;const suspending=session.suspend().then(()=>{settled=true;});
 await tick();expect(settled).toBe(false);expect(dispose).not.toHaveBeenCalled();await expect(session.run('too early')).rejects.toThrow();
 f.closing.resolve({done:true,value:undefined});await suspending;expect(dispose).toHaveBeenCalledTimes(1);await session.dispose();
});

it('actual named suspend failure remains sticky and never releases its allocation', async () => {
 const f=heldAdapter(true),registry=new ToolRegistry({autoMode:true},[]),fault=Error('original suspension model cleanup failed');
 const release=vi.fn(async()=>{}),manager={allocate:async()=>({path:process.cwd(),cleanup:'delete'}),release};
 const session=await createNamedSubAgentSession({agentDef:{name:'sticky-child',systemPrompt:'',source:'builtin',isolation:'worktree',cleanup:'delete'},cwd:process.cwd(),sessionId:'sticky-child',adapter:()=>f.adapter,createRegistry:()=>registry,buildSystemPrompt:async()=> 'system',worktreeManager:manager as any});
 await session.run('work');await f.returnEntered.promise;f.closing.reject(fault);
 const suspensionError=await session.suspend().catch(e=>e);expect(suspensionError).toBeInstanceOf(AggregateError);expect(suspensionError.errors).toContain(fault);
 await expect(session.run('cannot reopen')).rejects.toThrow();const disposal=session.dispose();expect(await disposal.catch(e=>e)).toBeInstanceOf(AggregateError);
 expect(session.dispose()).toBe(disposal);expect(release).not.toHaveBeenCalled();
});

it.each(['late-usage', 'independent-late-failure'] as const)('all original retry attempt promises remain owned through %s without replay', async outcome => {
 const owner=new ModelStreamPhysicalOwner(),claim=owner.admit(),late=deferred<IteratorResult<StreamChunk>>(),returnOne=deferred<IteratorResult<StreamChunk>>(),returnTwo=deferred<IteratorResult<StreamChunk>>();
 const fault=Error('independent abandoned retry read B');let attempts=0,firstReads=0,secondReads=0,returns=0;
 const open=()=>{const number=++attempts;return{[Symbol.asyncIterator](){return this;},next(){
  if(number===1){firstReads++;return late.promise;}
  secondReads++;return Promise.resolve({done:false as const,value:secondReads===1?{type:'text' as const,delta:'CURRENT_ONLY'}:{type:'done' as const}});
 },return(){returns++;return number===1?returnOne.promise:returnTwo.promise;}};};
 const values:StreamChunk[]=[];
 try{
  for await(const value of recoverModelStream({open,signal:owner.signal,physicalRun:claim,policy:{windowMs:500,idleMs:15,initialDelayMs:1,maxDelayMs:1}}))values.push(value);
 }finally{claim.finish();}
 expect(attempts).toBe(2);expect(firstReads).toBe(1);expect(secondReads).toBe(2);expect(returns).toBe(2);
 expect(values).toEqual([{type:'text',delta:'CURRENT_ONLY'},{type:'done'}]);owner.stop();let settled=false;
 const closing=owner.waitForStopped().then(()=>{settled=true;return undefined;},e=>{settled=true;return e;});
 returnOne.resolve({done:true,value:undefined});returnTwo.resolve({done:true,value:undefined});await tick();expect(settled).toBe(false);
 if(outcome==='late-usage')late.resolve({done:false,value:{type:'usage',inputTokens:3,outputTokens:7}});else late.reject(fault);
 const result=await closing;if(outcome==='late-usage')expect(result).toBeUndefined();else{expect(result).toBeInstanceOf(AggregateError);expect(result.errors).toContain(fault);}
 expect(values).toEqual([{type:'text',delta:'CURRENT_ONLY'},{type:'done'}]);
});
it('synchronous original next failure stays visible and synchronous return failure remains unknown physical cleanup', async () => {
 const owner=new ModelStreamPhysicalOwner(),claim=owner.admit(),readFault=Error('original sync next B'),returnFault=Error('original sync return C');
 const iterator={ [Symbol.asyncIterator](){return this;},next():Promise<IteratorResult<StreamChunk>>{throw readFault;},return():Promise<IteratorResult<StreamChunk>>{throw returnFault;} };
 const run=(async()=>{try{for await(const _ of recoverModelStream({open:()=>iterator,signal:owner.signal,physicalRun:claim,policy:{windowMs:0,idleMs:15,initialDelayMs:1,maxDelayMs:1}})){} }finally{claim.finish();}})();
 await expect(run).rejects.toBe(readFault);owner.stop();const error=await owner.waitForStopped().catch(e=>e);
 expect(error).toBeInstanceOf(AggregateError);expect(error.errors).toEqual([returnFault]);
});

it.each(['new-turn', 'different-adapter'] as const)('an unknown original return failure denies %s after visible completion', async action => {
 const f=heldAdapter(true),{agent,physical}=actualAgent(f.adapter),fault=Error('original lifetime cleanup unknown');
 await agent.runTurn('work',()=>{});await f.returnEntered.promise;f.closing.reject(fault);
 const error=await physical.waitForIdleResources().catch(e=>e);expect(error).toBeInstanceOf(AggregateError);expect(error.errors).toContain(fault);
 if(action==='different-adapter')expect(()=>agent.setAdapter({...f.adapter})).toThrow('agent_model_resources_pending');
 else{await expect(agent.runTurn('must not reenter',()=>{})).rejects.toThrow('agent_model_cleanup_unconfirmed');expect(f.counts().nextCalls).toBe(2);}
});
it('original preaborted reason wins over stopped Agent and direct Runtime ingress', async () => {
 const f=heldAdapter(),{agent,physical}=actualAgent(f.adapter),abort=new AbortController(),reason={private:'original closing A'};
 physical.stopNewRuns(reason);abort.abort(reason);
 await expect(agent.runTurn('no ingress',()=>{},abort.signal)).rejects.toBe(reason);
 expect(f.counts().nextCalls).toBe(0);await physical.waitForStoppedResources();
 const owner=new ModelStreamPhysicalOwner(),registry=new ToolRegistry({autoMode:true},[]);clean.push(()=>registry.dispose());
 const runtime=new AgentRuntime({session:new AgentSessionState(),registry,adapter:f.adapter,controller:new AgentRunController(),systemPrompt:'system',modelPhysicalOwner:owner});
 owner.stop(reason);await expect(runtime.run('no direct ingress',()=>{},abort.signal)).rejects.toBe(reason);
 expect(f.counts().nextCalls).toBe(0);await owner.waitForStopped();
});

it('a shared original next/return Promise cannot retire the return failure as a known read cancellation', async () => {
 const owner=new ModelStreamPhysicalOwner(),claim=owner.admit(),shared=deferred<IteratorResult<StreamChunk>>(),entered=deferred<void>(),abort=new AbortController(),reason={original:'shared operation cancellation A'};
 let returns=0;const iterator={ [Symbol.asyncIterator](){return this;},next(){entered.resolve();return shared.promise;},return(){returns++;return shared.promise;} };
 const run=(async()=>{try{for await(const _ of recoverModelStream({open:()=>iterator,signal:abort.signal,physicalRun:claim,policy:{windowMs:0,idleMs:1000,initialDelayMs:1,maxDelayMs:1}})){} }finally{claim.finish();}})().catch(e=>e);
 await entered.promise;abort.abort(reason);expect(await run).toBe(reason);expect(returns).toBe(1);owner.stop(reason);
 const closing=owner.waitForStopped().then(()=>undefined,e=>e);shared.reject(reason);const error=await closing;
 expect(error).toBeInstanceOf(AggregateError);expect(error.errors).toEqual([reason]);
});
it('two original return operations sharing one Promise both classify before physical close settles', async () => {
 const owner=new ModelStreamPhysicalOwner(),claim=owner.admit(),shared=deferred<IteratorResult<StreamChunk>>(),fault=Error('shared original return failure');
 claim.observeReturn(shared.promise);claim.observeReturn(shared.promise);claim.finish();owner.stop();
 const closing=owner.waitForStopped().catch(e=>e);shared.reject(fault);const error=await closing;
 expect(error).toBeInstanceOf(AggregateError);expect(error.errors).toEqual([fault,fault]);
});

it.each(['fulfilled', 'rejected'] as const)('raw read %s remains charged until its original receipt classifies', async outcome => {
 const owner=new ModelStreamPhysicalOwner(),claim=owner.admit(),raw=deferred<void>(),reason={original:'visible A'},fault=Error('original late read B');
 const receipt=claim.observeRead(raw.promise,()=>[]);claim.finish();owner.stop(reason);
 let settled=false;const closing=owner.waitForStopped().then(()=>{settled=true;return undefined;},error=>{settled=true;return error;});
 if(outcome==='rejected')raw.reject(fault);else raw.resolve();await tick();expect(settled).toBe(false);expect(owner.hasPending()).toBe(true);
 if(outcome==='rejected')receipt.classifyFailure(reason);else receipt.consume();
 const error=await closing;if(outcome==='rejected'){expect(error).toBeInstanceOf(AggregateError);expect(error.errors).toEqual([fault]);}else expect(error).toBeUndefined();
 expect(owner.hasPending()).toBe(false);
});
