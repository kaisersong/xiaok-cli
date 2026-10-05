import {expect,it} from 'vitest';
import {createIntentPlan} from '../../../src/ai/intent-delegation/planner.js';
import {parseIntentBusinessContract,intentBusinessContractHash} from '../../../src/runtime/verification/intent-business-contract.js';
const definition=()=>({version:1,obligations:[{obligationId:'original',predicateId:'original-content',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'content',path:'result.md',sha256:'a'.repeat(64),structure:'utf8'}]}}]});
function contract(input='请根据 /tmp/original.md 写报告，然后生成幻灯片'){
 const result=createIntentPlan({instanceId:'host-instance',sessionId:'actual-session',input,skills:[]});if(result.kind!=='plan')throw Error('fixture expected original planner plan');
 const {instanceId,continuationMode,steps,...plan}=result.plan;
 return {version:1,...plan,verification:definition(),stages:plan.stages.map(stage=>({...stage,steps:stage.steps.map(({status,...step})=>step),verification:definition()}))};
}
it('captures the real multi-stage planner contract and every original independent recipe without status claims',()=>{
 const raw=contract();expect(raw.stages.length).toBeGreaterThan(1);const parsed=parseIntentBusinessContract(raw);
 expect(parsed).toEqual(raw);expect(Object.isFrozen(parsed)).toBe(true);expect(Object.isFrozen(parsed.stages[0].steps)).toBe(true);expect(Object.isFrozen(parsed.stages[0].verification.obligations[0].recipe)).toBe(true);
 const before=intentBusinessContractHash(parsed);raw.stages[0].verification.obligations[0].recipe.checks[0].sha256='b'.repeat(64);raw.explicitConstraints.push('caller late edit');expect(intentBusinessContractHash(parsed)).toBe(before);expect(intentBusinessContractHash(raw)).not.toBe(before);
});
it('accepts a real single-stage plan and preserves raw wording, paths and repeated user constraints',()=>{
 const raw=contract('请根据 /tmp/a.md 写一份中文报告');raw.explicitConstraints=[' 完整原文 ',' 完整原文 '];raw.delegationBoundary=['仅原始材料'];const parsed=parseIntentBusinessContract(raw);
 expect(parsed.intentMode).toBe('single_stage');expect(parsed.stages).toHaveLength(1);expect(parsed.providedSourcePaths).toContain('/tmp/a.md');expect(parsed.explicitConstraints).toEqual(raw.explicitConstraints);expect(parsed.rawIntent).toBe(raw.rawIntent);
});
it.each(['overallStatus','artifacts','activeStageId','ownerId','profileId','executionTerminals'])('rejects top-level authority or mutable field %s',key=>expect(()=>parseIntentBusinessContract({...contract(),[key]:[]})).toThrow());
it.each(['status','semanticValidation','structuralValidation','latestArtifactId'])('rejects stage completion field %s',key=>{const raw:any=contract();raw.stages[0][key]='passed';expect(()=>parseIntentBusinessContract(raw)).toThrow();});
it('rejects absent definitions and incomplete stage obligation declarations',()=>{
 const raw:any=contract();delete raw.verification;expect(()=>parseIntentBusinessContract(raw)).toThrow();const other:any=contract();delete other.stages[0].verification;expect(()=>parseIntentBusinessContract(other)).toThrow();const empty=contract();empty.stages[0].verification.obligations=[];expect(()=>parseIntentBusinessContract(empty)).toThrow();
});
it('rejects changed graph shape, duplicate IDs, forward dependencies and a cyclic contract',()=>{
 const base=contract();for(const change of [(r:any)=>r.stages[1].stageId=r.stages[0].stageId,(r:any)=>r.stages[0].dependsOnStageIds=[r.stages[1].stageId],(r:any)=>r.stages[1].dependsOnStageIds=['foreign'],(r:any)=>r.stages[1].dependsOnStageIds=[r.stages[0].stageId,r.stages[0].stageId],(r:any)=>r.stages[1].steps[0].stepId=r.stages[0].steps[0].stepId,(r:any)=>r.stages[0].steps[0].dependsOn=[r.stages[0].steps[1].stepId],(r:any)=>r.stages.reverse(),(r:any)=>r.stages[0].steps.reverse(),(r:any)=>r.intentMode='single_stage']){const raw=structuredClone(base);change(raw);expect(()=>parseIntentBusinessContract(raw)).toThrow();}
});
it('never drops unknown recipe fields or manufactures expected output',()=>{
 const raw:any=contract();raw.stages[0].verification.obligations[0].recipe.checks[0].callerApproval=true;expect(()=>parseIntentBusinessContract(raw)).toThrow();const missing:any=contract();delete missing.verification.obligations[0].recipe.checks[0].sha256;expect(()=>parseIntentBusinessContract(missing)).toThrow();
});
it('keeps complete large text up to whole contract limit instead of an arbitrary short field limit',()=>{
 const raw=contract('请写一份中文报告');raw.rawIntent='原'.repeat(5000);expect(parseIntentBusinessContract(raw).rawIntent).toBe(raw.rawIntent);raw.rawIntent='原'.repeat(23000);expect(()=>parseIntentBusinessContract(raw)).toThrow();
});
it('rejects accessors, symbols, cycles and nonplain data without invoking getters',()=>{
 const raw=contract();let calls=0;Object.defineProperty(raw.stages[0],'label',{enumerable:true,get(){calls++;return 'changed';}});expect(()=>parseIntentBusinessContract(raw)).toThrow();expect(calls).toBe(0);
 const symbol:any=contract();symbol.stages[0][Symbol('hidden')]=1;expect(()=>parseIntentBusinessContract(symbol)).toThrow();const cycle:any=contract();cycle.stages[0].steps[0].dependsOn=[cycle];expect(()=>parseIntentBusinessContract(cycle)).toThrow();
});
it('freezes all twelve v1 roles and rejects unknown future roles',()=>{
 const raw=contract('请写一份中文报告');for(const role of ['collect','inspect_current','normalize','identify_delta','extract','compare','compose','rewrite','structure','conclude','validate','finalize']){const value:any=structuredClone(raw);value.stages[0].steps[0].role=role;expect(parseIntentBusinessContract(value).stages[0].steps[0].role).toBe(role);}const future:any=structuredClone(raw);future.stages[0].steps[0].role='new_future_role';expect(()=>parseIntentBusinessContract(future)).toThrow();
});
it('requires explicit paths and a nonempty executable step chain',()=>{
 const missing:any=contract();delete missing.providedSourcePaths;expect(()=>parseIntentBusinessContract(missing)).toThrow();const empty=contract();empty.stages[0].steps=[];expect(()=>parseIntentBusinessContract(empty)).toThrow();
});
it('checks the complete canonical input and returned value at the actual 65536-byte boundary',async()=>{
 const {canonicalVerificationJson:json}=await import('../../../src/runtime/verification/protocol.js');const raw=contract('请写一份中文报告');raw.rawIntent='';const originalBytes=Buffer.byteLength(json(raw));raw.rawIntent='x'.repeat(65536-originalBytes);
 expect(Buffer.byteLength(json(raw))).toBe(65536);const value=parseIntentBusinessContract(raw);expect(Buffer.byteLength(json(value))).toBe(65536);expect(value.rawIntent).toBe(raw.rawIntent);
 raw.rawIntent+='x';expect(()=>parseIntentBusinessContract(raw)).toThrow('intent_contract_limit');
});
