import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readRegistrationLiteral,readHubRegistrationFacts,validateHubProducerRegistration,validateRetainedEntrypoints} from '../../scripts/verification/check-dsh-producer-registration.mjs';
const moduleUrl=new URL('../../scripts/verification/check-dsh-producer-registration.mjs',import.meta.url);
test('the executable original Hub registration checker exists',async()=>{
 const api=existsSync(moduleUrl)?await import(moduleUrl):{};
 assert.equal(typeof api.checkDshProducerRegistration,'function');
});
test('CI checks that the expected original runtime cases actually passed without skip',async()=>{
 const api=await import(moduleUrl);assert.equal(typeof api.assertExecutedRegistrationCases,'function');
 api.assertExecutedRegistrationCases('ok 1 - original case\n',['original case']);
 assert.throws(()=>api.assertExecutedRegistrationCases('ok 1 - empty-file.js\n',['original case']));
 assert.throws(()=>api.assertExecutedRegistrationCases('ok 1 - original case # SKIP unavailable\n',['original case']));
});
test('actual returned Hub keys reject a late Object.assign alias outside the wrapped birth surface',async()=>{
 const api=await import(moduleUrl);assert.equal(typeof api.validateReturnedHubProducerSurface,'function');
 const surface={publicKeys:['run','port'],ports:{port:['read']}};
 const hub={run(){},port:{read(){}}};api.validateReturnedHubProducerSurface(hub,surface);
 Object.assign(hub,{lateAlias:hub.run});assert.throws(()=>api.validateReturnedHubProducerSurface(hub,surface),/returned public API/);
 delete hub.lateAlias;Object.assign(hub.port,{lateMethod:hub.run});assert.throws(()=>api.validateReturnedHubProducerSurface(hub,surface),/returned port port/);
});
function fixture(){
 const recovery=['handleRecoverSubmission','handleResetTaskForRecovery','handleResumeTaskForRecovery','handleResumeSuspendedRuns','recoverInterruptedTaskWorkflows'],special=['mutateProjectState','dispatchWorkspaceTask','applyWorkspaceMapping','submitWorkspaceTaskResult'];
 const registration={schemaVersion:1,requiredRuntimeCases:['original case'],publicKeys:['createProject',...recovery,...special],ports:{},mutations:['createProject'],executionStart:[],recovery,migrationSafe:[],ordinarySpecialMutations:special,restoreProtocols:['dsh_owner_v1'],requirementRefs:['plan-block:0649'],positiveTests:['positive.js'],negativeTests:['negative.js']};
 const mutations=new Set([...registration.mutations,...special]);registration.producers=registration.publicKeys.map(name=>({name,surfaces:['public',...(mutations.has(name)?['mutation']:[]),...(recovery.includes(name)?['recovery']:[])],target:'project_arg0',dsh:mutations.has(name)?'deny':'original_reader',executionClass:'control',requirementRefs:registration.requirementRefs,positiveTests:registration.positiveTests,negativeTests:registration.negativeTests}));
 return {registration,surface:{publicKeys:[...registration.publicKeys],mutations:['createProject'],ports:{}},facts:{mutations:['createProject'],explicitPublic:['createProject'],publicAssignments:[],restoreProtocols:['dsh_owner_v1'],recoveryForwards:recovery.slice(2,4),recoveryTargets:[],targetCases:['project_arg0','workflow_run_arg0','workflow_proposal_arg0','object_workflow_run_id','domain','none'],executionReference:true,migrationReference:true}};
}
test('the same checker rejects a new public alias and a new public port method',()=>{
 const f=fixture();assert.equal(validateHubProducerRegistration(f.registration,f.surface,f.facts).publicApi,f.surface.publicKeys.length);
 f.surface.publicKeys.push('unregisteredMutation');assert.throws(()=>validateHubProducerRegistration(f.registration,f.surface,f.facts),/public API missing=unregisteredMutation/);
 const p=fixture();p.registration.ports={port:['read']};p.surface.ports={port:['read','unregistered']};assert.throws(()=>validateHubProducerRegistration(p.registration,p.surface,p.facts),/port port missing=unregistered/);
});
test('every producer descriptor rejects missing fields, unknown tags, duplicates and dangling references',()=>{
 for(const change of [f=>delete f.registration.producers[0].target,f=>f.registration.producers[0].target='caller_callback',f=>f.registration.producers[0].dsh='allow',f=>f.registration.producers[0].executionClass='new_root',f=>f.registration.producers[0].positiveTests=['missing.js'],f=>f.registration.producers.push(f.registration.producers[0]),f=>f.registration.producers[0].surfaces=['public'],f=>f.registration.producers[0].dsh='original_reader']){
  const f=fixture();change(f);assert.throws(()=>validateHubProducerRegistration(f.registration,f.surface,f.facts));
 }
});
test('runtime/source mutations, explicit aliases and early recovery cannot silently omit registration',()=>{
 for(const change of [f=>f.facts.mutations.push('newMutation'),f=>f.facts.publicAssignments.push('rawAlias'),f=>f.facts.recoveryForwards.push('newRecovery'),f=>f.facts.recoveryTargets.push({name:'handleResumeTaskForRecovery',target:'callerHandler'}),f=>f.facts.targetCases.push('caller_callback'),f=>f.facts.executionReference=false,f=>f.registration.recovery.splice(0,1)]){
  const f=fixture();change(f);assert.throws(()=>validateHubProducerRegistration(f.registration,f.surface,f.facts));
 }
});
test('fixed registration data is parsed without running constructors or callbacks',()=>{
 assert.throws(()=>readRegistrationLiteral('export const HUB_PRODUCER_REGISTRATION=executeCaller();'),/fixed data literal/);
 assert.throws(()=>readRegistrationLiteral('export const HUB_PRODUCER_REGISTRATION=deepFreeze({get value(){throw Error("must not execute")}});'),/strict JSON/);
 assert.equal(readRegistrationLiteral('export const HUB_PRODUCER_REGISTRATION=deepFreeze({"schemaVersion":1});').schemaVersion,1);
});
test('the AST checker observes actual alias assignment and recovery forwarding syntax',()=>{
 const text=`const mutations={createProject};const publicApi={createProject,...persisted};publicApi.rawAlias=publicApi.mutateProjectState;for(let i=0;i<HUB_PRODUCER_REGISTRATION.executionStart.length;i++){};const policy=HUB_PRODUCER_REGISTRATION.migrationSafe;if(p.requiredProtocol==='dsh_owner_v1'){};if(name==='hiddenRecovery')return hiddenRecovery(...args);`;
 const facts=readHubRegistrationFacts(text);assert.deepEqual(facts.publicAssignments,['rawAlias']);assert.deepEqual(facts.recoveryForwards,['hiddenRecovery']);assert.equal(facts.executionReference,true);
});
test('retention never permits dropped original entries or an auto-eligibility flip',()=>{
 const manifest={approvedPlanSha256:'7254fc52300c3dde48aa466bd1d17985695b91e30ef0e263a39a5f8a5bb68f74',complete:false,currentAutoEligible:false,entries:[]};assert.throws(()=>validateRetainedEntrypoints(manifest),/535/);
 assert.throws(()=>validateRetainedEntrypoints({...manifest,complete:true}),/unqualified/);
});
