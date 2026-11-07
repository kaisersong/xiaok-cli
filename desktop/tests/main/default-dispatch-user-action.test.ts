// @vitest-environment node
// Controlled B observation and independent Main user-admission ports. These
// tests exercise the original journal owner, not the complete dispatch chain.
import {afterEach,it,expect,vi} from 'vitest';
import {mkdtempSync,readdirSync,readFileSync,rmSync,writeFileSync,linkSync,renameSync,appendFileSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
vi.mock('node:fs',async original=>({...await original<typeof import('node:fs')>()}));
import {MainUserSubmissionOwner} from '../../electron/main-user-submission.js';
import * as submissionModule from '../../electron/main-user-submission.js';
import * as nativeFs from 'node:fs';
import * as atomic from '../../../src/utils/atomic-file.js';
const roots:string[]=[];afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){
 const dataRoot=mkdtempSync(join(tmpdir(),'default-dispatch-fact-'));roots.push(dataRoot);const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},actor={requestSource:'user' as const,actorId:'desktop-user:'+scope.profileId};
 const observations=new WeakMap<object,{data:unknown;assertCurrent():void}>(),admissions=new WeakMap<object,{current:boolean;projectId:string;action:string}>(),value={scope,projectId:'p',planRevision:3,dispatchGeneration:0,bindingDigest:'c'.repeat(64),taskSetDigest:'d'.repeat(64)};
 const options={dataRoot,...scope,defaultDispatchSource:{resolve(frame:object){const result=observations.get(frame);if(!result)throw Error('controlled_observation_foreign');return result;}},defaultDispatchUserAdmission(frame:object,currentActor:{requestSource:string;actorId:string},audience?:{scope:typeof scope;projectId:string;action:string}){const admission=admissions.get(frame);if(!admission?.current||currentActor.actorId!==actor.actorId||audience&&(audience.projectId!==admission.projectId||audience.action!==admission.action||audience.scope.profileId!==scope.profileId||audience.scope.workspaceId!==scope.workspaceId))throw Error('controlled_user_admission_revoked');}};
 const owner=new MainUserSubmissionOwner(options),observe=(data:unknown=value)=>{let current=true;const frame=Object.freeze({});observations.set(frame,{data,assertCurrent(){if(!current)throw Error('controlled_observation_revoked');}});return{frame,revoke(){current=false;}};},admit=(projectId='p',action='dispatch_current_plan')=>{const frame=Object.freeze({}),state={current:true,projectId,action};admissions.set(frame,state);return{frame,revoke(){state.current=false;}};};
 const directory=join(dataRoot,'conversation-projects','user-submissions'),files=()=>readdirSync(directory).filter(name=>name.endsWith('.json'));
 return{owner,options,scope,actor,value,observations,observe,admit,directory,files};
}
it('original owner reader requires private membership and its exact raw constructor ports',()=>{
 const read=(submissionModule as any).readOriginalDefaultDispatchOwner;expect(read).toBeTypeOf('function');const f=fixture();let hooks=0;const fake=new Proxy({},{get(){hooks++;throw Error('trap');},getOwnPropertyDescriptor(){hooks++;throw Error('trap');}});
 expect(()=>read(fake,fake,fake)).toThrow();expect(()=>read(f.owner,{},f.options.defaultDispatchUserAdmission)).toThrow();expect(()=>read(f.owner,f.options.defaultDispatchSource,()=>{})).toThrow();expect(hooks).toBe(0);
 const original=read(f.owner,f.options.defaultDispatchSource,f.options.defaultDispatchUserAdmission);expect(original.scope).toEqual(f.scope);expect(Object.getPrototypeOf(original)).toBeNull();
 expect(original.assertLocal).toBeTypeOf('function');const spy=vi.spyOn(nativeFs,'lstatSync').mockImplementation(()=>{throw Error('no SDK in pure owner fence');});try{expect(()=>original.assertLocal()).not.toThrow();f.owner.seal();expect(()=>original.assertLocal()).toThrow();}finally{spy.mockRestore();}
});
it('original owner binding invokes the captured original capture and read rather than patched public methods',()=>{
 const read=(submissionModule as any).readOriginalDefaultDispatchOwner;expect(read).toBeTypeOf('function');const f=fixture(),binding=read(f.owner,f.options.defaultDispatchSource,f.options.defaultDispatchUserAdmission),observed=f.observe(),user=f.admit();
 vi.spyOn(MainUserSubmissionOwner.prototype,'captureDefaultDispatch').mockImplementation(()=>{throw Error('substituted capture');});vi.spyOn(MainUserSubmissionOwner.prototype,'readDefaultDispatchAction').mockImplementation(()=>{throw Error('substituted read');});
 const action=binding.capture(observed.frame,user.frame,f.actor),record=binding.read(action,f.actor);expect(record.projectId).toBe('p');expect(f.files()).toHaveLength(1);f.owner.seal();expect(()=>binding.read(action,f.actor)).toThrow();
});
it('original owner pure fence does not invoke an ambient Set size getter that revokes A',()=>{
 const read=(submissionModule as any).readOriginalDefaultDispatchOwner,f=fixture(),binding=read(f.owner,f.options.defaultDispatchSource,f.options.defaultDispatchUserAdmission),ownedSet=(f.owner as any).journalReadUnknown,previous=Object.getOwnPropertyDescriptor(Set.prototype,'size')!;let hooks=0;
 Object.defineProperty(Set.prototype,'size',{configurable:true,get(){if(this===ownedSet){hooks++;f.owner.seal();}return Reflect.apply(previous.get!,this,[]);}});
 try{binding.assertLocal();}finally{Object.defineProperty(Set.prototype,'size',previous);}expect(hooks).toBe(0);expect(()=>binding.assertLocal()).not.toThrow();
});
it('captures one canonical default user action across 100 calls, two owners and a journal reopen',()=>{
 const f=fixture(),a=f.observe(),second=new MainUserSubmissionOwner(f.options),values=[];
 for(let i=0;i<100;i++){const owner=i%2?second:f.owner,frame=owner.captureDefaultDispatch(a.frame,f.admit().frame,f.actor);values.push(owner.readDefaultDispatchAction(frame,f.actor));}
 expect(new Set(values.map(value=>value.actionId)).size).toBe(1);expect(f.files()).toHaveLength(1);
 const reopened=new MainUserSubmissionOwner(f.options),frame=reopened.captureDefaultDispatch(a.frame,f.admit().frame,f.actor);expect(reopened.readDefaultDispatchAction(frame,f.actor)).toEqual(values[0]);expect(f.files()).toHaveLength(1);
});
it('requires independent actual user admission even when an original B observation and user actor are available',()=>{
 const f=fixture(),a=f.observe();for(const user of [{},JSON.parse(JSON.stringify(f.admit().frame))])expect(()=>f.owner.captureDefaultDispatch(a.frame,user,f.actor)).toThrow('controlled_user_admission_revoked');expect(f.files()).toHaveLength(0);
});
it('keeps copied and foreign action frames separate from journal data and metadata observations',()=>{
 const f=fixture(),a=f.observe(),frame=f.owner.captureDefaultDispatch(a.frame,f.admit().frame,f.actor),value=f.owner.readDefaultDispatchAction(frame,f.actor),second=new MainUserSubmissionOwner(f.options);
 expect(()=>f.owner.readDefaultDispatchAction({...frame},f.actor)).toThrow();expect(()=>second.readDefaultDispatchAction(frame,f.actor)).toThrow();expect(()=>f.owner.readDefaultDispatchAction(value as never,f.actor)).toThrow();
 expect(f.owner.observeDefaultDispatchAction({projectId:'p',planRevision:3,dispatchGeneration:0},f.actor)).toEqual(value);expect(f.files()).toHaveLength(1);
});
it.each(['taskSetDigest','bindingDigest'] as const)('rejects changed same-canonical %s instead of creating a new generation',field=>{
 const f=fixture(),a=f.observe();f.owner.captureDefaultDispatch(a.frame,f.admit().frame,f.actor);const different=f.observe({...f.value,[field]:'e'.repeat(64)});expect(()=>f.owner.captureDefaultDispatch(different.frame,f.admit().frame,f.actor)).toThrow('default_dispatch_action_conflict');expect(f.files()).toHaveLength(1);
});
it('keeps the parent action distinct for a new observed plan while making no child-generation claim',()=>{
 const f=fixture(),a=f.observe(),first=f.owner.readDefaultDispatchAction(f.owner.captureDefaultDispatch(a.frame,f.admit().frame,f.actor),f.actor),next=f.observe({...f.value,planRevision:4});const second=f.owner.readDefaultDispatchAction(f.owner.captureDefaultDispatch(next.frame,f.admit().frame,f.actor),f.actor);expect(second.actionId).not.toBe(first.actionId);expect(f.files()).toHaveLength(2);
});
it('denies unconfigured ports and non-user actors before touching untrusted input',()=>{
 const f=fixture(),owner=new MainUserSubmissionOwner({dataRoot:f.options.dataRoot,...f.scope});let calls=0;const hostile=new Proxy({},{get(){calls++;throw Error('must_not_run');}});
 for(const actor of [undefined,{...f.actor,requestSource:'agent'},{...f.actor,requestSource:'scheduler'},{...f.actor,actorId:'other'}])expect(()=>f.owner.captureDefaultDispatch(hostile,hostile,actor as never)).toThrow('user_submission_actor_forbidden');expect(calls).toBe(0);
 expect(()=>owner.captureDefaultDispatch(f.observe().frame,f.admit().frame,f.actor)).toThrow('default_dispatch_source_unavailable');expect(f.files()).toHaveLength(0);
});
it.each(['source','user'] as const)('rechecks current %s before exporting an original action',kind=>{
 const f=fixture(),a=f.observe(),user=f.admit(),frame=f.owner.captureDefaultDispatch(a.frame,user.frame,f.actor);if(kind==='source')a.revoke();else user.revoke();expect(()=>f.owner.readDefaultDispatchAction(frame,f.actor)).toThrow();
});
it('does not let the history metadata path create a user action',()=>{
 const f=fixture();expect(f.owner.observeDefaultDispatchAction({projectId:'p',planRevision:3,dispatchGeneration:0},f.actor)).toBeUndefined();expect(f.files()).toHaveLength(0);
});
it('retains a committed journal prefix but refuses the action when user admission is revoked by the final write seam',()=>{
 const f=fixture(),a=f.observe(),user=f.admit(),write=atomic.writeFileAtomicallySync;vi.spyOn(atomic,'writeFileAtomicallySync').mockImplementation((...args)=>{write(...args);user.revoke();});
 expect(()=>f.owner.captureDefaultDispatch(a.frame,user.frame,f.actor)).toThrow('controlled_user_admission_revoked');expect(f.files()).toHaveLength(1);const stored=JSON.parse(readFileSync(join(f.directory,f.files()[0]!),'utf8'));vi.restoreAllMocks();
 const reopened=new MainUserSubmissionOwner(f.options),frame=reopened.captureDefaultDispatch(a.frame,f.admit().frame,f.actor);expect(reopened.readDefaultDispatchAction(frame,f.actor).actionId).toBe(stored.actionId);
});
it('preserves an atomic journal error and makes the original owner sticky without inventing another key',()=>{
 const f=fixture(),a=f.observe(),cause=Error('actual_atomic_dispatch_write_failure');vi.spyOn(atomic,'writeFileAtomicallySync').mockImplementation(()=>{throw cause;});expect(()=>f.owner.captureDefaultDispatch(a.frame,f.admit().frame,f.actor)).toThrow(cause);expect(()=>f.owner.captureDefaultDispatch(a.frame,f.admit().frame,f.actor)).toThrow('user_submission_write_unconfirmed');expect(f.files()).toHaveLength(0);
});
it('keeps the original capture scope and fixed ports when the constructor options object is later replaced',()=>{
 const f=fixture(),a=f.observe();f.options.profileId='e'.repeat(64);f.options.workspaceId='f'.repeat(64);f.options.defaultDispatchSource={resolve(){throw Error('replaced_port_must_not_run');}};f.options.defaultDispatchUserAdmission=()=>{throw Error('replaced_user_port_must_not_run');};
 const action=f.owner.captureDefaultDispatch(a.frame,f.admit().frame,f.actor);expect(f.owner.readDefaultDispatchAction(action,f.actor).scope).toEqual(f.scope);
});
it('rejects sealed fresh capture and export without turning historical metadata into a fresh capability',()=>{
 const f=fixture(),a=f.observe(),frame=f.owner.captureDefaultDispatch(a.frame,f.admit().frame,f.actor);f.owner.seal();expect(()=>f.owner.captureDefaultDispatch(a.frame,f.admit().frame,f.actor)).toThrow('default_dispatch_action_closed');expect(()=>f.owner.readDefaultDispatchAction(frame,f.actor)).toThrow('default_dispatch_action_closed');
});
it('rejects source accessors and async current guards without invoking data getters or writing facts',()=>{
 const f=fixture(),a=f.observe();let calls=0;f.observations.set(a.frame,Object.defineProperty({assertCurrent(){}},'data',{enumerable:true,get(){calls++;return f.value;}}) as never);expect(()=>f.owner.captureDefaultDispatch(a.frame,f.admit().frame,f.actor)).toThrow('default_dispatch_source_unverified');expect(calls).toBe(0);
 const other=f.observe();f.observations.get(other.frame)!.assertCurrent=async()=>{};expect(()=>f.owner.captureDefaultDispatch(other.frame,f.admit().frame,f.actor)).toThrow();expect(f.files()).toHaveLength(0);
});

