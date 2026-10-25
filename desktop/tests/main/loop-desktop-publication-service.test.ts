import {expect,it,vi,beforeEach} from 'vitest';
import {join} from 'node:path';
import {loopPublicationFixture,readyLoopNative} from '../support/loop-publication-fixture.js';
const leaf=vi.hoisted(()=>({call:vi.fn(),route:undefined as any}));
vi.mock('../../../src/runtime/verification/controller-client.js',()=>({createInstalledVerificationClient:()=>({completionTransport:{call:leaf.call,callSync(){throw Error('unused');}},applicationTransport:{call:leaf.call},dispose(){}})}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:()=>leaf.route}));
import {createDesktopLoopPublicationService} from '../../electron/loop-desktop-publication-service.js';
import {loopHostSubjectOwner} from '../../../src/runtime/verification/loop-host-subject.js';
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};}
beforeEach(()=>{leaf.call.mockReset();leaf.route=undefined;});
function fixture(){const f=loopPublicationFixture();let epoch=1;
 const service=createDesktopLoopPublicationService({store:f.store,sessionRoot:join(f.root,'verification-sessions'),workspaceRoot:f.root,captureAdmission(){const before=epoch;return()=>{if(epoch!==before)throw Error('permission_changed');};},taskPort:{async recoverTask(){return undefined;}}});
 return{...f,service,revoke(){epoch++;}};
}
it('uses original configuration CAS and refuses agent/scheduler/extra fields before mutation',async()=>{const f=fixture();try{
 const original=f.service.getConfiguration(f.loopId)!;
 for(const requestSource of ['agent','scheduler'] as const)await expect(f.service.perform({kind:'saveConfiguration',loopId:f.loopId,expectedRevision:original.revision,configuration:original.configuration,requestSource})).rejects.toThrow();
 await expect(f.service.perform({kind:'saveConfiguration',loopId:f.loopId,expectedRevision:original.revision,configuration:original.configuration,requestSource:'user',ownerId:'injected'} as any)).rejects.toThrow();
 expect(f.service.getConfiguration(f.loopId)?.revision).toBe(original.revision);
 await f.service.perform({kind:'saveConfiguration',loopId:f.loopId,expectedRevision:original.revision,configuration:original.configuration,requestSource:'user'});
 expect(f.service.getConfiguration(f.loopId)?.revision).toBe(original.revision+1);
 await expect(f.service.perform({kind:'saveConfiguration',loopId:f.loopId,expectedRevision:original.revision,configuration:original.configuration,requestSource:'user'})).rejects.toThrow();expect(leaf.call).not.toHaveBeenCalled();
 }finally{await f.service.close();f.close();}});
it('real native reservation and session allocation stay historical and are readable while paused',async()=>{const f=fixture();try{
 const native=readyLoopNative(f);await f.service.perform({kind:'prepareSession',nativeAttemptId:native.attemptId,obligationId:'run-original',requestSource:'user'});
 f.store.setLoopStatus(f.loopId,'paused',100);const state=f.service.getState(f.candidate.runId);
 expect(state.historyOnly).toBe(true);expect(state.businessState).toBe('publication_pending');expect(state.candidates).toHaveLength(2);
 const candidate=state.candidates.find(c=>c.candidateId===f.candidate.candidateId)!;expect(candidate.natives[0].sessions[0].phase).toBe('session_ready');expect(candidate.definition.obligations[0].obligationId).toBe('run-original');
 expect(JSON.stringify(state)).not.toContain('candidatePayload');expect(leaf.call).not.toHaveBeenCalled();
 }finally{await f.service.close();f.close();}});
