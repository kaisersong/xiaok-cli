// @vitest-environment node
// Unit boundary: private source-reader doubles below attest metadata only.
// These do not qualify broker/native/IPC/floor or enable any business dispatch.
import {afterEach,expect,it,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,readdirSync,readFileSync,rmSync,writeFileSync,promises as fsPromises} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,join} from 'node:path';
import {MainUserSubmissionOwner,resolvePreparedSubmissionProof,resolveRoomConversionSourceProof,type RoomConversionSourceProof,type PreparedSubmissionProof,type SubmissionActor} from '../../electron/main-user-submission.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import {createTaskSourceWriterPopulation} from '../../../src/runtime/task-host/task-runtime-host.js';
import * as atomicFile from '../../../src/utils/atomic-file.js';
type Identity={captureId:string;sourceFamily:'main_room_conversion_v1';canonicalMessageId:string;canonicalUserTaskId:string;envelopeHash:string};
type Capture={identity:Identity;sourceProof:RoomConversionSourceProof};
type CaptureOwner=MainUserSubmissionOwner&{
 captureRoomConversion(raw:unknown,actor:SubmissionActor|undefined,proof:object):Capture;
 observeRoomConversion(captureId:string,actor:SubmissionActor|undefined):Identity;
};
const roots:string[]=[];afterEach(()=>{for(const path of roots.splice(0))rmSync(path,{recursive:true,force:true});});
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
function fixture(){
 const dataRoot=mkdtempSync(join(tmpdir(),'room-user-capture-'));roots.push(dataRoot);
 const entries=new WeakMap<object,{owner:MainUserSubmissionOwner;fact:unknown;assertCurrent:()=>void}>();
 const options={dataRoot,profileId:'profile',workspaceId:'workspace',roomConversionSources:{brokerOriginDigest:hash('trusted-broker-lineage'),verify(proof:object,owner:MainUserSubmissionOwner){const entry=entries.get(proof);if(!entry||entry.owner!==owner)throw Error('room_conversion_source_unverified');entry.assertCurrent();return entry;}}};
 const owner=new MainUserSubmissionOwner(options) as CaptureOwner,actor={requestSource:'user' as const,actorId:'desktop-user:profile'};
 const wire={action:'add_task',roomId:'room',messageId:'broker-message',projectId:'project',expectedProjectRevision:3,title:'Independent report',brief:'Keep the existing report unchanged'};
 let revoked=false;
 const proof=(target:CaptureOwner=owner,input:unknown=wire,changes:Record<string,unknown>={})=>{
  const token=Object.freeze({});entries.set(token,{owner:target,assertCurrent:()=>{if(revoked)throw Error('room_conversion_source_revoked');},fact:{profileId:options.profileId,workspaceId:options.workspaceId,actorId:actor.actorId,brokerUserId:'user.local',brokerOriginDigest:hash('trusted-broker-lineage'),intent:structuredClone(input),
   source:{roomId:'room',messageId:'broker-message',messageSequence:9,text:'Original room message body',roomRevision:4,membershipRevision:2},
   project:{projectId:'project',primaryRoomId:'room',bindingDigest:hash('original-protected-binding'),classification:'ordinary',projectRevision:3},...changes}});return token;
 };
 return {dataRoot,options,owner,actor,wire,proof,revoke(){revoked=true;}};
}
it('default conversion captures one canonical user fact across 100 independent private source proofs and owner reopen, with no Host task',()=>{
 const f=fixture(),values=Array.from({length:100},()=>f.owner.captureRoomConversion(f.wire,f.actor,f.proof()));
 expect(new Set(values.map(value=>value.identity.captureId)).size).toBe(1);
 const first=values[0].identity;expect(first.sourceFamily).toBe('main_room_conversion_v1');expect(first.canonicalMessageId).toMatch(/^main-user-message:[a-f0-9]{64}$/);expect(first.canonicalUserTaskId).toMatch(/^main-user-task:[a-f0-9]{64}$/);
 expect(JSON.stringify(first)).not.toContain('Original room message body');expect(first).not.toHaveProperty('taskId');expect(first).not.toHaveProperty('sessionId');
 const reopened=new MainUserSubmissionOwner(f.options) as CaptureOwner;
 expect(reopened.captureRoomConversion(f.wire,f.actor,f.proof(reopened)).identity).toEqual(first);
 expect(reopened.observeRoomConversion(first.captureId,f.actor)).toEqual(first);
 expect(readdirSync(join(f.dataRoot,'conversation-projects','user-submissions')).filter(name=>name.endsWith('.json'))).toHaveLength(1);
});
it.each([{projectId:'other-project'},{action:'add_revision',logicalArtifactId:'artifact',expectedArtifactRevision:1,expectedReservationRevision:1},{brief:'different explicit body'},{expectedProjectRevision:4}])('same original Room source cannot mint another canonical fact after changing its frozen envelope: %j',change=>{
 const f=fixture(),original=f.owner.captureRoomConversion(f.wire,f.actor,f.proof()),wire={...f.wire,...change};
 if(wire.action==='add_revision'){Reflect.deleteProperty(wire,'title');Reflect.deleteProperty(wire,'brief');}
 const project={projectId:wire.projectId,primaryRoomId:'room',bindingDigest:wire.projectId==='project'?hash('original-protected-binding'):hash('binding:'+wire.projectId),classification:'ordinary',projectRevision:wire.expectedProjectRevision};
 expect(()=>f.owner.captureRoomConversion(wire,f.actor,f.proof(f.owner,wire,{project}))).toThrow('room_conversion_conflict');
 expect(f.owner.observeRoomConversion(original.identity.captureId,f.actor)).toEqual(original.identity);
});
it('different original messages with identical text remain distinct user facts',()=>{
 const f=fixture(),first=f.owner.captureRoomConversion(f.wire,f.actor,f.proof());
 const wire={...f.wire,messageId:'another-broker-message'};
 const source={roomId:'room',messageId:wire.messageId,messageSequence:10,text:'Original room message body',roomRevision:5,membershipRevision:2};
 const second=f.owner.captureRoomConversion(wire,f.actor,f.proof(f.owner,wire,{source}));expect(second.identity.canonicalMessageId).not.toBe(first.identity.canonicalMessageId);
});
it('actor and private source authority are checked before hostile wire properties; copied proofs have no authority',()=>{
 const f=fixture();let reads=0;const wire={get action(){reads++;throw Error('wire getter');}};
 for(const actor of [undefined,{requestSource:'agent',actorId:f.actor.actorId},{requestSource:'scheduler',actorId:f.actor.actorId},{requestSource:'user',actorId:'desktop-user:other'}])expect(()=>f.owner.captureRoomConversion(wire,actor as never,f.proof())).toThrow('user_submission_actor_forbidden');
 expect(()=>f.owner.captureRoomConversion(wire,f.actor,{...f.proof()})).toThrow('room_conversion_source_unverified');expect(reads).toBe(0);
});
it('stale expected version and mismatched primary Room are refused before burning the default origin key',()=>{
 const f=fixture();
 for(const [change,code] of [[{projectRevision:4},'room_conversion_project_revision_conflict'],[{primaryRoomId:'other-room'},'room_conversion_room_scope_mismatch']] as const)expect(()=>f.owner.captureRoomConversion(f.wire,f.actor,f.proof(f.owner,f.wire,{project:{projectId:'project',primaryRoomId:'room',bindingDigest:hash('original-protected-binding'),classification:'ordinary',projectRevision:3,...change}}))).toThrow(code);
 expect(readdirSync(join(f.dataRoot,'conversation-projects','user-submissions'))).toEqual([]);
 expect(f.owner.captureRoomConversion(f.wire,f.actor,f.proof()).identity.captureId).toBeTruthy();
});
it('a captured old expected version can still observe its same immutable capture without silently filling a newer version',()=>{
 const f=fixture(),first=f.owner.captureRoomConversion(f.wire,f.actor,f.proof());
 const project={projectId:'project',primaryRoomId:'room',bindingDigest:hash('original-protected-binding'),classification:'ordinary',projectRevision:4};
 const replay=f.owner.captureRoomConversion(f.wire,f.actor,f.proof(f.owner,f.wire,{project}));expect(replay.identity).toEqual(first.identity);
});
it('unknown or managed provenance, revoked native source, and a foreign owner cannot mint a conversion',()=>{
 const f=fixture();
 for(const classification of ['unknown','managed'])expect(()=>f.owner.captureRoomConversion(f.wire,f.actor,f.proof(f.owner,f.wire,{project:{projectId:'project',primaryRoomId:'room',bindingDigest:hash('binding'),classification,projectRevision:3}}))).toThrow('room_conversion_provenance_forbidden');
 const other=new MainUserSubmissionOwner(f.options) as CaptureOwner;
 expect(()=>other.captureRoomConversion(f.wire,f.actor,f.proof())).toThrow('room_conversion_source_unverified');
 f.revoke();expect(()=>f.owner.captureRoomConversion(f.wire,f.actor,f.proof())).toThrow('room_conversion_source_revoked');
 expect(readdirSync(join(f.dataRoot,'conversation-projects','user-submissions'))).toEqual([]);
});
it('native source intent is immutable and cannot be relabelled or extended with self-issued identities',()=>{
 const f=fixture();
 expect(()=>f.owner.captureRoomConversion({...f.wire,title:'replaced'},f.actor,f.proof())).toThrow('room_conversion_source_mismatch');
 for(const extra of [{canonicalMessageId:'forged'},{planRunId:randomUUID()},{requestSource:'user'}])expect(()=>f.owner.captureRoomConversion({...f.wire,...extra},f.actor,f.proof())).toThrow('room_conversion_input_invalid');
 expect(readdirSync(join(f.dataRoot,'conversation-projects','user-submissions'))).toEqual([]);
});
it('output source proof requires its exact owner, stays private, and stops at source revoke or owner seal',()=>{
 const f=fixture(),capture=f.owner.captureRoomConversion(f.wire,f.actor,f.proof());
 expect(resolveRoomConversionSourceProof(capture.sourceProof,f.owner)).toMatchObject({identity:capture.identity,payload:{input:f.wire,body:'Original room message body'}});
 const other=new MainUserSubmissionOwner(f.options);
 expect(()=>resolveRoomConversionSourceProof(capture.sourceProof,other)).toThrow('room_conversion_source_unverified');
 expect(()=>resolveRoomConversionSourceProof({...capture.sourceProof} as RoomConversionSourceProof,f.owner)).toThrow('room_conversion_source_unverified');
 f.revoke();expect(()=>resolveRoomConversionSourceProof(capture.sourceProof,f.owner)).toThrow('room_conversion_source_revoked');
 const g=fixture(),second=g.owner.captureRoomConversion(g.wire,g.actor,g.proof());g.owner.seal();
 expect(()=>resolveRoomConversionSourceProof(second.sourceProof,g.owner)).toThrow('room_conversion_closed');
 expect(g.owner.observeRoomConversion(second.identity.captureId,g.actor)).toEqual(second.identity);
});
it('a missing retained payload preserves the original origin tombstone and cannot regenerate a source proof or canonical ID',()=>{
 const f=fixture(),capture=f.owner.captureRoomConversion(f.wire,f.actor,f.proof()),directory=join(f.dataRoot,'conversation-projects','user-submissions');
 const path=join(directory,readdirSync(directory).find(name=>name.startsWith('room-')&&name.endsWith('.json'))!);
 const record=JSON.parse(readFileSync(path,'utf8'));delete record.payload;record.revision++;writeFileSync(path,JSON.stringify(record));
 expect(f.owner.observeRoomConversion(capture.identity.captureId,f.actor)).toEqual(capture.identity);
 expect(()=>resolveRoomConversionSourceProof(capture.sourceProof,f.owner)).toThrow('room_conversion_source_changed');
 const before=readFileSync(path,'utf8');expect(()=>f.owner.captureRoomConversion(f.wire,f.actor,f.proof())).toThrow('room_conversion_payload_unavailable');expect(readFileSync(path,'utf8')).toBe(before);
});
it('the verifier reference and broker namespace are fixed at construction; unregistered async authority cannot write a fact',()=>{
 const f=fixture();f.options.roomConversionSources.verify=()=>{throw Error('mutated constructor option');};
 expect(f.owner.captureRoomConversion(f.wire,f.actor,f.proof()).identity.captureId).toBeTruthy();
 const g=fixture();expect(()=>g.owner.captureRoomConversion(g.wire,g.actor,g.proof(g.owner,g.wire,{brokerOriginDigest:hash('other-broker')}))).toThrow('room_conversion_source_mismatch');
 const bad=new MainUserSubmissionOwner({...g.options,roomConversionSources:{...g.options.roomConversionSources,verify:()=>Promise.resolve({})}} as unknown as ConstructorParameters<typeof MainUserSubmissionOwner>[0]);
 expect(()=>bad.captureRoomConversion(g.wire,g.actor,{})).toThrow('room_conversion_source_unverified');
 expect(readdirSync(join(g.dataRoot,'conversation-projects','user-submissions'))).toEqual([]);
});
it('Room validation failures preserve actual Native prepared history; a real Room write failure latches future authority while keeping that history readable',async()=>{
 const f=fixture(),store=new FileTaskSnapshotStore(join(f.dataRoot,'tasks')),population=createTaskSourceWriterPopulation(store),materials=new MaterialRegistry({workspaceRoot:join(f.dataRoot,'workspace'),maxBytes:1024});
 const runner=vi.fn(async()=>{throw Error('must stay prepared');}),host=population.createHost({materialRegistry:materials,runner});let preparedProof:PreparedSubmissionProof|undefined;
 try{
  const native=await f.owner.submit({action:'submit_new',gestureId:randomUUID(),input:{kind:'materials',prompt:'Original Native request',materials:[],context:{threadId:'native-thread'}}},f.actor,async input=>{
   f.owner.beginEffects();const task=await host.prepareTask(input),snapshot=(await host.inspectTask(task.taskId))!;
   f.owner.recordPreparedTask(snapshot,host.getPreparedSourceReceipt(task.taskId));preparedProof=f.owner.currentPreparedSourceProof();return task;
  });
  const before=f.owner.observePreparedBinding(native.submissionId);
  expect(()=>f.owner.captureRoomConversion(f.wire,f.actor,{})).toThrow('room_conversion_source_unverified');
  expect(resolvePreparedSubmissionProof(preparedProof!)).toMatchObject({submissionId:native.submissionId});
  const actual=atomicFile.writeFileAtomicallySync,failure=Error('actual_room_capture_write_failed');
  const writer=vi.spyOn(atomicFile,'writeFileAtomicallySync').mockImplementation((path,...args)=>{if(basename(path).startsWith('room-'))throw failure;return actual(path,...args);});
  try{expect(()=>f.owner.captureRoomConversion(f.wire,f.actor,f.proof())).toThrow(failure);}finally{writer.mockRestore();}
  expect(f.owner.observePreparedBinding(native.submissionId)).toEqual(before);
  expect(()=>resolvePreparedSubmissionProof(preparedProof!)).toThrow('user_submission_write_unconfirmed');
  expect(()=>f.owner.captureRoomConversion(f.wire,f.actor,f.proof())).toThrow('user_submission_write_unconfirmed');
  expect((await host.inspectTask(native.taskId))?.status).toBe('understanding');expect(runner).not.toHaveBeenCalled();
 }finally{await population.close();await materials.sealAndDrainInstanceMutations();}
});
it('does not enter an async verifier/current callback, and observes rejected native Promise results without granting a capture',async()=>{
 const f=fixture();let calls=0;
 const authorities=[
  {brokerOriginDigest:hash('trusted-broker-lineage'),async verify(){calls++;return {fact:{},assertCurrent(){}};}},
  {brokerOriginDigest:hash('trusted-broker-lineage'),verify(){return Promise.reject(Error('invalid_async_verify'));}},
  {brokerOriginDigest:hash('trusted-broker-lineage'),verify(){return {fact:{},async assertCurrent(){calls++;}};}},
  {brokerOriginDigest:hash('trusted-broker-lineage'),verify(){return {fact:{},assertCurrent(){return Promise.reject(Error('invalid_async_current'));}};}},
 ];
 for(const roomConversionSources of authorities){
  const owner=new MainUserSubmissionOwner({...f.options,roomConversionSources} as unknown as ConstructorParameters<typeof MainUserSubmissionOwner>[0]);
  expect(()=>owner.captureRoomConversion(f.wire,f.actor,{})).toThrow('room_conversion_source_unverified');
 }
 await new Promise<void>(resolve=>setImmediate(resolve));expect(calls).toBe(0);
 expect(readdirSync(join(f.dataRoot,'conversation-projects','user-submissions'))).toEqual([]);
});
it('the actual default Main owner has no Room source issuer, and authority validation never assimilates an ordinary then getter',()=>{
 const f=fixture(),unqualified=new MainUserSubmissionOwner({dataRoot:f.dataRoot,profileId:f.options.profileId,workspaceId:f.options.workspaceId});let reads=0;
 const raw={get action(){reads++;throw Error('wire getter');}};
 expect(()=>unqualified.captureRoomConversion(raw,f.actor,{})).toThrow('room_conversion_unavailable');
 const source={brokerOriginDigest:hash('trusted-broker-lineage'),verify(){return {fact:{},assertCurrent(){return {get then(){reads++;throw Error('then getter');}};}};}};
 const malformed=new MainUserSubmissionOwner({...f.options,roomConversionSources:source} as unknown as ConstructorParameters<typeof MainUserSubmissionOwner>[0]);
 expect(()=>malformed.captureRoomConversion(raw,f.actor,{})).toThrow('room_conversion_source_unverified');expect(reads).toBe(0);
});
it('corrupt Room payload is a per-record refusal and does not clear or manufacture unrelated Native facts',async()=>{
 const f=fixture(),capture=f.owner.captureRoomConversion(f.wire,f.actor,f.proof()),directory=join(f.dataRoot,'conversation-projects','user-submissions');
 const path=join(directory,readdirSync(directory).find(name=>name.startsWith('room-')&&name.endsWith('.json'))!);
 const record=JSON.parse(readFileSync(path,'utf8'));record.payload.body='different source bytes';writeFileSync(path,JSON.stringify(record));
 expect(()=>f.owner.observeRoomConversion(capture.identity.captureId,f.actor)).toThrow('room_conversion_record_invalid');
 expect(()=>f.owner.captureRoomConversion(f.wire,f.actor,f.proof())).toThrow('room_conversion_record_invalid');
 await expect(f.owner.submit({action:'submit_new',gestureId:randomUUID(),input:{kind:'materials',prompt:'Separate Native metadata input',materials:[]}},f.actor,async()=>({taskId:'existing-native-producer-result'}))).resolves.toMatchObject({taskId:'existing-native-producer-result'});
 expect(readFileSync(path,'utf8')).toBe(JSON.stringify(record));
});

