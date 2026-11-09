import {it,expect} from 'vitest';import {LoopStore} from '../../electron/loop-store.js';
import {AssistantAnalysisBudget} from '../../electron/assistant-analysis-budget.js';
const base={requestSource:'scheduler' as const,attemptId:'attempt-one',occurrenceId:'occurrence-one',inputDigest:'a'.repeat(64),providerContract:'test-provider-tokenizer-v1',inputTokens:8000,outputTokens:1000,now:1000000};
it('reserves atomically, binds retries to content, and blocks a seventh analysis',()=>{const store=new LoopStore(':memory:');try{
 const budget=new AssistantAnalysisBudget(store,{now:()=>base.now});expect(budget.reserve(base).state).toBe('reserved');expect(budget.reserve(base).state).toBe('reserved');
 expect(()=>budget.reserve({...base,inputDigest:'b'.repeat(64)})).toThrow('conflict');
 for(let i=1;i<6;i++)budget.reserve({...base,attemptId:'attempt-'+i,occurrenceId:'occurrence-'+i});
 expect(()=>budget.reserve({...base,attemptId:'seventh',occurrenceId:'seventh'})).toThrow('exhausted');
}finally{store.close();}});
it('unknown usage and sent crash never refund or resend; rollback cannot reset allowance',()=>{const store=new LoopStore(':memory:');try{
 let observed=base.now;const budget=new AssistantAnalysisBudget(store,{now:()=>observed});budget.reserve(base);expect(budget.sent({attemptId:base.attemptId,requestSource:'scheduler'}).state).toBe('sent');
 expect(()=>budget.sent({attemptId:base.attemptId,requestSource:'scheduler'})).toThrow('already_sent');
 observed=1;budget.settle({attemptId:base.attemptId,requestSource:'scheduler',usage:'unknown'});
 expect(budget.read(base.attemptId)).toMatchObject({state:'settled',chargedInput:8000,chargedOutput:1000});
 expect(()=>budget.reserve({...base,attemptId:'huge',occurrenceId:'huge',inputTokens:48000})).toThrow('exhausted');
}finally{store.close();}});
it('rejects agent writes and cannot settle an unsent reservation',()=>{const store=new LoopStore(':memory:');try{
 const budget=new AssistantAnalysisBudget(store,{now:()=>base.now});expect(()=>budget.reserve({...base,requestSource:'agent'})).toThrow('denied');budget.reserve(base);
 expect(()=>budget.settle({attemptId:base.attemptId,requestSource:'scheduler',usage:'unknown'})).toThrow('not_sent');
}finally{store.close();}});
it('does not trust a caller-supplied future timestamp to reset the main-owned budget window',()=>{const store=new LoopStore(':memory:');try{
 const budget=new AssistantAnalysisBudget(store,{now:()=>base.now});
 for(let i=0;i<6;i++)budget.reserve({...base,attemptId:'clock-'+i,occurrenceId:'clock-'+i,now:base.now+i*86400000} as any);
 expect(()=>budget.reserve({...base,attemptId:'clock-bypass',occurrenceId:'clock-bypass',now:base.now+100*86400000} as any)).toThrow('exhausted');
}finally{store.close();}});
