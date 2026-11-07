// Source-before controls; successful queue/SDK/physical planning are not qualified here.
// @vitest-environment node
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import { expect, it } from 'vitest';
import { fixture, deferred } from '../support/diagnostics-input-fixture.js';
import { IPC_SCHEMA_REGISTRY } from '../../electron/ipc-runtime.js';
const channel = 'desktop:kswarm:startProjectPlanning';
it('planning owns an exact one-argument tuple before project-id logging', async () => {
  await fixture(200,{authorizeTaskActor:true});
  expect(IPC_SCHEMA_REGISTRY.get(channel)).toMatchObject({ payloadMode: 'tuple', inputStage: 'beforeHandler', sourceFile: 'desktop/electron/project-planning-typed-ipc.ts' });
});
it('planning payload accessor cannot run before admission and enqueue', async () => {
  const f = await fixture(200,{authorizeTaskActor:true}); let reads = 0, effects = 0;
  f.service.startProjectPlanning = (() => { effects++; return { ok: true, status: 'queued' }; }) as typeof f.service.startProjectPlanning;
  const input = Object.defineProperty({}, 'projectId', { enumerable: true, get() { reads++; throw Error('planning-owned-getter'); } });
  const pending = Reflect.apply(f.listeners.get(channel)!, undefined, [{ sender: f.sender, senderFrame: f.frame }, input]);
  const error = await Promise.resolve(pending).then(() => null, error => error);
  expect(reads).toBe(0); expect(effects).toBe(0); expect(error.message).toBe('project_planning_input_invalid'); expect(f.gate.outstanding).toBe(0);
});
it.each([undefined, 'agent', 'scheduler', 'unknown'])('public planning service denies %s before reading the payload', async source => {
  const f = await fixture(200,{authorizeTaskActor:true}); let reads = 0;
  const input = Object.defineProperty({}, 'projectId', { enumerable: true, get() { reads++; throw Error('planning-owned-service-getter'); } });
  let error: unknown;
  try { Reflect.apply(f.service.startProjectPlanning, f.service, [input, source]); } catch (failure) { error = failure; }
  expect(reads).toBe(0); expect(error).toBeInstanceOf(Error); expect((error as Error).message).toBe('project_planning_source_forbidden');
});
it.each(['queued','running','succeeded','launch_unknown'] as const)('real planning IPC preserves truthful %s progress',async status=>{
 const f=await fixture(200,{authorizeTaskActor:true});
 f.service.startProjectPlanning=(()=>({ok:true,status})) as typeof f.service.startProjectPlanning;
 const input={projectId:'p',projectName:'p',goal:'g',requirements:'',planningGuidance:'',poAgent:'po',members:[]};
 const result=await Reflect.apply(f.listeners.get(channel)!,undefined,[{sender:f.sender,senderFrame:f.frame},input]);
 expect(result).toEqual({ok:true,status});expect(f.gate.outstanding).toBe(0);
});
const planningInput={projectId:'p',projectName:'p',goal:'g',requirements:'',planningGuidance:'',poAgent:'po',members:[]};
it('the real planning registration refuses a recording-only window before service execution',async()=>{
 const f=await fixture(200,{authorizeTaskActor:true});let effects=0;f.service.startProjectPlanning=(()=>{effects++;return{ok:true,status:'queued'};}) as typeof f.service.startProjectPlanning;
 const outcome=await Promise.resolve(Reflect.apply(f.listeners.get(channel)!,undefined,[{sender:f.recorder,senderFrame:f.recorderFrame},planningInput])).then(value=>({value}),error=>({error}));
 expect(effects).toBe(0);expect(Object.hasOwn(outcome,'error')).toBe(true);if('error' in outcome)expect(outcome.error.message).toBe('task_actor_forbidden');expect(f.gate.outstanding).toBe(0);
});
it('a revoked actual Main sender cannot cross the held owner HTTP read into the original planning journal',async()=>{
 const f=await fixture(200,{authorizeTaskActor:true}),hold=deferred<Response>();f.setResponse(()=>hold.promise);
 const pending=Promise.resolve(Reflect.apply(f.listeners.get(channel)!,undefined,[{sender:f.sender,senderFrame:f.frame},planningInput])).then(value=>({value}),error=>({error}));
 await Promise.resolve();expect(f.requests).toHaveLength(1);f.authority.setMain(null);hold.resolve(Response.json({ok:true,projectId:'p',producer:'broker_legacy_v1'}));const outcome=await pending;
 expect(Object.hasOwn(outcome,'error')).toBe(true);if('error' in outcome)expect(outcome.error.message).toBe('task_actor_forbidden');expect(existsSync(join(f.data,'kswarm-initial-plan-bootstrap-jobs.json'))).toBe(false);expect(f.gate.outstanding).toBe(0);
});
it('the actual original planning response body may settle after actor revocation without admitting a journal write',async()=>{
 const f=await fixture(200,{authorizeTaskActor:true});let body!:ReadableStreamDefaultController<Uint8Array>;
 const response=new Response(new ReadableStream<Uint8Array>({start(controller){body=controller;}}),{headers:{'content-type':'application/json'}});f.setResponse(()=>response);
 const pending=Promise.resolve(Reflect.apply(f.listeners.get(channel)!,undefined,[{sender:f.sender,senderFrame:f.frame},planningInput])).then(value=>({value}),error=>({error}));
 for(let attempts=0;attempts<20&&!response.bodyUsed;attempts++)await new Promise<void>(resolve=>setImmediate(resolve));expect(response.bodyUsed).toBe(true);
 f.authority.setMain(null);body.enqueue(new TextEncoder().encode(JSON.stringify({ok:true,projectId:'p',producer:'broker_legacy_v1'})));body.close();const outcome=await pending;
 expect(Object.hasOwn(outcome,'error')).toBe(true);if('error' in outcome)expect(outcome.error.message).toBe('task_actor_forbidden');expect(existsSync(join(f.data,'kswarm-initial-plan-bootstrap-jobs.json'))).toBe(false);expect(f.gate.outstanding).toBe(0);
});
it('a private async planning admission callback cannot authorize even the first actual owner HTTP request',async()=>{
 const f=await fixture(200,{authorizeTaskActor:true});let error:unknown;try{f.service.startProjectPlanning(planningInput,'user',async()=>{});}catch(failure){error=failure;}
 expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe('before_effects_guard_invalid');expect(f.requests).toHaveLength(0);expect(existsSync(join(f.data,'kswarm-initial-plan-bootstrap-jobs.json'))).toBe(false);
});
it('only the live original planning IPC can issue a trigger proof bound to its original Main journal owner',async()=>{
 const module=await import('../../electron/project-planning-typed-ipc.js'),inspect=Reflect.get(module,'inspectProjectPlanningTrigger');expect(typeof inspect).toBe('function');
 const f=await fixture(200,{authorizeTaskActor:true}),ownerGetter=Reflect.get(f.service,'getProjectPlanningTriggerOwner');expect(typeof ownerGetter).toBe('function');const owner=Reflect.apply(ownerGetter,f.service,[]);let captured:unknown;
 f.service.startProjectPlanning=((_input:unknown,_source:unknown,_current:unknown,proof:unknown)=>{captured=proof;const fact=inspect(proof,owner);expect(fact.actorId).toMatch(/^desktop-user:[a-f0-9]{64}$/);expect(fact.triggerRef).toMatch(/^main-explicit-planning:/);expect(()=>inspect({},owner)).toThrow('project_planning_trigger_unverified');expect(()=>inspect(proof,{})).toThrow('project_planning_trigger_unverified');return{ok:true,status:'queued'};}) as typeof f.service.startProjectPlanning;
 const result=await Reflect.apply(f.listeners.get(channel)!,undefined,[{sender:f.sender,senderFrame:f.frame},planningInput]);expect(result).toEqual({ok:true,status:'queued'});expect(captured).toBeDefined();expect(()=>inspect(captured,owner)).toThrow('project_planning_trigger_unverified');
});
it('a forged data object cannot become a native explicit trigger through the public user-string service call',async()=>{
 const f=await fixture(200,{authorizeTaskActor:true});const result=await Promise.resolve().then(()=>Reflect.apply(f.service.startProjectPlanning,f.service,[planningInput,'user',()=>{},{}])).then(value=>({value}),error=>({error}));
 expect(Object.hasOwn(result,'error')).toBe(true);if('error' in result)expect(result.error.message).toBe('project_planning_trigger_unverified');expect(f.requests).toHaveLength(0);expect(existsSync(join(f.data,'kswarm-initial-plan-bootstrap-jobs.json'))).toBe(false);
});
it('a live explicit gesture for one project cannot be redirected to another original project before owner HTTP',async()=>{
 const f=await fixture(200,{authorizeTaskActor:true}),original=f.service.startProjectPlanning;let rejected=false;
 f.service.startProjectPlanning=((input:unknown,source:unknown,current:unknown,proof:unknown)=>{try{Reflect.apply(original,f.service,[{...(input as object),projectId:'other-project'},source,current,proof]);}catch(error){rejected=true;expect((error as Error).message).toBe('project_planning_trigger_project_mismatch');}return{ok:true,status:'queued'};}) as typeof f.service.startProjectPlanning;
 await Reflect.apply(f.listeners.get(channel)!,undefined,[{sender:f.sender,senderFrame:f.frame},planningInput]);expect(rejected).toBe(true);expect(f.requests).toHaveLength(0);expect(existsSync(join(f.data,'kswarm-initial-plan-bootstrap-jobs.json'))).toBe(false);
});
it('both actual preload implementations transport the closed metadata action and preserve its explicit blocked result',async()=>{
 const f=await fixture(200,{authorizeTaskActor:true}),input={action:'add_task_and_plan' as const,projectId:'p',sourceTaskId:'task-original',proposal:{title:'User item'}},output={ok:true as const,status:'metadata_applied' as const,projectId:'p',operationId:'ordinary-input:'+'a'.repeat(64),planRunId:'11111111-1111-4111-8111-111111111111',ownerRevision:2,execution:{state:'blocked' as const,reasonCode:'CANDIDATE_WORKSPACE_UNAVAILABLE' as const}};
 f.service.startProjectPlanning=((actual:unknown)=>{expect(actual).toEqual(input);return output;}) as typeof f.service.startProjectPlanning;
 expect(await f.preload.kswarmStartProjectPlanning(input)).toEqual(output);expect(await f.cjs.kswarmStartProjectPlanning(input)).toEqual(output);expect(f.gate.outstanding).toBe(0);
});
