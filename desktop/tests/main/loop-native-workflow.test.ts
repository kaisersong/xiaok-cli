import {it,expect,vi,afterEach} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const leaf=vi.hoisted(()=>({call:vi.fn(),route:undefined as any,dispose:vi.fn()}));
vi.mock('../../../src/runtime/verification/controller-client.js',()=>({createInstalledVerificationClient:()=>({completionTransport:{call:leaf.call,callSync(){throw Error('unused');}},applicationTransport:{call:leaf.call},dispose:leaf.dispose})}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:()=>leaf.route}));
import {LoopStore} from '../../electron/loop-store.js';import {ArtifactEvidenceRegressionScanner} from '../../electron/artifact-evidence-regression-loop.js';import {CompletionEvidenceStore} from '../../electron/completion-evidence-store.js';
import {createLoopNativeWorkflow} from '../../electron/loop-native-workflow.js';
import {loopHostSubjectOwner} from '../../../src/runtime/verification/loop-host-subject.js';
import {loopApplicationBindingHash,createLoopApplicationBinding} from '../../../src/runtime/verification/loop-application-binding.js';
const cleanups:Array<()=>void>=[];afterEach(()=>{for(const cleanup of cleanups.splice(0))cleanup();leaf.call.mockReset();leaf.dispose.mockReset();});
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
const definition=(id:string)=>({version:1,obligations:[{obligationId:id,predicateId:'content',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'check',path:'report',sha256:'a'.repeat(64),structure:'bytes'}]}}]});
function storeFixture(){const root=mkdtempSync(join(tmpdir(),'loop-native-attempt-')),file=join(root,'loop.sqlite'),store=new LoopStore(file),loopId='artifact-evidence-regression';store.ensureBuiltInLoops(1);store.saveLoopPublicationConfiguration({loopId,expectedRevision:null,requestSource:'user',now:2,configuration:{version:1,contract:{kind:'builtin-diagnostic',scanner:loopId,objective:'Original',completionCriterion:'Original criterion'},verificationDefinitions:{run:definition('run-original'),stages:{scan:definition('scan-original')}}}});const began=store.beginLoopRun(loopId,{kind:'manual'},3,1000,{requestSource:'user'});if(began.status!=='started')throw Error('begin');const stage=store.startLoopStage(began.run.id,loopId,'scan',4),p=store.openLoopPublicationProducer(began.run),ef=join(root,'e.sqlite'),e=new CompletionEvidenceStore(ef),scanner=new ArtifactEvidenceRegressionScanner(ef);try{p.recordScan(stage.id,scanner.scan({loopRunId:began.run.id,now:10}),10);}finally{scanner.close();e.close();}const candidates=store.recoverLoopPublicationCandidates({runId:began.run.id,requestSource:'user'}),candidate=candidates.find(x=>x.stageId===null)!,scanCandidate=candidates.find(x=>x.stageId===stage.id)!;return{root,file,store,loopId,candidate,scanCandidate,close(){store.close();rmSync(root,{recursive:true,force:true});}};}