it('late Main-only issuer binding is one-way, invalid config does not consume the binding, and seal prevents late binding',()=>{
 const f=fixture(),late=new MainUserSubmissionOwner({dataRoot:f.dataRoot,profileId:f.options.profileId,workspaceId:f.options.workspaceId}) as CaptureOwner;
 expect(()=>late.bindRoomConversionSources({brokerOriginDigest:'invalid',verify(){throw Error('unused');}})).toThrow('room_conversion_source_unverified');
 late.bindRoomConversionSources(f.options.roomConversionSources);expect(late.captureRoomConversion(f.wire,f.actor,f.proof(late)).identity.captureId).toBeTruthy();
 expect(()=>late.bindRoomConversionSources(f.options.roomConversionSources)).toThrow('room_conversion_source_owner_conflict');
 expect(()=>f.owner.bindRoomConversionSources(f.options.roomConversionSources)).toThrow('room_conversion_source_owner_conflict');
 const sealed=new MainUserSubmissionOwner({dataRoot:f.dataRoot,profileId:f.options.profileId,workspaceId:f.options.workspaceId});sealed.seal();expect(()=>sealed.bindRoomConversionSources(f.options.roomConversionSources)).toThrow('room_conversion_closed');
});
it('original history observation yields Main while validating a real retained-body corpus',async()=>{
 const f=fixture(),body='x'.repeat(65536);
 for(let index=0;index<80;index++){
  const input={...f.wire,messageId:'history-'+index};
  f.owner.captureRoomConversion(input,f.actor,f.proof(f.owner,input,{source:{roomId:'room',messageId:input.messageId,messageSequence:index+1,text:body,roomRevision:4,membershipRevision:2}}));
 }
 let ticks=0;const timer=setInterval(()=>{ticks++;},0);
 try{
  const owner=f.owner as unknown as {observeRoomConversionIntent(raw:unknown,actor:SubmissionActor,signal:AbortSignal,recheck:()=>void):Promise<unknown>};
  expect(await owner.observeRoomConversionIntent({...f.wire,messageId:'missing'},f.actor,new AbortController().signal,()=>{})).toBeUndefined();
  expect(ticks).toBeGreaterThan(0);
 }finally{clearInterval(timer);}
},20000);
it('entry budget exhaustion is unknown rather than a miss, and direct historical identity still works',async()=>{
 const f=fixture(),first=f.owner.captureRoomConversion(f.wire,f.actor,f.proof()),directory=join(f.dataRoot,'conversation-projects','user-submissions');
 for(let index=0;index<8193;index++)writeFileSync(join(directory,'native-history-'+index+'.json'),'{}');
 const owner=f.owner as unknown as {observeRoomConversionIntent(raw:unknown,actor:SubmissionActor,signal:AbortSignal,recheck:()=>void):Promise<unknown>};
 await expect(Promise.resolve(owner.observeRoomConversionIntent({...f.wire,messageId:'missing'},f.actor,new AbortController().signal,()=>{}))).rejects.toThrow('room_conversion_observation_unavailable');
 expect(f.owner.observeRoomConversion(first.identity.captureId,f.actor)).toEqual(first.identity);
},20000);