it.each(['permission','shutdown'] as const)('holds original busy/guard and drains real native transport: %s',async mode=>{const f=fixture(),entered=deferred(),release=deferred();let pending:Promise<unknown>|undefined;
 try{await f.service.perform({kind:'reserveNative',candidateId:f.candidate.candidateId,expectedLatestAttemptId:null,requestSource:'user'});const row=f.store.listLoopNativeAttempts(f.candidate.candidateId)[0];
 const owner={profileId:'profile',...loopHostSubjectOwner(f.candidate.binding.subject)};leaf.route={kind:'protected-unregistered',authorityId:'authority',owner};
 leaf.call.mockImplementation(async(method:string,payload:any)=>{if(method!=='completion.prepare-owner-request')throw Error('unexpected fresh/recovery '+method);entered.resolve();await release.promise;
 const {requestId,...proposal}=payload;return{created:true,challenge:{challengeId:'enroll',canonicalReview:{version:1,authorityId:'authority',principal:{uid:501,auditSessionId:7,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555'},deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1,validUntil:1000},purpose:'completion-owner-enrollment',profileSlot:'default',challengeId:'enroll',...proposal}}};});
 const input={kind:'advanceNative' as const,attemptId:row.attemptId,requestSource:'user' as const};pending=f.service.perform(input);void pending.catch(()=>{});await entered.promise;
 await expect(f.service.perform({kind:'reserveNative',candidateId:f.scanCandidate.candidateId,expectedLatestAttemptId:null,requestSource:'user'})).rejects.toThrow('busy');input.attemptId='changed';
 if(mode==='permission')f.revoke();else{f.service.stopAccepting();expect(await f.service.drain(1)).toBe(false);await expect(f.service.perform({kind:'recoverNative',attemptId:row.attemptId,requestSource:'user'})).rejects.toThrow();}
 expect(f.store.getLoopNativeAttempt(row.attemptId)?.phase).toBe('enrolling');release.resolve();await expect(pending).rejects.toThrow();expect(leaf.call.mock.calls.map(c=>c[0])).toEqual(['completion.prepare-owner-request']);expect(f.store.listLoopNativeAttempts(f.scanCandidate.candidateId)).toHaveLength(0);
 await f.service.close();expect(await f.service.drain(0)).toBe(true);
 }finally{release.resolve();await pending?.catch(()=>{});await f.service.close();f.close();}});
it('missing recovery IDs make no fresh RPC; closed service cannot read or allocate',async()=>{const f=fixture();try{for(const kind of ['recoverNative','recoverPublication'] as const)await expect(f.service.perform({kind,attemptId:'missing',requestSource:'scheduler'})).rejects.toThrow();await expect(f.service.perform({kind:'recoverVerification',id:'missing',requestSource:'scheduler'})).rejects.toThrow();expect(leaf.call).not.toHaveBeenCalled();await f.service.close();expect(()=>f.service.getState(f.candidate.runId)).toThrow();await expect(f.service.perform({kind:'reserveNative',candidateId:f.candidate.candidateId,expectedLatestAttemptId:null,requestSource:'user'})).rejects.toThrow();}finally{await f.service.close();f.close();}});
it('assistant Main-only operations reject forged source and do not accept caller authority',async()=>{
 const f=fixture();try{
  for(const name of ['acceptAssistantCandidate','recoverAssistantCandidate','readAssistantOutput'] as const){
   const id=name==='readAssistantOutput'?{runId:f.candidate.runId}:{candidateId:'missing'};
   for(const input of [{...id,requestSource:'agent'},{...id,requestSource:'user',observation:{}},{...id,requestSource:'user',signal:new AbortController().signal}]){
    await expect(Promise.resolve().then(()=>(f.service as any)[name](input))).rejects.toThrow(/source|fields|input|data|unexpected/);
   }
  }
  await expect((f.service as any).acceptAssistantCandidate({candidateId:'missing',requestSource:'scheduler'})).rejects.toThrow('source');
  expect(leaf.call).not.toHaveBeenCalled();
 }finally{await f.service.close();f.close();}
});
it('reauthorization is a strict user action and never a scheduler fresh path',async()=>{const f=fixture();try{
 for(const requestSource of ['agent','scheduler'] as const)await expect(f.service.perform({kind:'reauthorizeNative',attemptId:'missing',expectedRevision:1,requestSource} as any)).rejects.toThrow('source');
 await expect(f.service.perform({kind:'reauthorizeNative',attemptId:'missing',expectedRevision:1,requestSource:'user',binding:{}} as any)).rejects.toThrow();
 await expect(f.service.perform({kind:'reauthorizeNative',attemptId:'missing',expectedRevision:1,requestSource:'user'} as any)).rejects.toThrow('missing');
 expect(leaf.call).not.toHaveBeenCalled();
 }finally{await f.service.close();f.close();}});
