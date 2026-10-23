// @vitest-environment node
// UNAPPROVED DESIGN15 delta. Copy to desktop/tests/main/observation5-facade-species.test.ts.
// SOURCE-BEFORE RUNNABLE: imports only existing production via fixture; no new module import.
import {types} from 'node:util';
import {expect,it} from 'vitest';
import {fixture,getNativeSurrogate} from './observation5-fixture.js';
const nativeSurrogate=getNativeSurrogate();
const NativePromise=Promise;
const methods=['prepareObservationTask','createObservationTask','getObservationTaskStatus','stopObservationTask','revokeObservationTask'] as const;
type Method=typeof methods[number];
const turn=()=>new NativePromise<void>(resolve=>setImmediate(resolve));
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new NativePromise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const errorFor=(method:Method)=>method==='createObservationTask'?'observation_create_outcome_unknown':method==='stopObservationTask'||method==='revokeObservationTask'?'observation_control_outcome_unknown':'observation_projection_unavailable';
async function boundary(method:Method,produce:(result:unknown)=>unknown) {
 const f=await fixture(),ordinary=f.installControllerSurrogate();let effects=0;
 const begin=(result:unknown)=>{effects++;return produce(result);};
 let args:unknown[]=[],result:unknown;
 if(method==='prepareObservationTask') {
  result={canceled:true,filePaths:[]};nativeSurrogate.pickerProducer=()=>begin(result); // Plain callback: tinyspy must not observe .then/species before production.
 } else if(method==='createObservationTask') {
  const draft=await f.invoke('prepareObservationTask');args=[{draftId:draft.draftId,prompt:'  owned  ',threadId:'thread_1'}];
  result={taskId:'owned-task',control:ordinary.control};f.service.createObservationTask=(()=>begin(result)) as never;
 } else if(method==='stopObservationTask'||method==='revokeObservationTask') {
  const draft=await f.invoke('prepareObservationTask');await f.invoke('createObservationTask',{draftId:draft.draftId,prompt:'owned'});args=[{taskId:'owned-task'}];
  if(method==='stopObservationTask')f.service.stopObservationTask=(()=>begin(undefined)) as never;
  else f.service.revokeObservationTask=(()=>begin(undefined)) as never;
 } else {
  args=[{taskId:'owned-task'}];result='active';f.service.observationTaskStatus=(()=>begin(result)) as never;
 }
 return {...f,args,ordinary,get effects(){return effects;},invokeBoundary:()=>f.invoke(method,...args)};
}
const rows=methods.flatMap(method=>(['getter','value'] as const).flatMap(species=>(['fulfilled-producer','rejecting-producer'] as const).map(producer=>({method,species,producer}))));
it.each(rows)('actual $method closure/facade -> registrar blocks ambient $species before $producer; getter0/effect0/unhandled0',async({method,species,producer})=>{
 const marker=Error(`owned-unstarted-${method}-${producer}`),f=await boundary(method,result=>producer==='rejecting-producer'?NativePromise.reject(marker):NativePromise.resolve(result));
 const original=Object.getOwnPropertyDescriptor(NativePromise,Symbol.species)!;let reads=0,pending:unknown;
 const unhandled:unknown[]=[],observe=(reason:unknown)=>{unhandled.push(reason);};process.on('unhandledRejection',observe);
 try {
  try {
   Object.defineProperty(NativePromise,Symbol.species,species==='getter'?{configurable:true,get(){reads++;return NativePromise;}}:{configurable:true,value:NativePromise});
   pending=f.invokeBoundary(); // No async test facade: actual registerDesktopIpc -> actual typed facade when applied.
  } finally {Object.defineProperty(NativePromise,Symbol.species,original);}
  // Framework assertions and all test Promise observers run only after ambient restoration.
  expect(types.isPromise(pending)).toBe(true);
  const outcome=await(pending as Promise<unknown>).then(()=>({rejected:false,error:undefined as unknown}),error=>({rejected:true,error}));
  await turn();await turn();
  expect(reads).toBe(0);expect(f.effects).toBe(0);expect(unhandled).toEqual([]);expect(f.gate.outstanding).toBe(0);
  expect(outcome.rejected).toBe(true);expect(outcome.error).toBeInstanceOf(Error);expect((outcome.error as Error).message).toBe(errorFor(method));
 } finally {Object.defineProperty(NativePromise,Symbol.species,original);process.removeListener('unhandledRejection',observe);}
});
it.each(methods)('actual %s healthy ambient retains physical token until fulfilled producer settlement, effect exactly once',async method=>{
 const held=deferred<unknown>(),f=await boundary(method,()=>held.promise);const pending=f.invokeBoundary();
 expect(types.isPromise(pending)).toBe(true);expect(f.effects).toBe(1);expect(f.gate.outstandingByKind().ipc).toBe(1);
 held.resolve(method==='prepareObservationTask'?{canceled:true,filePaths:[]}:method==='createObservationTask'?{taskId:'owned-task',control:f.ordinary.control}:method==='getObservationTaskStatus'?'active':undefined);
 const result=await pending;expect(result).toEqual(method==='prepareObservationTask'?null:method==='createObservationTask'?{taskId:'owned-task'}:{mode:'active'});
 expect(f.effects).toBe(1);expect(f.gate.outstanding).toBe(0);
});
it.each(methods)('actual %s healthy ambient observes producer rejection exactly once and retains token until rejection settles',async method=>{
 const held=deferred<unknown>(),f=await boundary(method,()=>held.promise),marker=Error('owned-observation-failure');
 const unhandled:unknown[]=[],observe=(reason:unknown)=>{unhandled.push(reason);};process.on('unhandledRejection',observe);
 try {
  const pending=f.invokeBoundary(),outcome=pending.then(()=>({rejected:false,error:undefined as unknown}),error=>({rejected:true,error}));
  expect(f.effects).toBe(1);expect(f.gate.outstandingByKind().ipc).toBe(1);held.reject(marker);
  const result=await outcome;await turn();await turn();expect(result.rejected).toBe(true);expect(result.error).toBe(marker);expect(f.effects).toBe(1);expect(unhandled).toEqual([]);expect(f.gate.outstanding).toBe(0);
 } finally {process.removeListener('unhandledRejection',observe);}
});
it('ambient denial does not burn the real single-use draft; healthy retry is an explicit second user invocation',async()=>{
 const f=await boundary('createObservationTask',result=>NativePromise.resolve(result));const original=Object.getOwnPropertyDescriptor(NativePromise,Symbol.species)!;let pending:unknown,reads=0;
 try{Object.defineProperty(NativePromise,Symbol.species,{configurable:true,get(){reads++;return NativePromise;}});pending=f.invokeBoundary();}finally{Object.defineProperty(NativePromise,Symbol.species,original);}
 const outcome=await(pending as Promise<unknown>).then(()=>false,()=>true);expect(outcome).toBe(true);expect(f.effects).toBe(0);expect(reads).toBe(0);
 expect(await f.invokeBoundary()).toEqual({taskId:'owned-task'});expect(f.effects).toBe(1);await expect(f.invokeBoundary()).rejects.toThrow('observation_draft_invalid');expect(f.effects).toBe(1);
});
it.each(['stopObservationTask','revokeObservationTask'] as const)('owned-task %s surplus tuple is rejected before genuine sender-bound control dispatch (unmasks old fixture green)',async method=>{
 const f=await fixture(),ordinary=f.installControllerSurrogate(),draft=await f.invoke('prepareObservationTask');await f.invoke('createObservationTask',{draftId:draft.draftId,prompt:'owned'});
 const calls=method==='stopObservationTask'?ordinary.stops:ordinary.revokes;expect(calls).toHaveLength(0);
 await expect(f.invoke(method,{taskId:'owned-task'},undefined)).rejects.toThrow('observation_task_owner_required');expect(calls).toHaveLength(0);
});
// Original nativePromise7, ctor/own-then, WeakMap, owner and UI populations are retained separately.
// Ordinary producer callback substitution is NOT actual controller/native/material qualification.
