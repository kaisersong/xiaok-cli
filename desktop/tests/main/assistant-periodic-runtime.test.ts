import {it,expect,vi} from 'vitest';import {LoopStore} from '../../electron/loop-store.js';
import {AssistantPeriodicRuntime} from '../../electron/assistant-periodic-runtime.js';
import {AssistantPeriodicPolicyService} from '../../electron/assistant-periodic-policy.js';
import {issueAssistantQualityQualification,readAssistantQualityQualification} from '../../../src/runtime/assistant/quality-qualification.js';
const now=Date.parse('2026-11-02T01:00:00Z'),binding={profileId:'default-personal-assistant' as const,sourceId:'internal',accountScopeHash:'a'.repeat(64),grantEpoch:1,window:{from:1,to:2}};
function fixture(qualified=true,dbPath=':memory:'){const store=new LoopStore(dbPath);
 const ids=Array.from({length:100},(_,i)=>'fact-'+i);const token=qualified?issueAssistantQualityQualification({binding,population:{complete:true,ids},protocol:{analysisContract:'qualified-test',version:'frozen-v1',riskRulesDigest:'b'.repeat(64),firstAnnotator:'person-one',secondAnnotator:'person-two'},cases:ids.map((id,i)=>({id,firstLabel:i<30?'needs_action':'wait',secondLabel:i<30?'needs_action':'wait',prediction:i<30?'needs_action':'wait',severe:false}))}):undefined;
 store.ensureBuiltInLoops(now);store.setLoopStatus('personal-assistant-transaction-check','active',now);
 store.ensureAssistantProfile({id:binding.profileId,status:'active',locale:'en',timeZone:'Asia/Shanghai',eveningTime:'22:30',morningTime:'08:30',quietHours:{start:'22:00',end:'08:00'},workdays:[1,2,3,4,5],dataScopes:['tasks'],createdAt:now,updatedAt:now});
 const complete=vi.fn(async()=>({text:JSON.stringify({schemaVersion:2,recommendations:[]}),usage:'unknown' as const,finish:'complete' as const}));
 const analysis={contract:{id:'qualified-test',provider:'test',model:'test',tokenizer:'test',protocolOverheadMeasured:true as const,maxOutputTokensEnforced:true as const,usageIncludesReasoningAndProtocol:true as const},measureInput:()=>100,complete};
 const policy=new AssistantPeriodicPolicyService({store,timeZone:'Asia/Shanghai',now:()=>now,qualification:()=>token?{qualityDigest:readAssistantQualityQualification(token,binding)!.reportDigest,analysisContract:analysis.contract.id}:undefined});
 if(token)policy.configure({enabled:true,notificationsEnabled:false,intervalMinutes:240,expectedRevision:0,requestSource:'user'});
 const collect=vi.fn(async()=>({snapshot:{current:{items:[]}},coverage:['task_snapshots','kswarm_projects','timed_actions','meeting_metadata','knowledge_source_metadata'].map(sourceId=>({sourceId,status:'checked',requestedWindow:{from:now-86400000,to:now},recordCount:0,includedCount:0,checkedAt:now,freshUntil:now+1800000})),isCurrent:()=>true}));
 const runtime=new AssistantPeriodicRuntime({store,policy,analysisPort:analysis,quality:token?{token,currentBinding:()=>binding}:undefined,collect,publish:async()=>{},now:()=>now});
 return {store,runtime,complete,analysis,policy,collect,quality:token?{token,currentBinding:()=>binding}:undefined};}
