import {beforeEach,it,expect,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
const wire=vi.hoisted(()=>({calls:[] as string[],application:{} as any,challenge:{} as any,observation:{} as any,recovery:{} as any,original:undefined as any,change:undefined as undefined|((point:string)=>void),prepareHold:undefined as Promise<void>|undefined,approveLost:false,opened:0,closed:0,route:{} as any,prepareLost:false}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:()=>wire.route}));
vi.mock('../../../src/runtime/verification/installed-loop-application.js',()=>({createInstalledLoopApplicationClient:()=>{wire.opened++;return {async inspect(){wire.calls.push('inspect');const v=structuredClone(wire.application);wire.change?.('inspect');return v;},dispose(){wire.closed++;}};}}));
vi.mock('../../../src/runtime/verification/installed-completion-publication.js',()=>({createInstalledCompletionPublisher:(owner:unknown,source:string)=>{expect(source).toBe('user');wire.opened++;return {
 async prepareRequest(id:string){wire.calls.push('prepare:'+id);await wire.prepareHold;wire.original=structuredClone(wire.challenge);wire.change?.('prepare');if(wire.prepareLost)throw Error('lost prepare reply');return wire.original;},
 async approve(c:unknown){expect(c).toBe(wire.original);wire.calls.push('approve');wire.change?.('approve');if(wire.approveLost)throw Error('lost commit reply');return structuredClone(wire.observation);},
 async recoverRequest(id:string){wire.calls.push('recover:'+id);return structuredClone(wire.recovery);},
 async reconcile(){wire.calls.push('reconcile');return structuredClone(wire.observation);},dispose(){wire.closed++;}};}}));
import {loopPublicationFixture,readyLoopNative} from '../support/loop-publication-fixture.js';
import {loopHostSubjectOwner} from '../../../src/runtime/verification/loop-host-subject.js';
import {loopApplicationBindingHash} from '../../../src/runtime/verification/loop-application-binding.js';
import {createLoopPublicationWorkflow} from '../../electron/loop-publication-workflow.js';
import {LoopStore} from '../../electron/loop-store.js';
beforeEach(()=>{wire.calls=[];wire.original=undefined;wire.change=undefined;wire.prepareHold=undefined;wire.approveLost=false;wire.opened=0;wire.closed=0;wire.prepareLost=false;});
function fixture(){const f=loopPublicationFixture(),native=readyLoopNative(f),owner={profileId:'profile',...loopHostSubjectOwner(f.candidate.binding.subject)};
 wire.route={kind:'protected-unregistered',authorityId:'authority',owner};
 wire.application={state:'active',current:{binding:f.candidate.binding,bindingHash:loopApplicationBindingHash(f.candidate.binding),revision:1},pendingTransitionId:null,pendingTarget:null};
 wire.challenge={challengeId:'original-challenge',owner,fullTupleHash:'a'.repeat(64),deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1000,validUntil:2000}};
 wire.observation={owner,status:'committed',operationId:'original-operation',fullTupleHash:'a'.repeat(64),businessRevision:1,currentVerification:'valid'};
 wire.recovery={status:'settlement_exists',owner,challengeId:'original-challenge',operationId:'original-operation',fullTupleHash:'a'.repeat(64),challenge:wire.challenge};
 const workflow=createLoopPublicationWorkflow({store:f.store,assertAdmission(){},now:()=>40});
 return {...f,native,workflow};}
const start=(f:ReturnType<typeof fixture>,extra:any={})=>f.workflow.start({nativeAttemptId:f.native.attemptId,expectedLatestAttemptId:null,requestSource:'user',...extra});

it('reservation rolls back if its final SQLite write changes current configuration',()=>{const f=fixture(),db=new DatabaseSync(f.file);try{
 const version=f.store.getAutomationStoreVersion();db.exec("CREATE TRIGGER pub_config_tail AFTER UPDATE ON automation_store_metadata BEGIN UPDATE loop_publication_configs SET revision=revision+1; END");
 expect(()=>f.store.reserveLoopPublicationAttempt({nativeAttemptId:f.native.attemptId,expectedLatestAttemptId:null,requestSource:'user',now:30})).toThrow();
 expect(f.store.getAutomationStoreVersion()).toBe(version);expect(f.store.listLoopPublicationAttempts(f.candidate.candidateId)).toEqual([]);
 }finally{db.close();f.close();}});
it('authorizing claim rolls back when final SQLite write changes original configuration',async()=>{const f=fixture(),db=new DatabaseSync(f.file);try{
 db.exec("CREATE TRIGGER pub_config_tail AFTER UPDATE ON automation_store_metadata WHEN EXISTS(SELECT 1 FROM loop_publication_attempts WHERE json_extract(record_json,'$.status')='authorizing') BEGIN UPDATE loop_publication_configs SET revision=revision+1; END");
 await expect(start(f)).rejects.toThrow();expect(wire.calls).not.toContain('approve');expect(f.store.listLoopPublicationAttempts(f.candidate.candidateId)[0].status).toBe('prepared');
 }finally{await f.workflow.close();db.close();f.close();}});
it('recovery requires host permission without requiring fresh candidate admission',async()=>{const f=fixture();let host:ReturnType<typeof createLoopPublicationWorkflow>|undefined;try{
 const row=f.store.reserveLoopPublicationAttempt({nativeAttemptId:f.native.attemptId,expectedLatestAttemptId:null,requestSource:'user',now:30});
 host=createLoopPublicationWorkflow({store:f.store,assertAdmission(){throw Error('workspace revoked');},now:()=>40});
 await expect(host.recover({attemptId:row.attemptId,requestSource:'scheduler'})).rejects.toThrow('workspace revoked');expect(wire.calls).toEqual([]);
 }finally{await host?.close();await f.workflow.close();f.close();}});
