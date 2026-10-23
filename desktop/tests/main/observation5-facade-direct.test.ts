// @vitest-environment node
// POSTAPPLY ONLY: requires reviewed observation-service-facade.ts; NEVER source-before request.
import {expect,it} from 'vitest';
import {createObservationServiceFacade} from '../../electron/observation-service-facade.js';
import {fixture} from './observation5-fixture.js';
const NativePromise=Promise;
const methods=['createObservationTask','stopObservationTask','revokeObservationTask','observationTaskStatus'] as const;
const turn=()=>new NativePromise<void>(resolve=>setImmediate(resolve));
const rows=methods.flatMap(method=>(['getter','value'] as const).flatMap(species=>(['fulfilled','rejecting'] as const).map(producer=>({method,species,producer}))));
it.each(rows)('direct actual $method facade denies ambient $species before $producer; getter0/effect0/unhandled0',async({method,species,producer})=>{
 const f=await fixture(),facade=createObservationServiceFacade(f.service);let effects=0,reads=0;
 f.service[method]=(()=>{effects++;return producer==='rejecting'?NativePromise.reject(Error('unstarted-facade')):NativePromise.resolve(method==='createObservationTask'?{taskId:'owned',control:{}}:method==='observationTaskStatus'?'active':undefined);}) as never;
 const original=Object.getOwnPropertyDescriptor(NativePromise,Symbol.species)!,unhandled:unknown[]=[],observe=(reason:unknown)=>{unhandled.push(reason);};process.on('unhandledRejection',observe);let error:unknown;
 try {
  try{Object.defineProperty(NativePromise,Symbol.species,species==='getter'?{configurable:true,get(){reads++;return NativePromise;}}:{configurable:true,value:NativePromise});try{Reflect.apply(facade[method],facade,method==='createObservationTask'?[{prompt:'owned',materials:[]},{requestSource:'user',approval:{}}]:['owned',{requestSource:'user',control:{}}]);}catch(failure){error=failure;}}
  finally{Object.defineProperty(NativePromise,Symbol.species,original);}
  await turn();await turn();expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe(method==='createObservationTask'?'observation_create_outcome_unknown':method==='observationTaskStatus'?'observation_projection_unavailable':'observation_control_outcome_unknown');expect(effects).toBe(0);expect(reads).toBe(0);expect(unhandled).toEqual([]);
 }finally{Object.defineProperty(NativePromise,Symbol.species,original);process.removeListener('unhandledRejection',observe);}
});