async function fixture(){
 const f=storeFixture();let currentStore=f.store;cleanups.push(()=>{currentStore.close();rmSync(f.root,{recursive:true,force:true});});let admission=true;
 const options=()=>({store:currentStore,assertAdmission(){if(!admission)throw Error('host closed');},now:()=>20});
 const workflow=createLoopNativeWorkflow(options());
 const row=await workflow.reserve({candidateId:f.candidate.candidateId,expectedLatestAttemptId:null,requestSource:'user'});
 const owner={profileId:'profile',...loopHostSubjectOwner(f.candidate.binding.subject)};leaf.route={kind:'protected-unregistered',authorityId:'authority',owner};
 const base={version:1,authorityId:'authority',principal:{uid:501,auditSessionId:7,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555'},deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1,validUntil:1000}};
 let enrollment:any,application:any,enrolled=false,bound=false;
 const observation=()=>({state:'active',current:{binding:f.candidate.binding,bindingHash:f.candidate.bindingHash,revision:1},pendingTransitionId:null});
 async function transport(method:string,payload:any):Promise<any>{
  if(method==='completion.prepare-owner-request'){expect(currentStore.getLoopNativeAttempt(row.attemptId)?.phase).toBe('enrolling');const {requestId,...proposal}=payload;expect(requestId).toBe(row.enrollmentRequestId);expect(proposal.enrollment).toEqual({...loopHostSubjectOwner(f.candidate.binding.subject),loopSubject:f.candidate.binding.subject,invocations:[]});enrollment={challengeId:'enroll',canonicalReview:{...base,purpose:'completion-owner-enrollment',profileSlot:'default',challengeId:'enroll',...proposal}};return {created:true,challenge:enrollment};}
  if(method==='completion.authorize-owner'){enrolled=true;return {owner,readGrant:{id:'read',secret:'a'.repeat(64)}};}
  if(method==='completion.recover-owner-request')return enrolled?{state:'committed',owner,challenge:enrollment}:enrollment?{state:'not_approved',challenge:enrollment}:{state:'not_prepared'};
  if(method==='application.prepareRequest'){expect(currentStore.getLoopNativeAttempt(row.attemptId)?.phase).toBe('binding');expect(payload.requestId).toBe(row.applicationRequestId);application={challengeId:'apply',alreadyCommitted:false,canonicalReview:{...base,purpose:'completion-application-binding',challengeId:'apply',requestSource:'user',owner,registrationHash:'a'.repeat(64),previousBindingHash:null,binding:f.candidate.binding,bindingHash:f.candidate.bindingHash}};return {created:true,challenge:application};}
  if(method==='application.authorize'){bound=true;return observation();}
  if(method==='application.recoverRequest')return bound?{state:'committed',challengePhase:'committed',challenge:{...application,alreadyCommitted:true},observation:{...observation(),pendingTarget:null}}:application?{state:'not_approved',challengePhase:'not_approved',challenge:application}:{state:'not_prepared'};
  throw Error(`unexpected ${method}`);
 }
 leaf.call.mockImplementation(transport);
 return {...f,row,workflow,options,transport,input:{attemptId:row.attemptId,requestSource:'user' as const},revoke(){admission=false;},reopen(){currentStore.close();currentStore=new LoopStore(f.file);f.store=currentStore;return createLoopNativeWorkflow(options());}};
}
it('uses real durable candidate and fixed clients for both native stages; ready is not business success',async()=>{
 const f=await fixture();expect((await f.workflow.advance(f.input)).phase).toBe('ready');expect(f.store.getLoopRunLifecycle(f.candidate.runId)?.businessState).toBe('publication_pending');
 expect(leaf.call.mock.calls.map(c=>c[0])).toEqual(['completion.prepare-owner-request','completion.authorize-owner','completion.recover-owner-request','application.prepareRequest','application.authorize','application.recoverRequest']);
});
it.each(['completion.prepare-owner-request','completion.authorize-owner','application.prepareRequest','application.authorize'])('recovers lost %s reply with real SQLite reopen and no repeated native',async(method)=>{
 const f=await fixture();leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);if(m===method)throw Error('reply lost');return result;});await expect(f.workflow.advance(f.input)).rejects.toThrow('reply lost');await f.workflow.close();
 const original=f.store.getLoopNativeAttempt(f.row.attemptId)!;const before=leaf.call.mock.calls.filter(c=>String(c[0]).includes('authorize')).length;leaf.call.mockImplementation(f.transport);
 const restarted=f.reopen(),result=await restarted.recover({...f.input,requestSource:'scheduler'});expect(result.phase).toBe(method==='completion.authorize-owner'?'enrolled':method==='application.authorize'?'ready':'retired');
 expect(result.enrollmentRequestId).toBe(original.enrollmentRequestId);expect(result.applicationRequestId).toBe(original.applicationRequestId);expect(leaf.call.mock.calls.filter(c=>String(c[0]).includes('authorize'))).toHaveLength(before);
 for(const [m,p] of leaf.call.mock.calls)if(m==='application.recoverRequest'&&p.requestSource==='scheduler')expect(p.requestId).toBe(original.applicationRequestId);
 expect(restarted.list(f.candidate.candidateId)).toHaveLength(1);await restarted.close();
});
it.each(['agent','scheduler'] as const)('rejects %s fresh advance and reservation before transport',async(requestSource)=>{
 const f=await fixture();await expect(f.workflow.advance({...f.input,requestSource})).rejects.toThrow();await expect(Promise.resolve().then(()=>f.workflow.reserve({candidateId:f.candidate.candidateId,expectedLatestAttemptId:f.row.attemptId,requestSource}))).rejects.toThrow();expect(leaf.call).not.toHaveBeenCalled();expect(f.store.getLoopNativeAttempt(f.row.attemptId)?.phase).toBe('reserved');
});
it.each(['completion.prepare-owner-request','application.prepareRequest'])('created false at %s never recreates native eligibility',async(method)=>{
 const f=await fixture();leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);return m===method?{...result,created:false}:result;});expect((await f.workflow.advance(f.input)).phase).toBe('retired');expect(leaf.call.mock.calls.filter(c=>c[0]===(method.startsWith('completion')?'completion.authorize-owner':'application.authorize'))).toHaveLength(0);
});
it('scheduler recovery of reserved/enrolled never opens the next native stage',async()=>{
 const f=await fixture();expect((await f.workflow.recover({...f.input,requestSource:'scheduler'})).phase).toBe('reserved');expect(leaf.call).not.toHaveBeenCalled();
 leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);if(m==='completion.authorize-owner')throw Error('reply lost');return result;});await expect(f.workflow.advance(f.input)).rejects.toThrow('reply lost');leaf.call.mockImplementation(f.transport);
 expect((await f.workflow.recover({...f.input,requestSource:'scheduler'})).phase).toBe('enrolled');expect((await f.workflow.recover({...f.input,requestSource:'scheduler'})).phase).toBe('enrolled');expect(leaf.call.mock.calls.filter(c=>c[0]==='application.prepareRequest')).toHaveLength(0);expect((await f.workflow.advance(f.input)).phase).toBe('ready');
});
it('pause during native enrollment preserves late history without starting application',async()=>{
 const f=await fixture(),entered=deferred(),release=deferred();leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);if(m==='completion.authorize-owner'){entered.resolve();await release.promise;}return result;});
 const pending=f.workflow.advance(f.input);await entered.promise;f.store.setLoopStatus(f.loopId,'paused',21);release.resolve();expect((await pending).phase).toBe('stale');expect(f.store.getLoopNativeAttempt(f.row.attemptId)?.phase).toBe('stale');expect(leaf.call.mock.calls.filter(c=>c[0]==='application.prepareRequest')).toHaveLength(0);expect(f.store.getLoopRunLifecycle(f.candidate.runId)?.businessState).toBe('publication_pending');
});
it('admission revoked while prepare awaits prevents native authorize',async()=>{
 const f=await fixture(),entered=deferred(),release=deferred();leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);if(m==='completion.prepare-owner-request'){entered.resolve();await release.promise;}return result;});const pending=f.workflow.advance(f.input);await entered.promise;f.revoke();release.resolve();await expect(pending).rejects.toThrow('host closed');expect(leaf.call.mock.calls.filter(c=>c[0]==='completion.authorize-owner')).toHaveLength(0);expect(f.store.getLoopNativeAttempt(f.row.attemptId)?.phase).not.toBe('ready');
});
it('different full candidate on same subject cannot become ready',async()=>{
 const f=await fixture();leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);if(m==='application.recoverRequest'){const raw={...structuredClone(f.candidate.binding),candidateId:f.candidate.binding.candidateId+'-different'};const {triggerHash,contractHash,candidatePayloadHash,...input}=raw;const binding=createLoopApplicationBinding(input);result.observation.current={binding,bindingHash:loopApplicationBindingHash(binding),revision:2};}return result;});expect((await f.workflow.advance(f.input)).phase).toBe('stale');expect(f.store.getLoopNativeAttempt(f.row.attemptId)?.phase).toBe('stale');
});
it('separate workflow instances and SQLite connections claim each native stage at most once',async()=>{
 const f=await fixture(),other=new LoopStore(f.file),workflow=createLoopNativeWorkflow({...f.options(),store:other});try{await Promise.allSettled([f.workflow.advance(f.input),workflow.advance(f.input)]);expect(leaf.call.mock.calls.filter(c=>c[0]==='completion.prepare-owner-request')).toHaveLength(1);expect(leaf.call.mock.calls.filter(c=>c[0]==='completion.authorize-owner')).toHaveLength(1);expect(leaf.call.mock.calls.filter(c=>c[0]==='application.authorize').length).toBeLessThanOrEqual(1);expect(f.store.listLoopNativeAttempts(f.candidate.candidateId)).toHaveLength(1);expect(f.store.getLoopNativeAttempt(f.row.attemptId)?.phase).toBe('retired');}finally{await workflow.close();other.close();}
});
it('close blocks new work synchronously and drains held native before resolving',async()=>{
 const f=await fixture(),entered=deferred(),release=deferred();leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);if(m==='completion.authorize-owner'){entered.resolve();await release.promise;}return result;});const pending=f.workflow.advance(f.input);await entered.promise;let closed=false;const closing=f.workflow.close().then(()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);await expect(f.workflow.advance(f.input)).rejects.toThrow();release.resolve();expect((await pending).phase).toBe('stale');await closing;expect(closed).toBe(true);expect(leaf.call.mock.calls.filter(c=>c[0]==='application.prepareRequest')).toHaveLength(0);expect(f.store.getLoopNativeAttempt(f.row.attemptId)?.phase).not.toBe('ready');
});
it('first enrollment can publish a previously unavailable profile before constructing the application client',async()=>{
 const f=await fixture(),route=leaf.route;leaf.route={kind:'unavailable',reason:'profile_missing'};leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);if(m==='completion.authorize-owner')leaf.route=route;return result;});expect((await f.workflow.advance(f.input)).phase).toBe('ready');expect(leaf.call.mock.calls.filter(c=>c[0]==='application.authorize')).toHaveLength(1);
});
it('abort during original prepare prevents authorization and leaves exact request for recovery',async()=>{
 const f=await fixture(),controller=new AbortController(),entered=deferred(),release=deferred();leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);if(m==='completion.prepare-owner-request'){entered.resolve();await release.promise;}return result;});const pending=f.workflow.advance({...f.input,signal:controller.signal});await entered.promise;controller.abort(Error('user cancelled'));release.resolve();await expect(pending).rejects.toThrow('user cancelled');expect(leaf.call.mock.calls.filter(c=>c[0]==='completion.authorize-owner')).toHaveLength(0);expect(f.store.getLoopNativeAttempt(f.row.attemptId)?.enrollmentRequestId).toBe(f.row.enrollmentRequestId);leaf.call.mockImplementation(f.transport);expect((await f.workflow.recover({...f.input,requestSource:'scheduler'})).phase).toBe('retired');
});
it.each(['pending','registration_changed','reauthorization_required'] as const)('keeps %s on original request and blocks a fresh reservation',async(state)=>{
 const f=await fixture();leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);if(m==='application.recoverRequest')return {state,challengePhase:'approved',challenge:{...result.challenge,alreadyCommitted:false},observation:{state:'pending',current:null,pendingTransitionId:'original-transition',pendingTarget:f.candidate.binding}};return result;});
 const first=await f.workflow.advance(f.input);expect(first.phase).toBe(state==='pending'?'binding':'needs_reauthorization');expect(()=>f.workflow.reserve({candidateId:f.candidate.candidateId,expectedLatestAttemptId:first.attemptId,requestSource:'user'})).toThrow();const before=leaf.call.mock.calls.length;
 const recovered=await f.workflow.recover({...f.input,requestSource:'scheduler'});expect(recovered).toEqual(first);const calls=leaf.call.mock.calls.slice(before);expect(calls.map(c=>c[0])).toEqual(state==='pending'?['application.recoverRequest']:[]);if(state==='pending')expect(calls[0][1].requestSource).toBe('scheduler');expect(f.workflow.list(f.candidate.candidateId)).toHaveLength(1);
});
it('now callback revocation is checked before the native phase CAS',async()=>{
 const f=await fixture(),workflow=createLoopNativeWorkflow({...f.options(),now(){f.revoke();return 30;}});await expect(workflow.advance(f.input)).rejects.toThrow('host closed');expect(f.store.getLoopNativeAttempt(f.row.attemptId)?.phase).toBe('reserved');expect(leaf.call).not.toHaveBeenCalled();await workflow.close();
});
it('same-instance scheduler recovery joins held native work without prematurely sealing its request',async()=>{
 const f=await fixture(),entered=deferred(),release=deferred();leaf.call.mockImplementation(async(m,p)=>{const result=await f.transport(m,p);if(m==='completion.authorize-owner'){entered.resolve();await release.promise;}return result;});const pending=f.workflow.advance(f.input);await entered.promise;const recovery=f.workflow.recover({...f.input,requestSource:'scheduler'});expect(recovery).toBe(pending);expect(leaf.call.mock.calls.filter(c=>c[0]==='completion.recover-owner-request')).toHaveLength(0);release.resolve();const results=await Promise.all([pending,recovery]);expect(results[0].phase).toBe('ready');expect(results[1]).toEqual(results[0]);expect(leaf.call.mock.calls.filter(c=>c[0]==='completion.authorize-owner')).toHaveLength(1);expect(leaf.call.mock.calls.filter(c=>c[0]==='application.authorize')).toHaveLength(1);
});