it('byte budget exhaustion cannot turn a retained origin into an absent fact',async()=>{
 const f=fixture(),brief='\0'.repeat(60000);
 for(let index=0;index<190;index++){
  const input={...f.wire,messageId:'byte-history-'+index,brief};
  f.owner.captureRoomConversion(input,f.actor,f.proof(f.owner,input,{source:{roomId:'room',messageId:input.messageId,messageSequence:index+1,text:'body',roomRevision:4,membershipRevision:2}}));
 }
 await expect(f.owner.observeRoomConversionIntent({...f.wire,messageId:'missing'},f.actor,new AbortController().signal,()=>{})).rejects.toThrow('room_conversion_observation_unavailable');
},20000);
it('the actual directory-close tail is awaited by original observation drain, including seal during close',async()=>{
 const f=fixture(),original=fsPromises.opendir.bind(fsPromises);let enter!:()=>void,release!:()=>void;
 const entered=new Promise<void>(done=>{enter=done;}),barrier=new Promise<void>(done=>{release=done;});
 const opener=vi.spyOn(fsPromises,'opendir').mockImplementation(async(...args)=>{const directory=await original(...args);const close=directory.close.bind(directory);vi.spyOn(directory,'close').mockImplementation(async()=>{enter();await barrier;return close();});return directory;});
 const observation=f.owner.observeRoomConversionIntent(f.wire,f.actor,new AbortController().signal,()=>{});const observed=observation.catch(error=>error);
 try{await entered;f.owner.seal();let settled=false;const drain=f.owner.drainRoomConversionObservations().then(()=>{settled=true;});await new Promise<void>(done=>setImmediate(done));expect(settled).toBe(false);
  release();expect(String(await observed)).toContain('room_conversion_closed');await drain;expect(settled).toBe(true);
 }finally{release();await observed;opener.mockRestore();}
});
it('directory-close failure remains latched rather than a successful physical drain',async()=>{
 const f=fixture(),original=fsPromises.opendir.bind(fsPromises),failure=Error('actual_close_report_unknown');
 const opener=vi.spyOn(fsPromises,'opendir').mockImplementation(async(...args)=>{const directory=await original(...args);const close=directory.close.bind(directory);vi.spyOn(directory,'close').mockImplementation(async()=>{await close();throw failure;});return directory;});
 try{await expect(f.owner.observeRoomConversionIntent(f.wire,f.actor,new AbortController().signal,()=>{})).rejects.toThrow('room_conversion_history_close_unconfirmed');
  await expect(f.owner.drainRoomConversionObservations()).rejects.toThrow('room_conversion_history_close_unconfirmed');
  expect(()=>f.owner.observeRoomConversionIntent(f.wire,f.actor,new AbortController().signal,()=>{})).toThrow('room_conversion_observation_unavailable');
 }finally{opener.mockRestore();}
});
