import '../../support/installed-controller-fixture.js';
import {it,expect,vi} from 'vitest';
const installed=vi.hoisted(()=>({factory:undefined as any,route:undefined as any}));
vi.mock('../../../src/runtime/verification/controller-client.js',async original=>({...await original<typeof import('../../../src/runtime/verification/controller-client.js')>(),createInstalledVerificationClient:()=>installed.factory()}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:(owner:any)=>installed.route(owner)}));
import {createHash} from 'node:crypto';
import {Session as InspectorSession} from 'node:inspector';
import {writeFileSync} from 'node:fs';
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
import {loopPublicationReceiver} from '../../support/loop-publication-receiver.js';
import {intentApplicationCandidate} from '../../support/intent-application-fixture.js';
import {createIntentApplicationBinding,intentApplicationBindingHash} from '../../../src/runtime/verification/intent-application-binding.js';
import {intentHostSubjectOwner} from '../../../src/runtime/verification/intent-host-subject.js';
import {goalVerificationRegistration} from '../../../src/runtime/goal/verification-definition.js';
import {createApplicationBindingAuthority} from '../../../src/runtime/verification/application-binding-authority.js';
import {applicationBindingReviewBytes} from '../../../src/runtime/verification/application-binding-review.js';
import {canonicalVerificationJson as json,hashVerificationTuple} from '../../../src/runtime/verification/protocol.js';
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex'),signal=()=>new AbortController().signal;
async function fixture(afterQuery?:()=>void,options:Parameters<typeof verifiedOperationFixture>[1]={}){
 const f=await verifiedOperationFixture('dispatch',options),raw=structuredClone(intentApplicationCandidate()),recipe={kind:'artifact-content' as const,checks:[{id:'content',path:'result',sha256:hash('result'),structure:'bytes' as const}]},definition={version:1 as const,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject' as const,recipe}]};
 raw.contract.verification=definition;for(const stage of raw.contract.stages)stage.verification=definition;
 const contract=raw.contract,subjects=[...contract.stages.map((s:any)=>({...raw.subject,stageId:s.stageId})),{...raw.subject,stageId:null}],owners:any[]=[];
 for(const subject of subjects){const prepared:any=await f.composition.public.invoke('completion.prepare-owner',{enrollment:{...intentHostSubjectOwner(subject),intentContract:{subject,contract},invocations:[]},registration:goalVerificationRegistration(definition)},f.peer);const actual:any=await f.composition.public.invoke('completion.authorize-owner',{challengeId:prepared.challengeId},f.peer);owners.push(actual.owner);}
 const receiver=await loopPublicationReceiver(f,{afterQuery}),bindings:any[]=[];
 try{
  for(let i=0;i<contract.stages.length;i++){
   const stage=contract.stages[i],subject=subjects[i],binding=createIntentApplicationBinding({...raw,subject,candidateId:`candidate-${i}`,body:{kind:'intent-stage',stageId:stage.stageId,summary:'actual result',executionReports:[],artifacts:[]}});bindings.push(binding);

   const application=createApplicationBindingAuthority({database:f.database,authorityId:'authority',completion:f.composition,clock:f.clock,assertCurrent(){},resolvePrincipal:p=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid' as const}),async approve(review){return {uid:f.peer.uid,auditSessionId:f.peer.auditSessionId,reviewHash:hash(applicationBindingReviewBytes(review))};}});
   try{const prepared=application.prepare({requestSource:'user',binding},f.peer);await application.authorize({requestSource:'user',challengeId:prepared.challengeId},f.peer,signal());}finally{application.close();}
   const invocation={sessionIdentity:contract.sessionId,compoundOperationId:`stage-${i}`,validationInvocationId:`verification-${i}`};
   const add:any=await f.composition.public.invoke('completion.prepare-owner',{enrollment:{...intentHostSubjectOwner(subject),invocations:[invocation]},registration:goalVerificationRegistration(definition)},f.peer);await f.composition.public.invoke('completion.authorize-owner',{challengeId:add.challengeId},f.peer);
   const selected=await f.material.prepare({purpose:'isolated-command',invocation,materials:[{path:'/workspace/a',byteLimit:1}],exactCommand:{argv:['/bin/true'],cwdRelative:'.'},expiresAt:105000},f.peer,signal());const grant=await f.material.authorize(selected.challengeId,f.peer,signal());const staged=await f.material.stage({grantHandle:grant,invocation},f.peer,signal());
   const operation=await f.operations.prepare({mountPlanHandle:staged.mountPlanHandle,obligationId:'original',expectedAttemptEpoch:0,requestSource:'agent'},f.peer,signal());await f.operations.dispatch({operationHandle:operation.operationHandle},f.peer,signal());
   const pub=receiver.publication.prepare({...intentHostSubjectOwner(subject),requestSource:'user'},f.peer);await receiver.publication.approve({challengeId:pub.challengeId},f.peer,signal());
  }
 }catch(error){await receiver.close();await f.close();throw error;}
 return {f,receiver,subjects,owners,bindings,contract,async close(){await receiver.close();await f.close();}};
}

import * as sqlParsing from '../../../src/runtime/verification/intent-sql-parsing-context.js';
import * as envelopeDecoder from '../../../src/runtime/verification/intent-contract-enrollment.js';
it('reuses pure SQL contracts across every actual dependency, completion and inspect frame',async()=>{
 const f=await fixture(),original=envelopeDecoder.parseIntentContractEnrollment;let actual=0,active='setup';const records:any[]=[],stack:any[]=[],results:any[]=[],coverages:any[]=[];const originalContext=sqlParsing.withIntentSqlParsingContext,originalRead=sqlParsing.readIntentSqlContract;
 const contextSpy=vi.spyOn(sqlParsing,'withIntentSqlParsingContext').mockImplementation((db,fn)=>{const frame={active,attempts:0,decodes:0,stack:new Error().stack};records.push(frame);stack.push(frame);try{return originalContext(db,fn);}finally{stack.pop();}});
 const readSpy=vi.spyOn(sqlParsing,'readIntentSqlContract').mockImplementation((db,raw)=>{const caller=new Error().stack?.split('\n').find(line=>/\/src\/runtime\/verification\/owner-enrollment-authority\.(?:ts|js):\d+:\d+\)?\s*$/.test(line.replace(/\\/g,'/')))?.match(/at (\w+)/)?.[1];if(stack.length)stack.at(-1).attempts++;const binding=originalRead(db,raw);results.push({active,caller,subject:binding.subject});return binding;});
 const spy=vi.spyOn(envelopeDecoder,'parseIntentContractEnrollment').mockImplementation(raw=>{actual++;if(stack.length)stack.at(-1).decodes++;return original(raw);});
 const assertPath=(total:number,sha:string,frameCount:number,contextAttempts:number,miss:number,distribution:number[][])=>{
  const entries=results.filter(e=>e.active===active),frames=records.filter(e=>e.active===active);
  expect(entries).toHaveLength(total);expect(createHash('sha256').update(JSON.stringify(entries.map(e=>[e.caller,e.subject]))).digest('hex')).toBe(sha);
  expect(frames).toHaveLength(frameCount);expect(frames.map(f=>[f.attempts,f.decodes]).sort((a,b)=>a[0]-b[0])).toEqual(distribution);
  expect(frames.reduce((n,f)=>n+f.attempts,0)).toBe(contextAttempts);expect(frames.reduce((n,f)=>n+f.decodes,0)).toBe(miss);
  for(const frame of frames.filter(f=>f.attempts===0))expect(frame.stack).toContain('acceptReceiverReply');
  expect(total-contextAttempts).toBe(total===32?0:41);expect(contextAttempts-miss).toBe(total===32?31:1021);
 };
 const fullFrames=[[0,0],[0,0],[7,1],...Array.from({length:20},()=>[16,1]),...Array.from({length:20},()=>[32,1]),[96,1]];
 const inspector=new InspectorSession();inspector.connect();const post=(method:string,params={})=>new Promise<any>((resolve,reject)=>inspector.post(method as any,params,(error,result)=>error?reject(error):resolve(result)));
 await post('Profiler.enable');await post('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
 const assertAllDecoders=async(expected:number)=>{
  const value=await post('Profiler.takePreciseCoverage');
  const scripts=value.result.filter((script:any)=>/\/src\/runtime\/verification\/intent-contract-enrollment\.(?:ts|js)$/.test(script.url.replace(/\\/g,'/')));
  expect(scripts).toHaveLength(1);
  const functions=scripts[0].functions.filter((fn:any)=>fn.functionName==='parseIntentContractEnrollment');
  expect(functions).toHaveLength(1);expect(functions[0].ranges.length).toBeGreaterThan(0);
  const count=functions[0].ranges[0].count;
  coverages.push({active,script:scripts[0].url,functionCount:functions.length,count,expected});
  expect(count).toBe(expected);
 };


 try{
  active='dependencies-parent';actual=0;const dependencies=await f.receiver.publication.observeIntentDependencies({subject:f.subjects.at(-1)},f.f.peer,signal());expect(dependencies.publications).toHaveLength(2);expect(actual).toBe(83);assertPath(1104,active==='dependencies-parent'?'96c045892e4974fd006128d23bf2ec02d99da9c95b478299014ed1f44ef69615':'359b97c3239c0316d1e390d1ec40d1a8fb9915be9d2dfb73258eadd50c42b0fb',44,1063,42,fullFrames);await assertAllDecoders(645);
  active='completion-last-stage';actual=0;const completion=await f.receiver.publication.observeIntentCompletion({subject:f.subjects[1]},f.f.peer,signal());expect(completion.publications).toHaveLength(2);expect(actual).toBe(83);assertPath(1104,active==='dependencies-parent'?'96c045892e4974fd006128d23bf2ec02d99da9c95b478299014ed1f44ef69615':'359b97c3239c0316d1e390d1ec40d1a8fb9915be9d2dfb73258eadd50c42b0fb',44,1063,42,fullFrames);await assertAllDecoders(645);
  active='setup';const opened=f.f.composition.privateHost.enrollment.openOwner(intentHostSubjectOwner(f.subjects[1]),f.f.peer);await post('Profiler.takePreciseCoverage');active='completion-inspect';actual=0;
  const inspection:any=f.f.composition.public.invoke('completion.inspect',opened,f.f.peer);expect(inspection.currentVerification).toBe('valid');expect(actual).toBe(1);assertPath(32,'f5eee1f76115d2cfad3718f5aaabf65c36910588847365f91fd729e0809890e0',1,32,1,[[32,1]]);await assertAllDecoders(17);
 }finally{await post('Profiler.stopPreciseCoverage');inspector.disconnect();if(process.env.XIAOK_SQL_PARSE_CANDIDATE_OUTPUT)writeFileSync(process.env.XIAOK_SQL_PARSE_CANDIDATE_OUTPUT,JSON.stringify({records,results,coverages},null,2));spy.mockRestore();readSpy.mockRestore();contextSpy.mockRestore();await f.close();}
},50000);
