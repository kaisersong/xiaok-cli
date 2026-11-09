// @vitest-environment node
import {expect,it} from 'vitest';
import {assistantDerivedFixture} from '../support/assistant-derived-test-fixture.js';
import {createAssistantRuntime} from '../../electron/assistant-runtime.js';
import {prepareAssistantProtectedInternalContext} from '../../electron/assistant-derived-lineage.js';
function protectMorning(f:ReturnType<typeof assistantDerivedFixture>){
 const definition={version:1 as const,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject' as const,recipe:{kind:'artifact-content' as const,checks:[{id:'check',path:'report',sha256:'a'.repeat(64),structure:'bytes' as const}]}}]};
 f.store.saveLoopPublicationConfiguration({loopId:'personal-assistant-morning-briefing',expectedRevision:null,requestSource:'user',now:f.now,configuration:{version:1,contract:{kind:'assistant',assistantKind:'morning',objective:'Original',completionCriterion:'Original'},verificationDefinitions:{run:definition,stages:{}}}});
}
it('still rejects a genuine stored historical external parent before any protected LLM or producer write',async()=>{
 const f=assistantDerivedFixture();try{await f.connect();const begin=f.store.beginLoopRun('personal-assistant-evening-reflection',{kind:'manual'},f.now-1,1000,{requestSource:'user'});if(begin.status!=='started')throw Error('fixture');
  // Actual historical-schema fixture through the original writer, not a Native
  // grant. The new publisher must refuse this external parent regardless.
  const capture=await f.ports.derived.beginCapture({kind:'morning',profile:f.profile,now:f.now}).finish({items:[]});f.ports.derived.recordCollection(begin.run.id,capture.lineage,capture.isCurrent);f.store.finishAssistantLoopRunSuccess(begin.run.id,[],f.now,'Historical calendar-derived summary');
  protectMorning(f);let completions=0;expect((await f.run(()=>{completions++;})).status).toBe('failed');expect(completions).toBe(0);expect(f.lease.database.prepare('SELECT count(*) AS n FROM loop_producer_results').get()!.n).toBe(0);expect(f.store.readAssistantDerivedLineage(begin.run.id)?.calendar).toBeDefined();
 }finally{await f.close();}
});
it('rechecks actual internal parent visibility after the protected LLM await and before original producer effects',async()=>{
 const f=assistantDerivedFixture();try{const evening=createAssistantRuntime({loopStore:f.store,evidenceStore:f.evidence,derived:f.ports.derived,now:()=>f.now,collect:()=>({items:[]}),llmPort:{complete:async()=>({text:JSON.stringify({summary:'Internal source',candidates:[]})})}});expect((await evening.runLoopNow('personal-assistant-evening-reflection',undefined,undefined,{requestSource:'user'})).status).toBe('success');
  protectMorning(f);let completions=0;expect((await f.run(()=>{completions++;f.store.setAssistantProfileStatus('default-personal-assistant','paused',f.now+1);})).status).toBe('failed');expect(completions).toBe(1);expect(f.lease.database.prepare('SELECT count(*) AS n FROM loop_producer_results').get()!.n).toBe(0);
 }finally{await f.close();}
});
it('does not turn a caller data object, reserved external key or proxy into an internal dependency approval',()=>{
 let traps=0;const proxy=new Proxy({derivedRunIds:[]},{ownKeys(){traps++;throw Error('trap');},get(){traps++;throw Error('trap');}}),visibility={readLineage(){throw Error('unexpected_read');},isRunVisible(){return false;},isCandidateVisible(){return false;},isEvidenceVisible(){return false;}};
 expect(()=>prepareAssistantProtectedInternalContext(proxy,visibility)).toThrow();expect(traps).toBe(0);
 for(const snapshot of [{calendar:{}},{current:{memories:[]}},{p2Context:{}},{derivedRunIds:['missing']},{derivedRunIds:null}])expect(()=>prepareAssistantProtectedInternalContext(snapshot,visibility)).toThrow();
});

it('preserves an original protected collector with no derived dependencies without treating the data helper as a producer grant',async()=>{
 const f=assistantDerivedFixture();try{protectMorning(f);const original={items:[]};let completions=0;const runtime=createAssistantRuntime({loopStore:f.store,evidenceStore:f.evidence,derived:f.ports.derived,now:()=>f.now,collect:()=>original,llmPort:{complete:async input=>{completions++;expect(JSON.parse(input.userMessage)).toEqual(original);return {text:JSON.stringify({recommendations:[]})};}}});expect((await runtime.runLoopNow('personal-assistant-morning-briefing',undefined,undefined,{requestSource:'user'})).status).toBe('publication_pending');expect(completions).toBe(1);const run=f.store.listLoopRuns('personal-assistant-morning-briefing',1)[0]!;expect(f.store.getLoopRunPublicationBasis(run.id)).toBeDefined();expect(f.store.isAssistantDerivedRunTracked(run.id)).toBe(false);
 }finally{await f.close();}
});
