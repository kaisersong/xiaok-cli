import {expect,it} from 'vitest';
import {createIntentPlan} from '../../../src/ai/intent-delegation/planner.js';
import {createIntentBoundaryResolver} from '../../../src/ai/intent-delegation/boundary-resolver.js';
import {DEFAULT_INTENT_BOUNDARY_CONFIG} from '../../../src/types.js';
const input={sessionId:'real-session',instanceId:'real-host',input:'请写报告，然后生成幻灯片',skills:[]};
it('fixed host identity is used before every original stage/step/dependency is constructed',()=>{
 const value=createIntentPlan({...input,newIntentId:'intent-native-fixed'} as any);expect(value.kind).toBe('plan');if(value.kind!=='plan')throw Error('planner');expect(value.plan.intentId).toBe('intent-native-fixed');expect(value.plan.stages.length).toBeGreaterThan(1);for(const stage of value.plan.stages){expect(stage.stageId.startsWith('intent-native-fixed:stage:')).toBe(true);for(const step of stage.steps)expect(step.stepId.startsWith(stage.stageId+':step:')).toBe(true);for(const parent of stage.dependsOnStageIds)expect(parent.startsWith('intent-native-fixed:stage:')).toBe(true);}
});
it('the actual boundary resolver forwards the same preallocated identity through rule and validated construction',async()=>{
 const resolver=createIntentBoundaryResolver({config:{...DEFAULT_INTENT_BOUNDARY_CONFIG,llmClassifier:'off'}});const value=await resolver.resolve({...input,cwd:'/workspace',newIntentId:'intent-native-boundary'} as any);expect(value.kind).toBe('intent');if(value.kind==='intent')expect(value.plan.intentId).toBe('intent-native-boundary');
});
it('ordinary stable planner identity is unchanged and invalid explicit IDs are rejected',()=>{
 expect(createIntentPlan(input)).toEqual(createIntentPlan(input));for(const newIntentId of ['',{},'a\n','a'.repeat(161)])expect(()=>createIntentPlan({...input,newIntentId} as any)).toThrow('intent_planner_identity');
});
