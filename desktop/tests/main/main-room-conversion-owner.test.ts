// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMainRoomConversionCaptureOwner} from '../../electron/main-room-conversion-owner.js';
import {MainUserSubmissionOwner} from '../../electron/main-user-submission.js';
const roots:string[]=[];afterEach(()=>{roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true}));});
const scope={profileId:'profile',workspaceId:'workspace'},actor={requestSource:'user' as const,actorId:'desktop-user:profile'};
const source=()=>({ok:true,protocol:'room_conversion_source_v1',realmId:'11111111-1111-4111-8111-111111111111',actorUserId:'user.local',roomId:'room',roomRevision:2,membershipRevision:1,messageId:'message',messageSequence:3,text:'Original body',contextScope:{kind:'room_only'}});
const context=()=>({ok:true,protocol:'ordinary_project_followup_context_v1',classification:'ordinary',projectId:'project',projectRevision:3,projectStatus:'active',primaryRoomId:'room',scope:{...scope},bindingDigest:'a'.repeat(64),canonicalCreateDigest:'b'.repeat(64),conversionActions:{add_task:{eligible:false,reasonCode:'CANDIDATE_WORKSPACE_UNAVAILABLE'},add_revision:{eligible:false,reasonCode:'REVISION_BASE_NOT_READY'}}});
function fixture(){
 const dataRoot=mkdtempSync(join(tmpdir(),'live-main-room-'));roots.push(dataRoot);const submissions=new MainUserSubmissionOwner({dataRoot,...scope});
 const gateway={getDesktopMutationToken:()=> 'private-main-token',request:vi.fn(async()=>Response.json(context()))};
 const broker={getRoomConversionSource:vi.fn(async()=>source())},root=createMainRoomConversionCaptureOwner({submissions,scope,gateway});root.bindBroker(broker);
 const wire={action:'add_task' as const,roomId:'room',messageId:'message',projectId:'project',expectedProjectRevision:3,title:'Report'};
 return {dataRoot,submissions,gateway,broker,root,wire,recheck:vi.fn()};
}
it('actual root and original journal capture one source across 100 concurrent native operations and bind the issuer only once',async()=>{
 const f=fixture(),bind=vi.spyOn(f.submissions,'bindRoomConversionSources');
 const values=await Promise.all(Array.from({length:100},()=>f.root.capture(f.wire,actor,f.recheck)));
 expect(new Set(values.map(value=>value.capture.captureId)).size).toBe(1);expect(bind).toHaveBeenCalledOnce();expect(f.gateway.request).toHaveBeenCalledTimes(2);expect(f.broker.getRoomConversionSource).toHaveBeenCalledTimes(2);expect(values[0]).toMatchObject({execution:{state:'blocked',reasonCode:'CANDIDATE_WORKSPACE_UNAVAILABLE'}});
 expect(JSON.stringify(values[0])).not.toContain('Original body');expect(values[0]).not.toHaveProperty('sourceProof');expect(values[0]).not.toHaveProperty('taskIds');
 expect(readdirSync(join(f.dataRoot,'conversation-projects','user-submissions')).filter(name=>name.endsWith('.json'))).toHaveLength(1);
 expect(f.root.observe(values[0].capture.captureId,actor,f.recheck)).toEqual(values[0].capture);
});
it('checks the native actor before DTO access, and has no legacy snapshot fallback when its exact broker source is unavailable',async()=>{
 const f=fixture();let reads=0;const raw={get action(){reads++;throw Error('getter');}};
 await expect(f.root.capture(raw,{...actor,requestSource:'agent'},f.recheck)).rejects.toThrow('user_submission_actor_forbidden');expect(reads).toBe(0);expect(f.gateway.request).not.toHaveBeenCalled();
 f.broker.getRoomConversionSource.mockRejectedValue(Error('room_conversion_source_unavailable'));
 await expect(f.root.capture(f.wire,actor,f.recheck)).rejects.toThrow('room_conversion_source_unavailable');expect(f.broker.getRoomConversionSource).toHaveBeenCalledOnce();expect(readdirSync(join(f.dataRoot,'conversation-projects','user-submissions'))).toEqual([]);
});
it.each(['B1','R1','B2','R2'])('native authorization revoked during %s await refuses a new fact',async stage=>{
 const f=fixture();let allowed=true,b=0,r=0;const recheck=()=>{if(!allowed)throw Error('task_actor_forbidden');};
 f.gateway.request.mockImplementation(async()=>{if(++b===(stage==='B1'?1:stage==='B2'?2:0))allowed=false;return Response.json(context());});
 f.broker.getRoomConversionSource.mockImplementation(async()=>{if(++r===(stage==='R1'?1:stage==='R2'?2:0))allowed=false;return source();});
 await expect(f.root.capture(f.wire,actor,recheck)).rejects.toThrow('task_actor_forbidden');expect(readdirSync(join(f.dataRoot,'conversation-projects','user-submissions'))).toEqual([]);
});
it('refuses current wrong scope/primary Room/terminal project before fetching Room body',async()=>{
 for(const changes of [{scope:{...scope,workspaceId:'other'}},{primaryRoomId:'other'},{projectStatus:'closed'},{projectStatus:'delivered'}]){
  const f=fixture();f.gateway.request.mockImplementation(async()=>Response.json({...context(),...changes}));await expect(f.root.capture(f.wire,actor,f.recheck)).rejects.toThrow();expect(f.broker.getRoomConversionSource).not.toHaveBeenCalled();expect(readdirSync(join(f.dataRoot,'conversation-projects','user-submissions'))).toEqual([]);
 }
});
it('refuses project/source changes between original authority reads and binds no issuer or fact',async()=>{
 for(const stage of ['B2','R2','principal','project-scope']){
  const f=fixture();let b=0,r=0;
  f.gateway.request.mockImplementation(async()=>Response.json({...context(),...(stage==='B2'&&++b===2?{projectRevision:4}:{})}));
  f.broker.getRoomConversionSource.mockImplementation(async()=>({...source(),...(stage==='R2'&&++r===2?{membershipRevision:2}:stage==='principal'?{actorUserId:'other'}:stage==='project-scope'?{contextScope:{kind:'project',projectId:'other'}}:{})}));
  await expect(f.root.capture(f.wire,actor,f.recheck)).rejects.toThrow();expect(readdirSync(join(f.dataRoot,'conversation-projects','user-submissions'))).toEqual([]);
 }
});
it('same captured old expected version observes one fact; first stale input burns no origin and a new realm cannot mint a second capture',async()=>{
 const f=fixture();f.gateway.request.mockImplementation(async()=>Response.json({...context(),projectRevision:4}));await expect(f.root.capture(f.wire,actor,f.recheck)).rejects.toThrow('room_conversion_project_revision_conflict');expect(readdirSync(join(f.dataRoot,'conversation-projects','user-submissions'))).toEqual([]);
 f.gateway.request.mockImplementation(async()=>Response.json(context()));const first=await f.root.capture(f.wire,actor,f.recheck);
 f.gateway.request.mockImplementation(async()=>Response.json({...context(),projectRevision:4}));expect((await f.root.capture(f.wire,actor,f.recheck)).capture).toEqual(first.capture);
 f.broker.getRoomConversionSource.mockResolvedValue({...source(),messageId:'new-message',realmId:'22222222-2222-4222-8222-222222222222'});await expect(f.root.capture({...f.wire,messageId:'new-message'},actor,f.recheck)).rejects.toThrow('room_conversion_broker_identity_changed');expect(f.root.observe(first.capture.captureId,actor,f.recheck)).toEqual(first.capture);
});
it('sealed root refuses late source result and observation stays metadata-only',async()=>{
 const f=fixture();let resolve!:(value:ReturnType<typeof source>)=>void;
 f.broker.getRoomConversionSource.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));const pending=f.root.capture(f.wire,actor,f.recheck);
 while(!resolve)await new Promise<void>(done=>setImmediate(done));f.root.seal();resolve(source());await expect(pending).rejects.toThrow('room_conversion_closed');expect(readdirSync(join(f.dataRoot,'conversation-projects','user-submissions'))).toEqual([]);
 const g=fixture(),first=await g.root.capture(g.wire,actor,g.recheck);g.root.seal();expect(g.root.observe(first.capture.captureId,actor,g.recheck)).toEqual(first.capture);await expect(g.root.capture(g.wire,actor,g.recheck)).rejects.toThrow('room_conversion_closed');
});