it('never calls a provider without real qualification capability',async()=>{const f=fixture(false);try{
 expect(await f.runtime.check({requestSource:'user',occurrenceId:'manual-one'})).toMatchObject({status:'blocked',reason:'quality_unverified'});expect(f.complete).not.toHaveBeenCalled();
}finally{f.store.close();}});
it('deduplicates one occurrence and charges unknown usage once through the durable budget owner',async()=>{const f=fixture();try{
 const input={requestSource:'user' as const,occurrenceId:'one'};
 await Promise.all([f.runtime.check(input),f.runtime.check(input)]);expect(f.complete).toHaveBeenCalledTimes(1);
 await f.runtime.check(input);expect(f.complete).toHaveBeenCalledTimes(1);
 const {createHash}=await import('node:crypto');expect(f.store.readAssistantAnalysisAttempt('assistant-check-'+createHash('sha256').update('one').digest('hex'))?.triggerSource).toBe('user');
}finally{f.store.close();}});
it('refuses a text-only/unenforced provider contract rather than falling back to existing morning analysis',async()=>{const f=fixture();try{
 (f.analysis.contract as any).maxOutputTokensEnforced=false;
 expect(await f.runtime.check({requestSource:'user',occurrenceId:'no-budget'})).toMatchObject({status:'blocked',reason:'budget_unavailable'});expect(f.complete).not.toHaveBeenCalled();
}finally{f.store.close();}});
it('coalesces simultaneous manual refreshes into at most one extra check',async()=>{const f=fixture();try{
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;}),original=f.collect.getMockImplementation()!;
 f.collect.mockImplementationOnce(async()=>{await pending;return original();});
 const first=f.runtime.check({requestSource:'user',occurrenceId:'first'});
 const second=f.runtime.check({requestSource:'user',occurrenceId:'second'}),third=f.runtime.check({requestSource:'user',occurrenceId:'third'});
 expect(await third).toEqual({status:'skipped',reason:'busy'});
 release();await Promise.all([first,second]);expect(f.complete).toHaveBeenCalledTimes(2);
}finally{f.store.close();}});
it('shutdown owns accepted collection work and blocks new analysis before provider dispatch',async()=>{const f=fixture();try{
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;}),original=f.collect.getMockImplementation()!;
 f.collect.mockImplementationOnce(async()=>{await pending;return original();});
 const checking=f.runtime.check({requestSource:'user',occurrenceId:'closing'});let closed=false;
 const stopping=f.runtime.close().then(()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);release();await Promise.all([checking,stopping]);expect(f.complete).not.toHaveBeenCalled();
 await expect(f.runtime.check({requestSource:'user',occurrenceId:'after-close'})).rejects.toThrow('closed');
}finally{f.store.close();}});
it('publishes through the real ordinary evidence owner and exposes the current action without making another model call',async()=>{
 const f=fixture();const {CompletionEvidenceStore}=await import('../../electron/completion-evidence-store.js');const {commitOrdinaryAssistantCheck}=await import('../../electron/assistant-periodic-runtime.js');const {createAssistantPublicationContextReader}=await import('../../electron/assistant-publication-context.js');const evidence=new CompletionEvidenceStore(':memory:');
 try{
  const result={schemaVersion:2,recommendations:[{title:'Review result',reasonCode:'result',evidenceRefs:[{kind:'task_snapshot',id:'known-task'}],action:{kind:'review',reason:'Read the evidence',nextStep:'Inspect the result',instruction:'Read the result without modifying source data.'}}]};
  f.complete.mockResolvedValue({text:JSON.stringify(result),usage:'unknown',finish:'complete'});
  const original=f.collect.getMockImplementation()!;f.collect.mockImplementation(async()=>{const value=await original();return {...value,snapshot:{current:{items:[{reference:{kind:'task_snapshot',id:'known-task'}}]}}};});
  const runtime=new AssistantPeriodicRuntime({store:f.store,policy:f.policy,analysisPort:f.analysis,quality:f.quality,collect:f.collect as any,now:()=>now,publish:async input=>commitOrdinaryAssistantCheck({...input,store:f.store,evidenceStore:evidence})});
  expect((await runtime.check({requestSource:'user',occurrenceId:'real-publication'})).status).toBe('success');
  const reader=createAssistantPublicationContextReader({store:f.store,evidenceStore:evidence,publication:{} as never});
  expect((await reader.readMorningActionSource())?.recommendations[0]?.action.instruction).toBe(result.recommendations[0]!.action.instruction);expect(f.complete).toHaveBeenCalledOnce();
 }finally{evidence.close();f.store.close();}
});
it('validates real published SQLite facts at the existing notification owner and blocks a paused source',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {CompletionEvidenceStore}=await import('../../electron/completion-evidence-store.js');
 const {commitOrdinaryAssistantCheck}=await import('../../electron/assistant-periodic-runtime.js');
 const {createAssistantPublicationContextReader}=await import('../../electron/assistant-publication-context.js');
 const {readAssistantDigestFacts}=await import('../../../src/runtime/assistant/digest-facts.js');
 const {ConversationActivityStore}=await import('../../../src/runtime/conversation-activity/store.js');
 const {ConversationActivityService}=await import('../../../src/runtime/conversation-activity/service.js');
 const clock=vi.spyOn(Date,'now').mockReturnValue(now);
 const root=mkdtempSync(join(tmpdir(),'assistant-cross-owner-')),f=fixture(true,join(root,'loop-evidence.sqlite')),evidence=new CompletionEvidenceStore(':memory:'),activity=new ConversationActivityStore(join(root,'activity.sqlite'));
 const notify=vi.fn(async()=> 'shown' as const),owner=new ConversationActivityService({store:activity,profileId:'desktop-profile',actorId:'desktop-user',getThread:()=>null,canObserveWork:()=>false,assistantDigest:{readFacts:value=>readAssistantDigestFacts(root,value,()=>({qualityDigest:f.policy.status().qualityDigest!,analysisContract:f.analysis.contract.id})),now:()=>now,platformAvailable:()=>true,notify}});
 try{
  f.policy.configure({enabled:true,notificationsEnabled:true,intervalMinutes:240,expectedRevision:1,requestSource:'user'});
  f.complete.mockResolvedValue({text:JSON.stringify({schemaVersion:2,recommendations:[{title:'Review result',reasonCode:'result',evidenceRefs:[{kind:'task_snapshot',id:'known-task'}],action:{kind:'review',reason:'Read evidence',nextStep:'Inspect result',instruction:'Read result without modifying source data.'}}]}),usage:'unknown',finish:'complete'});
  const original=f.collect.getMockImplementation()!;f.collect.mockImplementation(async()=>({...await original(),snapshot:{current:{items:[{reference:{kind:'task_snapshot',id:'known-task'}}]}}}));
  let envelope:import('../../../src/runtime/assistant/notification-policy.js').AssistantDigestEnvelope|undefined;
  const runtime=new AssistantPeriodicRuntime({store:f.store,policy:f.policy,analysisPort:f.analysis,quality:f.quality,collect:f.collect as any,now:()=>now,publish:async input=>{
   await commitOrdinaryAssistantCheck({...input,store:f.store,evidenceStore:evidence});
   const source=await createAssistantPublicationContextReader({store:f.store,evidenceStore:evidence,publication:{} as never}).readMorningActionSource();if(!source)throw Error('missing source');
   const rows=f.store.projectAssistantActions(source,now),prepared=f.policy.prepareDigest({runId:input.runId,revisions:rows.map(p=>({workItemIdentity:p.workItemIdentity,notifiableRevision:'b'.repeat(64)})),isCurrent:input.isCurrent,requestSource:'scheduler'});
   if(prepared.status!=='prepared')throw Error('missing intent');envelope=prepared.envelope;
  }});
  expect((await runtime.check({requestSource:'user',occurrenceId:'cross-owner'})).status).toBe('success');if(!envelope)throw Error('missing envelope');
  expect(readAssistantDigestFacts(root,envelope)?.sourceCurrent).toBe(false);
  const delivery=new AssistantPeriodicPolicyService({store:f.store,timeZone:'Asia/Shanghai',now:()=>now,qualification:()=>({qualityDigest:f.policy.status().qualityDigest!,analysisContract:f.analysis.contract.id}),delivery:{available:async()=>true,send:async value=>owner.enqueueAssistantDigest(value,{requestSource:'scheduler'}),lookup:async id=>activity.getAssistantDigestReceipt(id)}});
  expect((await delivery.dispatchDigest(envelope,{requestSource:'scheduler'})).status).toBe('shown');expect(notify).toHaveBeenCalledOnce();
  expect(readAssistantDigestFacts(root,envelope)?.budgetAdmitted).toBe(true);
  const {DatabaseSync}=await import('node:sqlite');const fault=new DatabaseSync(join(root,'loop-evidence.sqlite'));try{fault.exec('DELETE FROM assistant_analysis_runs');}finally{fault.close();}
  expect(readAssistantDigestFacts(root,envelope)?.budgetAdmitted).toBe(false);
  f.store.setLoopStatus('personal-assistant-transaction-check','paused',now+1);expect(readAssistantDigestFacts(root,envelope)?.sourceCurrent).toBe(false);
  await delivery.dispatchDigest(envelope,{requestSource:'scheduler'});expect(notify).toHaveBeenCalledOnce();
 }finally{await owner.close();activity.close();evidence.close();f.store.close();rmSync(root,{recursive:true,force:true});clock.mockRestore();}
});
it('does not replace an unsent crash reservation with a new run or another provider request',async()=>{const f=fixture();try{
 const {createHash}=await import('node:crypto');const occurrence=createHash('sha256').update('reserved-crash').digest('hex');
 f.store.reserveAssistantAnalysis({attemptId:'assistant-check-'+occurrence,occurrenceId:occurrence,inputDigest:'f'.repeat(64),providerContract:'qualified-test',inputTokens:100,outputTokens:1000,requestSource:'scheduler',now});
 const before=f.store.listLoopRuns('personal-assistant-transaction-check',20).length;
 expect((await f.runtime.check({requestSource:'scheduler',occurrenceId:'reserved-crash'})).status).toBe('blocked');
 expect(f.collect).not.toHaveBeenCalled();expect(f.complete).not.toHaveBeenCalled();expect(f.store.listLoopRuns('personal-assistant-transaction-check',20)).toHaveLength(before);
}finally{f.store.close();}});
it('owns a provider that ignores abort until its actual promise settles, without starting a second request',async()=>{const f=fixture();let release!:()=>void;try{
 let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),pending=new Promise<void>(resolve=>{release=resolve;});
 f.complete.mockImplementationOnce(async()=>{entered();await pending;return {text:JSON.stringify({schemaVersion:2,recommendations:[]}),usage:'unknown',finish:'complete'};});
 const work=f.runtime.check({requestSource:'user',occurrenceId:'abort-ignoring-provider'});await started;let closed=false;
 const closing=f.runtime.close().then(()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);
 await expect(f.runtime.check({requestSource:'user',occurrenceId:'second'})).rejects.toThrow('closed');expect(f.complete).toHaveBeenCalledOnce();
 release();expect((await work).status).toBe('outcome_unknown');await closing;expect(closed).toBe(true);
}finally{release?.();f.store.close();}});
it('charges native contract-breach usage and disables that runtime before another provider call',async()=>{const f=fixture();try{
 const breach=Object.assign(Error('sanitized'),{code:'ASSISTANT_ANALYSIS_PROVIDER_CONTRACT_BREACH',usage:{inputTokens:20000,outputTokens:2000}});f.complete.mockRejectedValueOnce(breach);
 await f.runtime.check({requestSource:'user',occurrenceId:'native-breach'});
 const {createHash}=await import('node:crypto');expect(f.store.readAssistantAnalysisAttempt('assistant-check-'+createHash('sha256').update('native-breach').digest('hex'))).toMatchObject({state:'settled',chargedInput:20000,chargedOutput:2000});
 expect((await f.runtime.check({requestSource:'user',occurrenceId:'after-native-breach'}))).toMatchObject({status:'blocked',reason:'budget_unavailable'});expect(f.complete).toHaveBeenCalledOnce();
}finally{f.store.close();}});

it('joins the real provider Promise metadata tail before negative close can settle',async()=>{const f=fixture();let release!:()=>void;try{const tail=new Promise<void>(yes=>{release=yes;});const raw=Promise.resolve({text:JSON.stringify({schemaVersion:2,recommendations:[]}),usage:'unknown' as const,finish:'complete' as const});Object.defineProperty(raw,Symbol('provider-tail'),{value:tail});f.complete.mockImplementationOnce(()=>raw);await f.runtime.check({requestSource:'user',occurrenceId:'provider-return-tail'});let closed=false;const closing=f.runtime.close().then(()=>{closed=true;});await Promise.resolve();await Promise.resolve();expect(closed).toBe(false);release();await closing;expect(closed).toBe(true);}finally{release?.();f.store.close();}});
it('retains a bare undefined provider rejection through actual negative close',async()=>{const f=fixture();try{f.complete.mockRejectedValueOnce(undefined);expect((await f.runtime.check({requestSource:'user',occurrenceId:'provider-undefined'})).status).toBe('outcome_unknown');await expect(f.runtime.close()).rejects.toBeUndefined();expect(f.complete).toHaveBeenCalledOnce();}finally{f.store.close();}});
