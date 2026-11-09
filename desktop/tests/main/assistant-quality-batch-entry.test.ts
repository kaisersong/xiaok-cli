// @vitest-environment node
import {it,expect} from 'vitest';
import {LoopStore} from '../../electron/loop-store.js';
import {AssistantController} from '../../electron/assistant-controller.js';
it('starts the actual LoopStore analysis selection unconfigured without enabling periodic work',()=>{
 const store=new LoopStore(':memory:');try{expect(store.getAssistantAnalysisSelection()).toEqual({revision:0,modelId:null});}finally{store.close();}
});
it('keeps the real assistant Controller analysis mutation user-only before touching a settings port',async()=>{
 const controller=new AssistantController({assistantService:{bootstrap(){throw Error('unexpected');},setStatus(){throw Error('unexpected');}},candidates:{},memoryStore:{},memoryBackend:'layered',kbStore:{}} as never);
 await expect(controller.configureAnalysisProvider({modelId:'private-choice',expectedRevision:0,requestSource:'agent'} as never)).rejects.toThrow('assistant_analysis_user_only');
});
it('constructs a real persisted quality workflow with a default not-evaluated status and rejects scheduler mutation',async()=>{
 const store=new LoopStore(':memory:');try{
  const workflow=store.createAssistantQualityWorkflow({readCurrentModel:()=>({modelEpoch:1,configFingerprint:'a'.repeat(64)}),population:async()=>{throw Error('no_population');},save:async()=>false,open:async()=>null,confirmHumanReview:async()=>false});
  expect(workflow.status({requestSource:'user'}).state).toBe('not_evaluated');await expect(workflow.freeze({requestSource:'scheduler'})).rejects.toThrow('assistant_quality_source');
 }finally{store.close();}
});