it('rejects a copied source observation, wrong scope and extra fields before any fact is written',()=>{
 const f=fixture(),a=f.observe();expect(()=>f.owner.captureDefaultDispatch({...a.frame},f.admit().frame,f.actor)).toThrow('controlled_observation_foreign');for(const data of [{...f.value,scope:{...f.scope,workspaceId:'e'.repeat(64)}},{...f.value,extra:true}])expect(()=>f.owner.captureDefaultDispatch(f.observe(data).frame,f.admit().frame,f.actor)).toThrow();expect(f.files()).toHaveLength(0);
});
it('refuses an async independent user verifier before writing a default action',()=>{
 const f=fixture(),owner=new MainUserSubmissionOwner({...f.options,defaultDispatchUserAdmission:async()=>{}});expect(()=>owner.captureDefaultDispatch(f.observe().frame,f.admit().frame,f.actor)).toThrow();expect(f.files()).toHaveLength(0);
});
it.each(['payload','duplicate','hardlink'] as const)('does not remint or export a corrupt %s journal record',kind=>{
 const f=fixture(),a=f.observe(),frame=f.owner.captureDefaultDispatch(a.frame,f.admit().frame,f.actor),file=join(f.directory,f.files()[0]!),text=readFileSync(file,'utf8');
 if(kind==='payload'){const record=JSON.parse(text);record.taskSetDigest='e'.repeat(64);writeFileSync(file,JSON.stringify(record));}
 else if(kind==='duplicate')writeFileSync(file,text.replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1'));
 else linkSync(file,join(f.directory,'own-hardlink-fixture'));
 expect(()=>f.owner.readDefaultDispatchAction(frame,f.actor)).toThrow('default_dispatch_record_invalid');expect(()=>f.owner.captureDefaultDispatch(a.frame,f.admit().frame,f.actor)).toThrow('default_dispatch_record_invalid');expect(f.files()).toHaveLength(1);
});
it('rejects actual actor mutation by the final independent user verifier while retaining the committed fact',()=>{
 const f=fixture();let total=0;const probe=new MainUserSubmissionOwner({...f.options,defaultDispatchUserAdmission(frame,actor){f.options.defaultDispatchUserAdmission(frame,actor);total++;}});
 probe.captureDefaultDispatch(f.observe({...f.value,projectId:'probe'}).frame,f.admit('probe').frame,f.actor);
 let calls=0;const actor={...f.actor} as {requestSource:'user'|'agent'|'scheduler';actorId:string},owner=new MainUserSubmissionOwner({...f.options,defaultDispatchUserAdmission(frame,current){f.options.defaultDispatchUserAdmission(frame,current);if(++calls===total)current.requestSource='agent';}});
 expect(()=>owner.captureDefaultDispatch(f.observe().frame,f.admit().frame,actor)).toThrow('user_submission_actor_forbidden');expect(f.files()).toHaveLength(2);
});
it('rejects an actual actor changed by the last user verifier during opaque action export',()=>{
 const f=fixture(),actor={...f.actor} as {requestSource:'user'|'agent'|'scheduler';actorId:string};let calls=0,mutateAt=Infinity;
 const owner=new MainUserSubmissionOwner({...f.options,defaultDispatchUserAdmission(frame,current){f.options.defaultDispatchUserAdmission(frame,current);if(++calls===mutateAt)current.requestSource='agent';}}),action=owner.captureDefaultDispatch(f.observe().frame,f.admit().frame,actor);
 calls=0;owner.readDefaultDispatchAction(action,actor);mutateAt=calls;calls=0;expect(()=>owner.readDefaultDispatchAction(action,actor)).toThrow('user_submission_actor_forbidden');
});

it.each(['replace','grow','hardlink'] as const)('rejects an actual record %s between original lstat and read',kind=>{
 const f=fixture(),a=f.observe(),frame=f.owner.captureDefaultDispatch(a.frame,f.admit().frame,f.actor),file=join(f.directory,f.files()[0]!),text=readFileSync(file,'utf8'),stat=nativeFs.lstatSync;let swapped=false;
 vi.spyOn(nativeFs,'lstatSync').mockImplementation(((path:Parameters<typeof stat>[0],...args:unknown[])=>{const result=Reflect.apply(stat,nativeFs,[path,...args]);if(String(path)===file&&!swapped){swapped=true;if(kind==='replace'){renameSync(file,join(f.directory,'own-prior-record'));writeFileSync(file,text,{mode:0o600});}else if(kind==='grow')appendFileSync(file,' '.repeat(16385));else linkSync(file,join(f.directory,'own-racing-hardlink'));}return result;}) as typeof stat);
 expect(()=>f.owner.readDefaultDispatchAction(frame,f.actor)).toThrow('default_dispatch_record_invalid');expect(swapped).toBe(true);
});

it.each(['replace','grow','hardlink'] as const)('closes the same %s race at the sibling original Task reader',async kind=>{
 const f=fixture(),wire={action:'submit_new' as const,gestureId:randomUUID(),input:{kind:'materials' as const,prompt:'original task',materials:[],context:{threadId:'thread'}}};await f.owner.submit(wire,f.actor,async()=>({taskId:'original-task'}));
 const file=join(f.directory,f.files()[0]!),text=readFileSync(file,'utf8'),stat=nativeFs.lstatSync;let swapped=false;
 vi.spyOn(nativeFs,'lstatSync').mockImplementation(((path:Parameters<typeof stat>[0],...args:unknown[])=>{const result=Reflect.apply(stat,nativeFs,[path,...args]);if(String(path)===file&&!swapped){swapped=true;if(kind==='replace'){renameSync(file,join(f.directory,'own-prior-task'));writeFileSync(file,text,{mode:0o600});}else if(kind==='grow')appendFileSync(file,' '.repeat(16385));else linkSync(file,join(f.directory,'own-task-hardlink'));}return result;}) as typeof stat);
 await expect(f.owner.submit(wire,f.actor,async()=>{throw Error('second_task_must_not_start');})).rejects.toThrow('user_submission_record_invalid');expect(swapped).toBe(true);
});

it.each([false,true])('retains an unknown read descriptor and original errors without a second close (read failure=%s)',async readFailed=>{
 const f=fixture(),a=f.observe(),frame=f.owner.captureDefaultDispatch(a.frame,f.admit().frame,f.actor),readCause=Error('original_read_failure'),closeCause=Error('original_close_failure'),close=nativeFs.closeSync;let closes=0;
 if(readFailed)vi.spyOn(nativeFs,'readSync').mockImplementation(()=>{throw readCause;});
 vi.spyOn(nativeFs,'closeSync').mockImplementation(fd=>{closes++;close(fd);throw closeCause;});
 let failure:unknown;try{f.owner.readDefaultDispatchAction(frame,f.actor);}catch(error){failure=error;}
 expect(failure).toBeInstanceOf(Error);expect((failure as Error).cause).toBe(readFailed?readCause:closeCause);if(readFailed)expect((failure as AggregateError).errors).toEqual([readCause,closeCause]);
 expect((f.owner as unknown as{journalReadUnknown:Set<{fd:number;phase:string}>}).journalReadUnknown.size).toBe(1);expect(()=>f.owner.captureDefaultDispatch(a.frame,f.admit().frame,f.actor)).toThrow('user_submission_write_unconfirmed');await expect(f.owner.drainRoomConversionObservations()).rejects.toThrow('user_submission_read_close_unconfirmed');expect(closes).toBe(1);
});
it.skipIf(process.platform==='win32'||process.getuid?.()===0)('does not treat a real POSIX directory lookup denial as a missing default action',()=>{
 const f=fixture();f.owner.captureDefaultDispatch(f.observe().frame,f.admit().frame,f.actor);chmodSync(f.directory,0);
 try{expect(()=>f.owner.observeDefaultDispatchAction({projectId:'p',planRevision:3,dispatchGeneration:0},f.actor)).toThrow('default_dispatch_record_invalid');}finally{chmodSync(f.directory,0o700);}
});

it.each([['other','dispatch_current_plan'],['p','different_action']])('does not capture B observation with an admission for %s / %s', (projectId,action)=>{
 const f=fixture();expect(()=>f.owner.captureDefaultDispatch(f.observe().frame,f.admit(projectId,action).frame,f.actor)).toThrow('controlled_user_admission_revoked');expect(f.files()).toHaveLength(0);
});
it('rejects a leaf path replaced after its original fd bytes have already been read',()=>{
 const f=fixture(),frame=f.owner.captureDefaultDispatch(f.observe().frame,f.admit().frame,f.actor),file=join(f.directory,f.files()[0]!),text=readFileSync(file,'utf8'),read=nativeFs.readSync;let swapped=false;
 vi.spyOn(nativeFs,'readSync').mockImplementation(((...args:unknown[])=>{const count=Reflect.apply(read,nativeFs,args);if(count>0&&!swapped){swapped=true;renameSync(file,join(f.directory,'own-read-prior'));writeFileSync(file,text,{mode:0o600});}return count;}) as typeof read);
 expect(()=>f.owner.readDefaultDispatchAction(frame,f.actor)).toThrow('default_dispatch_record_invalid');expect(swapped).toBe(true);
});
it('captures the original observation bytes before a later current callback mutates the source record data',()=>{
 const f=fixture(),a=f.observe(),record=f.observations.get(a.frame)!;record.assertCurrent=()=>{(record.data as typeof f.value).taskSetDigest='e'.repeat(64);};const frame=f.owner.captureDefaultDispatch(a.frame,f.admit().frame,f.actor);expect(f.owner.readDefaultDispatchAction(frame,f.actor).taskSetDigest).toBe('d'.repeat(64));
});