it('lost capture ACK is observed from the original journal before Broker/B reads, even after source deletion and root reopen',async()=>{
 const f=fixture(),first=await f.root.capture(f.wire,actor,f.recheck);f.gateway.request.mockClear();f.broker.getRoomConversionSource.mockClear();
 f.gateway.request.mockRejectedValue(Error('PROJECT_NOT_FOUND'));f.broker.getRoomConversionSource.mockRejectedValue(Error('room_message_not_found'));
 expect((await f.root.capture(f.wire,actor,f.recheck)).capture).toEqual(first.capture);expect(f.gateway.request).not.toHaveBeenCalled();expect(f.broker.getRoomConversionSource).not.toHaveBeenCalled();
 const reopened=createMainRoomConversionCaptureOwner({submissions:new MainUserSubmissionOwner({dataRoot:f.dataRoot,...scope}),scope,gateway:f.gateway});
 expect((await reopened.capture(f.wire,actor,f.recheck)).capture).toEqual(first.capture);expect(f.gateway.request).not.toHaveBeenCalled();
 await expect(reopened.capture({...f.wire,projectId:'other'},actor,f.recheck)).rejects.toThrow('room_conversion_conflict');expect(f.gateway.request).not.toHaveBeenCalled();
});

it('concurrent first reads from distinct realms cannot bind two origins or replace the original issuer',async()=>{
 const f=fixture();f.broker.getRoomConversionSource.mockImplementation(async(_roomId,messageId)=>({...source(),messageId,realmId:messageId==='message'?source().realmId:'22222222-2222-4222-8222-222222222222'}));
 const outcomes=await Promise.allSettled([f.root.capture(f.wire,actor,f.recheck),f.root.capture({...f.wire,messageId:'other-message'},actor,f.recheck)]);
 expect(outcomes.filter(outcome=>outcome.status==='fulfilled')).toHaveLength(1);const failed=outcomes.find(outcome=>outcome.status==='rejected') as PromiseRejectedResult;expect(String(failed.reason)).toContain('room_conversion_broker_identity_changed');
 expect(readdirSync(join(f.dataRoot,'conversation-projects','user-submissions')).filter(name=>name.endsWith('.json'))).toHaveLength(1);
 expect(()=>f.root.bindBroker(f.broker)).toThrow('room_conversion_source_owner_conflict');
});
