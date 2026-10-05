import {expect,it} from 'vitest';
import {parseBusinessApplicationBinding,businessApplicationBindingHash,parseActiveBusinessApplicationBinding,businessApplicationOwner,sameBusinessApplicationSubject,businessApplicationEpoch} from '../../../src/runtime/verification/business-application-binding.js';
import {goalApplicationBindingHash} from '../../../src/runtime/verification/goal-application-binding.js';
import {createLoopApplicationBinding,loopApplicationBindingHash} from '../../../src/runtime/verification/loop-application-binding.js';
import {loopHostSubjectOwner} from '../../../src/runtime/verification/loop-host-subject.js';
const goal={version:1 as const,kind:'goal' as const,sessionId:'s',goalId:'g',epoch:1,objective:'Original',completionCriterion:null,expectedEvidenceKinds:[]};
function loop(){return createLoopApplicationBinding({version:1,kind:'loop',subject:{kind:'loop-run',loopId:'artifact-evidence-regression',runId:'r',stage:null},candidateId:'c',candidateRevision:1,originalTriggerJson:'{"kind":"manual"}',logicalRunKey:null,contract:{version:1,kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',objective:'Report',completionCriterion:'Original rules'},body:{kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',observedAt:1,summary:'Original',nextActionKind:'none',nextActionSummary:null,diagnostic:{kind:'artifact-evidence-regression',scannedOwnerCount:0,openAnomalyCount:0,resolvedAnomalyCount:0,anomalies:[]},artifacts:[]}});}
it('keeps original Goal bytes/hash/owner and explicit epoch semantics',()=>{
 expect(parseBusinessApplicationBinding(goal)).toEqual(goal);expect(businessApplicationBindingHash(goal)).toBe(goalApplicationBindingHash(goal));
 expect(businessApplicationOwner(goal)).toEqual({ownerKind:'goal',ownerId:'g'});expect(businessApplicationEpoch(goal)).toBe(1);
 expect(sameBusinessApplicationSubject(goal,{...goal,epoch:2,objective:'New'})).toBe(true);expect(sameBusinessApplicationSubject(goal,{...goal,sessionId:'other'})).toBe(false);
});
it('dispatches exact Loop binding and maps actual subject instead of accepting caller owner',()=>{
 const value=loop();expect(parseBusinessApplicationBinding(value)).toEqual(value);expect(businessApplicationBindingHash(value)).toBe(loopApplicationBindingHash(value));
 expect(businessApplicationOwner(value)).toEqual(loopHostSubjectOwner(value.subject));expect(businessApplicationEpoch(value)).toBe(1);
 expect(sameBusinessApplicationSubject(goal,value)).toBe(false);
 expect(()=>parseBusinessApplicationBinding({...goal,kind:'loop'})).toThrow();expect(()=>parseBusinessApplicationBinding({...value,kind:'goal'})).toThrow();
 expect(()=>parseBusinessApplicationBinding({...value,ownerKind:'goal'})).toThrow();
});
it.each(['goal','loop'])('checks the complete active wrapper hash/revision: %s',kind=>{
 const binding=kind==='goal'?goal:loop(),bindingHash=businessApplicationBindingHash(binding),active={binding,bindingHash,revision:3};
 expect(parseActiveBusinessApplicationBinding(active)).toEqual(active);expect(Object.isFrozen(parseActiveBusinessApplicationBinding(active))).toBe(true);
 expect(()=>parseActiveBusinessApplicationBinding({...active,bindingHash:'0'.repeat(64)})).toThrow();
 for(const revision of [0,1.5,Number.MAX_SAFE_INTEGER+1])expect(()=>parseActiveBusinessApplicationBinding({...active,revision})).toThrow();
 expect(()=>parseActiveBusinessApplicationBinding({...active,approval:true})).toThrow();
});
it('refuses unknown application kinds and accessors before kind dispatch',()=>{
 expect(()=>parseBusinessApplicationBinding({...goal,kind:'arbitrary'})).toThrow();let reads=0;
 expect(()=>parseBusinessApplicationBinding({...goal,get kind(){reads++;return 'goal';}})).toThrow();expect(reads).toBe(0);
});
