import {expect,it} from 'vitest';

it('retains the original Desktop parser functions as the exact shared implementation',async()=>{
 const pairs=[
  [await import('../../../src/runtime/loop/publication-config.js'),await import('../../../desktop/electron/loop-publication-config.js'),['parseLoopPublicationConfiguration','freezeLoopPublicationValue']],
  [await import('../../../src/runtime/loop/publication-attempt.js'),await import('../../../desktop/electron/loop-publication-attempt.js'),['parseLoopPublicationAttempt','assertLoopPublicationTransition']],
  [await import('../../../src/runtime/loop/verification-execution.js'),await import('../../../desktop/electron/loop-verification-execution.js'),['parseLoopVerificationExecution','parseLoopVerificationCommand']],
  [await import('../../../src/runtime/loop/business-projection.js'),await import('../../../desktop/electron/loop-business-projection.js'),['validateLoopProjectionOrigin','normalizeLoopProjectionRows','loopProjectionHash']],
  [await import('../../../src/runtime/loop/promotion-intent.js'),await import('../../../desktop/electron/assistant-promotion-intent.js'),['parseAssistantPromotionIntent']],
  [await import('../../../src/runtime/loop/artifact-export-journal.js'),await import('../../../desktop/electron/loop-artifact-export-journal.js'),['parseLoopArtifactExportRecord','readLoopArtifactExportRow','advanceLoopArtifactExport']],
  [await import('../../../src/runtime/loop/producer-value.js'),await import('../../../desktop/electron/loop-scan-publication-body.js'),['captureLoopProducerValue']],
 ] as const;
 for(const [core,desktop,names] of pairs)for(const name of names){expect(typeof (core as Record<string,unknown>)[name]).toBe('function');expect((core as Record<string,unknown>)[name]).toBe((desktop as Record<string,unknown>)[name]);}
});
it('the shared producer capture still rejects an accessor without invoking it',async()=>{
 const{captureLoopProducerValue}=await import('../../../src/runtime/loop/producer-value.js');let called=0;
 expect(()=>captureLoopProducerValue({get input(){called++;return 'freeform';}})).toThrow('loop_producer_accessor');expect(called).toBe(0);
 expect(captureLoopProducerValue({input:'original',optional:undefined})).toEqual({input:'original'});
});
it('shares the original projection decision-overlay check for individual streamed members',async()=>{
 const projection=await import('../../../src/runtime/loop/business-projection.js');
 const check=(projection as unknown as {assertLoopProjectedMember:(actual:unknown,after:unknown)=>void}).assertLoopProjectedMember;
 expect(typeof check).toBe('function');
 const after={id:'original',run_id:'run',content:'original body',status:'pending',target_kind:null,target_id:null,accepted_target_ref:null,decided_at:null};
 const accepted={...after,status:'accepted',target_kind:'memory',target_id:'target',accepted_target_ref:'actual reference',decided_at:12};
 expect(()=>check(accepted,after)).not.toThrow();expect(accepted.status).toBe('accepted');
 expect(()=>check({...accepted,content:'replacement'},after)).toThrow('loop_projection_member_changed');
 expect(()=>check({...accepted,accepted_target_ref:null},after)).toThrow('loop_projection_decision');
 expect(()=>check({...accepted,status:'accepting',decided_at:null},after)).toThrow('loop_projection_decision');
 expect(()=>check({...accepted,status:'staged'},after)).toThrow('loop_projection_decision');
});
