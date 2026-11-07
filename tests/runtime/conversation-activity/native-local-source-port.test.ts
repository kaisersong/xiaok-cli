import{afterEach,expect,it,vi}from'vitest';
import{mkdtempSync,rmSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';import{randomUUID}from'node:crypto';
import{ConversationActivityStore}from'../../../src/runtime/conversation-activity/store.js';
import{ConversationActivityService,type ActivityActor}from'../../../src/runtime/conversation-activity/service.js';
import{ActivityAttentionReaders,type AttentionReaderClient}from'../../../src/runtime/conversation-activity/attention-reader-owner.js';
import type{NativeAttentionReference}from'../../../src/runtime/conversation-activity/native-attention-source.js';
interface OriginalInternals{localReaders:ActivityAttentionReaders;localReaderClient:AttentionReaderClient;nativeRounds:Map<string,unknown>;
 beginNativeAttentionRead(id:string,actor:ActivityActor):Promise<{roundId:string;readerSlots:unknown[]}>;
 finalizeNativeAttentionRead(input:Record<string,unknown>,actor:ActivityActor):Promise<unknown>;abortNativeAttentionRead(id:string,actor:ActivityActor):Promise<unknown>}
const closes:Array<()=>Promise<void>|void>=[];afterEach(async()=>{vi.restoreAllMocks();for(const close of closes.splice(0).reverse())await close();});
async function fixture(){
 const root=mkdtempSync(join(tmpdir(),'native-local-port-'));closes.push(()=>rmSync(root,{recursive:true,force:true}));const store=new ConversationActivityStore(join(root,'activity.sqlite'));closes.push(()=>store.close());
 const actor=Object.freeze({requestSource:'user' as const,actorId:'user'}),other=Object.freeze({...actor}),actors=new WeakSet([actor,other]);let current=true,terminal=false;const failure=Error('actual_private_source_withdrawn');
 const reference:NativeAttentionReference={sourceKind:'codex_native_approval',taskId:'task',taskSessionId:'host-session',executionThreadId:'thread',nativeSessionId:'native-session',nativeThreadId:'native-thread',nativeTurnId:'native-turn',nativeGeneration:1,nativeIncarnation:randomUUID()};
 // The Main validator is controlled here. The separate default-Main test uses
 // real IPC admission and original Bridge private frames, not this predicate.
 let closeHandled=false;const service=new ConversationActivityService({store,profileId:'profile',actorId:'user',getThread:id=>id==='thread'?{threadId:id,profileId:'profile',workspaceId:'workspace',deleteState:'none'}:null,canObserveWork:()=>true,
  nativeAttentionSource:{assertActorCurrent:actor=>{if(!actors.has(actor)||!current)throw failure;},inspect:(actor,id)=>{if(!actors.has(actor)||!current||!['watch','alias'].includes(id))throw failure;return terminal?undefined:reference;}}});closes.push(()=>closeHandled?undefined:service.close());
 async function bind(watchId='watch'){await service.prepareAssociation({threadId:'thread',operationId:watchId,creationIdempotencyKey:watchId},actor);await service.bindWork({operationId:watchId,watchId,source:'task_host',logicalSourceId:'host',sourceDataEpoch:'host-session',workId:'task'});}
 await bind();return{store,service,actor,other,failure,reference,bind,original:service as unknown as OriginalInternals,revoke:()=>{current=false;},terminal:()=>{terminal=true;},handledClose:()=>{closeHandled=true;}};
}
it('rejects a plain or copied actor instead of treating reference-shaped data as a local Native witness',async()=>{
 const f=await fixture();for(const actor of[{...f.actor},structuredClone(f.actor),{...f.actor,requestSource:'agent' as const}])await expect(f.service.qualifyNativeAttentionReader('watch',actor)).rejects.toThrow();
 expect(f.store.getNativeAttentionEnrollment('watch')).toBeNull();await expect(f.service.qualifyNativeAttentionReader('watch',f.actor)).resolves.toMatchObject({sourceKind:'codex_native_approval'});
});
it('rejects copied, stale, wrong-action and wrong-watch operation contexts in the original registry',async()=>{
 const f=await fixture();await f.bind('alias');const original=ActivityAttentionReaders.prototype.qualifyNative;let captured:object|undefined;
 const spy=vi.spyOn(ActivityAttentionReaders.prototype,'qualifyNative').mockImplementation(async function(client,raw,context){captured=context;
  await expect(original.call(this,client,raw,structuredClone(context))).rejects.toThrow('activity_native_source_forbidden');
  await expect(original.call(this,client,{watchId:'alias',reference:f.reference},context)).rejects.toThrow('activity_native_source_forbidden');
  return original.call(this,client,raw,context);
 });
 await f.service.qualifyNativeAttentionReader('watch',f.actor);spy.mockRestore();
 await expect(f.original.localReaders.qualifyNative(f.original.localReaderClient,{watchId:'watch',reference:f.reference},captured)).rejects.toThrow('activity_native_source_forbidden');
 vi.spyOn(ActivityAttentionReaders.prototype,'qualifyNative').mockImplementation(async function(client,raw,context){await expect(this.begin(client,{watchId:'watch'},context)).rejects.toThrow('activity_native_source_forbidden');return original.call(this,client,raw,context);});
 await f.service.qualifyNativeAttentionReader('watch',f.actor);
});
it('reauthorizes after the original qualification await and commits no enrollment after withdrawal',async()=>{
 const f=await fixture(),original=f.service.authorizeRead.bind(f.service);vi.spyOn(f.service,'authorizeRead').mockImplementationOnce(async(...args)=>{const result=await original(...args);f.revoke();return result;});
 await expect(f.service.qualifyNativeAttentionReader('watch',f.actor)).rejects.toBe(f.failure);expect(f.store.getNativeAttentionEnrollment('watch')).toBeNull();
});
it('does not interpret terminal-only omission as an original terminal receipt',async()=>{
 const f=await fixture();f.terminal();await expect(f.service.qualifyNativeAttentionReader('watch',f.actor)).rejects.toThrow('attention_native_terminal_unverified');expect(f.store.getNativeAttentionEnrollment('watch')).toBeNull();
});
it('denies public MCP and another actual actor access to a Native ticket while its original owner can retire it after withdrawal',async()=>{
 const f=await fixture();await f.service.qualifyNativeAttentionReader('watch',f.actor);const round=await f.original.beginNativeAttentionRead('watch',f.actor);
 await expect(f.service.beginMcpAttentionRead('watch',f.actor)).rejects.toThrow('activity_native_source_forbidden');
 await expect(f.service.finalizeMcpAttentionRead({roundId:round.roundId,inventories:[]},f.actor)).rejects.toThrow('activity_native_source_forbidden');
 expect(()=>f.service.abortMcpAttentionRead(round.roundId,f.actor)).toThrow('activity_native_source_forbidden');
 expect(()=>f.original.finalizeNativeAttentionRead({roundId:round.roundId,inventories:[]},f.other)).toThrow('attention_round_conflict');
 expect(()=>f.original.abortNativeAttentionRead(round.roundId,f.other)).toThrow('attention_round_conflict');expect(f.original.nativeRounds.has(round.roundId)).toBe(true);
 f.revoke();await expect(f.original.finalizeNativeAttentionRead({roundId:round.roundId,inventories:[]},f.actor)).rejects.toBe(f.failure);await expect(f.original.abortNativeAttentionRead(round.roundId,f.actor)).resolves.toEqual({aborted:true});expect(f.original.nativeRounds.size).toBe(0);
});
it('records and reclaims the actual allocated ticket when its post-await source guard is withdrawn',async()=>{
 const f=await fixture();await f.service.qualifyNativeAttentionReader('watch',f.actor);const original=ActivityAttentionReaders.prototype.begin;let id='';
 vi.spyOn(ActivityAttentionReaders.prototype,'begin').mockImplementationOnce(async function(...args){const round=await original.apply(this,args);id=round.roundId;f.revoke();return round;});
 await expect(f.original.beginNativeAttentionRead('watch',f.actor)).rejects.toBe(f.failure);expect(id).toBeTruthy();expect(f.original.nativeRounds.size).toBe(0);
 const registry=f.original.localReaders as unknown as{rounds:Map<string,unknown>};expect(registry.rounds.has(id)).toBe(false);
});
it('also reclaims an allocated ticket when withdrawal runs between the inner admission check and the outer operation continuation',async()=>{
 const f=await fixture();await f.service.qualifyNativeAttentionReader('watch',f.actor);const target=f.service as unknown as{assertNativeActor(actor:ActivityActor):void};const original=target.assertNativeActor.bind(target);let queued=false;
 vi.spyOn(target,'assertNativeActor').mockImplementation(actor=>{original(actor);if(f.original.nativeRounds.size&&!queued){queued=true;queueMicrotask(()=>f.revoke());}});
 await expect(f.original.beginNativeAttentionRead('watch',f.actor)).rejects.toBe(f.failure);expect(queued).toBe(true);expect(f.original.nativeRounds.size).toBe(0);
 expect((f.original.localReaders as unknown as{rounds:Map<string,unknown>}).rounds.size).toBe(0);
});
it('rejects another service instance operation context even while the original context is still active',async()=>{
 const first=await fixture(),second=await fixture(),original=ActivityAttentionReaders.prototype.qualifyNative;let active:object|undefined,depth=0;
 vi.spyOn(ActivityAttentionReaders.prototype,'qualifyNative').mockImplementation(async function(client,raw,context){
  if(depth++===0){active=context;await second.service.qualifyNativeAttentionReader('watch',second.actor);}
  else await expect(original.call(this,client,raw,active)).rejects.toThrow('activity_native_source_forbidden');
  return original.call(this,client,raw,context);
 });
 await first.service.qualifyNativeAttentionReader('watch',first.actor);expect(first.store.getNativeAttentionEnrollment('watch')).not.toBeNull();expect(second.store.getNativeAttentionEnrollment('watch')).not.toBeNull();
});
it('joins a held original authorization tail and preserves its late physical IO cause during close',async()=>{
 const f=await fixture(),failure=Error('original_authorization_physical_IO_failure');let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 vi.spyOn(f.service,'authorizeRead').mockImplementationOnce(async()=>{entered();await gate;throw failure;});
 const pending=f.service.qualifyNativeAttentionReader('watch',f.actor),rejected=expect(pending).rejects.toBe(failure);await ready;
 const close=f.service.close();let settled=false;void close.then(()=>{settled=true;},()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);expect(f.store.getNativeAttentionEnrollment('watch')).toBeNull();
 release();await rejected;let caught:unknown;try{await close;}catch(error){caught=error;}expect(caught).toBeInstanceOf(AggregateError);expect((caught as AggregateError).errors).toContain(failure);f.handledClose();
});