it('start of an existing request cannot bypass revoked host permission through its recovery branch',async()=>{const f=fixture();let host:ReturnType<typeof createLoopPublicationWorkflow>|undefined;try{
 const row=f.store.reserveLoopPublicationAttempt({nativeAttemptId:f.native.attemptId,expectedLatestAttemptId:null,requestSource:'user',now:30});
 host=createLoopPublicationWorkflow({store:f.store,assertAdmission(){throw Error('workspace revoked');},now:()=>40});
 await expect(host.start({nativeAttemptId:f.native.attemptId,expectedLatestAttemptId:row.attemptId,requestSource:'user'})).rejects.toThrow('workspace revoked');expect(wire.calls).toEqual([]);
 }finally{await host?.close();await f.workflow.close();f.close();}});
it('terminal transaction rejects a copied ticket on a second connection and burns its original once',async()=>{
 const f=fixture(),other=new LoopStore(f.file),original=f.store.advanceLoopPublicationAttempt.bind(f.store);let terminal:any;
 const spy=vi.spyOn(f.store,'advanceLoopPublicationAttempt').mockImplementation(input=>{const current=f.store.getLoopPublicationAttempt(input.attemptId);if(current?.status==='authorizing'){terminal=input;expect(()=>other.advanceLoopPublicationAttempt({...input,ticket:structuredClone(input.ticket)})).toThrow();}return original(input);});
 const host=createLoopPublicationWorkflow({store:f.store,assertAdmission(){},now:()=>40});try{expect((await host.start({nativeAttemptId:f.native.attemptId,expectedLatestAttemptId:null,requestSource:'user'})).status).toBe('committed');expect(terminal).toBeTruthy();expect(()=>original(terminal)).toThrow();expect(f.store.getLoopRunLifecycle(f.candidate.runId)?.businessState).toBe('publication_pending');}finally{spy.mockRestore();await host.close();await f.workflow.close();other.close();f.close();}
});
it.each(['trigger_json','logical_run_key'])('native candidate current and publication reservation reject actual run %s drift',field=>{
 const f=fixture(),db=new DatabaseSync(f.file);try{db.prepare(`UPDATE loop_runs SET ${field}=? WHERE id=?`).run(field==='trigger_json'?'{}':'changed-key',f.candidate.runId);
 expect(()=>f.store.assertLoopNativeAttemptCurrent(f.native.attemptId)).toThrow();expect(()=>f.store.reserveLoopPublicationAttempt({nativeAttemptId:f.native.attemptId,expectedLatestAttemptId:null,requestSource:'user',now:30})).toThrow();expect(f.store.listLoopPublicationAttempts(f.candidate.candidateId)).toEqual([]);
 }finally{db.close();f.close();}
});
it('a denied second host cannot join an authorized in-flight request',async()=>{const f=fixture();let release!:()=>void;wire.prepareHold=new Promise<void>(r=>{release=r;});const denied=createLoopPublicationWorkflow({store:f.store,assertAdmission(){throw Error('workspace revoked');},now:()=>40});try{
 const first=start(f);await vi.waitFor(()=>expect(wire.calls.some(x=>x.startsWith('prepare:'))).toBe(true));const row=f.store.listLoopPublicationAttempts(f.candidate.candidateId)[0];
 const follower=denied.recover({attemptId:row.attemptId,requestSource:'scheduler'});const rejected=expect(follower).rejects.toThrow('workspace revoked');release();await rejected;expect((await first).status).toBe('committed');expect(wire.calls.filter(x=>x==='approve')).toHaveLength(1);
 }finally{release();await denied.close();await f.workflow.close();f.close();}});
it('reservation final readback rejects a changed original native ready row',()=>{const f=fixture(),db=new DatabaseSync(f.file);try{
 db.exec("CREATE TRIGGER pub_native_tail AFTER UPDATE ON automation_store_metadata BEGIN UPDATE loop_native_attempts SET phase='retired',revision=revision+1; END");
 expect(()=>f.store.reserveLoopPublicationAttempt({nativeAttemptId:f.native.attemptId,expectedLatestAttemptId:null,requestSource:'user',now:30})).toThrow();expect(f.store.listLoopPublicationAttempts(f.candidate.candidateId)).toEqual([]);expect(f.store.getLoopNativeAttempt(f.native.attemptId)).toEqual(f.native);
 }finally{db.close();f.close();}});
it('authorizing final write cannot change the original native identity row',async()=>{const f=fixture(),db=new DatabaseSync(f.file);try{
 db.exec("CREATE TRIGGER pub_native_tail AFTER UPDATE ON automation_store_metadata WHEN EXISTS(SELECT 1 FROM loop_publication_attempts WHERE json_extract(record_json,'$.status')='authorizing') BEGIN UPDATE loop_native_attempts SET application_request_id='changed-native-request'; END");
 await expect(start(f)).rejects.toThrow();expect(wire.calls).not.toContain('approve');expect(f.store.listLoopPublicationAttempts(f.candidate.candidateId)[0].status).toBe('prepared');expect(f.store.getLoopNativeAttempt(f.native.attemptId)).toEqual(f.native);
 }finally{await f.workflow.close();db.close();f.close();}});
