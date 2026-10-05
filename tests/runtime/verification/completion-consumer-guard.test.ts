import {beforeEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({value:{kind:'ordinary'} as any,calls:0}));
vi.mock('../../../src/runtime/verification/installed-completion-observation.js',()=>({observeInstalledCompletionSync(){state.calls++;return state.value;},async observeInstalledCompletion(){state.calls++;return state.value;}}));
import {validateCompletionEvidence} from '../../../src/runtime/guards/completion-evidence.js';
import {validateCompletionEvidenceAsync} from '../../../src/runtime/guards/completion-evidence-async.js';
import {evaluateArtifactEvidenceGuard,evaluateArtifactEvidenceGuardAsync} from '../../../src/runtime/guards/artifact-evidence-guard.js';
const answer={ownerKind:'task' as const,ownerId:'task',kind:'answer' as const,summary:'done',metadata:{responseId:'response'}},expectation={ownerKind:'task' as const,ownerId:'task',expectedKinds:['file_artifact' as const],source:'task_spec' as const,confidence:'explicit' as const};
const options=()=>({signal:new AbortController().signal,trackPending(_p:Promise<unknown>){}});
beforeEach(()=>{state.calls=0;state.value={kind:'ordinary'};});
it.each(['unavailable','needs_revalidation'] as const)('prevents answer OR and absent metadata from bypassing %s',async status=>{
 state.value=status==='unavailable'?{kind:'unavailable'}:{kind:'protected',state:{currentVerification:status}};
 for(const metadata of [{},{expectation,evidence:[answer]}]){
  const input={taskId:'task',status:'completed',...metadata};const sync=evaluateArtifactEvidenceGuard(input),asyncResult=await evaluateArtifactEvidenceGuardAsync(input,options());
  expect(sync).toMatchObject({ok:false,allowOverride:false});expect(asyncResult).toMatchObject({ok:false,allowOverride:false});
 }
 expect(state.calls).toBe(4);
});
it('both evidence drivers reobserve before accepting answer evidence',async()=>{
 const input={ownerKind:'task' as const,ownerId:'task',targetStatus:'completed',expectation:{...expectation,expectedKinds:['answer' as const]},evidence:[answer]};
 state.value={kind:'protected',state:{currentVerification:'valid'}};expect(validateCompletionEvidence(input).ok).toBe(true);
 state.value={kind:'protected',state:{currentVerification:'needs_revalidation'}};expect((await validateCompletionEvidenceAsync(input,options())).ok).toBe(false);expect(state.calls).toBe(2);
});
it('keeps ordinary completion and noncompletion behavior',async()=>{
 expect(evaluateArtifactEvidenceGuard({taskId:'task',status:'completed',expectation,evidence:[answer]}).ok).toBe(true);
 state.value={kind:'unavailable'};const before=state.calls;expect(evaluateArtifactEvidenceGuard({taskId:'task',status:'running'}).ok).toBe(true);expect(state.calls).toBe(before);
});
