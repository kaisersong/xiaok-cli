import {it,expect,vi} from 'vitest';import {LoopStore} from '../../electron/loop-store.js';
import {createAssistantQualityPredictor} from '../../electron/assistant-quality-predictions.js';
it('uses the actual analysis port and shared durable budget, never accepts fabricated case IDs',async()=>{
 const store=new LoopStore(':memory:');const complete=vi.fn(async(input:{userMessage:string})=>({text:JSON.stringify(JSON.parse(input.userMessage).cases.map((row:{id:string})=>({id:row.id,prediction:'wait'}))),usage:'unknown' as const,finish:'complete' as const}));
 const port={contract:{id:'test',provider:'test',model:'test',tokenizer:'test',protocolOverheadMeasured:true as const,maxOutputTokensEnforced:true as const,usageIncludesReasoningAndProtocol:true as const},measureInput:()=>100,complete};
 try{const predict=createAssistantQualityPredictor({store,port,isCurrent:()=>true});const frozen={binding:{},population:{},protocol:{analysisContract:'test'},cases:[{id:'case-one',prediction:'unknown',severe:false}],facts:[{id:'case-one',title:'A real frozen fact',status:'tasks',updatedAt:1,severe:false}]};
 expect(await predict(frozen as any,'a'.repeat(64))).toEqual([{id:'case-one',prediction:'wait'}]);expect(complete).toHaveBeenCalledOnce();
 await expect(predict(frozen as any,'a'.repeat(64))).rejects.toThrow('already_sent');expect(complete).toHaveBeenCalledOnce();
 complete.mockResolvedValueOnce({text:JSON.stringify([{id:'invented',prediction:'needs_action'}]),usage:'unknown',finish:'complete'});
 await expect(predict(frozen as any,'b'.repeat(64))).rejects.toThrow('cases');
 }finally{store.close();}
});
it('charges unknown failures conservatively and never trusts an arbitrary error usage property',async()=>{
 const store=new LoopStore(':memory:'),digest='c'.repeat(64),complete=vi.fn(async()=>{throw Object.assign(Error('transport failure'),{usage:{inputTokens:0,outputTokens:0}});});const port={contract:{id:'test',provider:'test',model:'test',tokenizer:'test',protocolOverheadMeasured:true as const,maxOutputTokensEnforced:true as const,usageIncludesReasoningAndProtocol:true as const},measureInput:()=>100,complete};
 try{await expect(createAssistantQualityPredictor({store,port,isCurrent:()=>true})({protocol:{analysisContract:'test'},cases:[{id:'case-one',prediction:'unknown',severe:false}],facts:[{id:'case-one',title:'Synthetic fixture',status:'tasks',updatedAt:1,severe:false}]} as any,digest)).rejects.toThrow('transport failure');expect(store.readAssistantAnalysisAttempt(`assistant-quality-${digest}-0`)).toMatchObject({state:'settled',chargedInput:100,chargedOutput:1000});}finally{store.close();}
});
it('rejects malformed provider usage before ledger writes and falls back to the full reservation',async()=>{
 const store=new LoopStore(':memory:'),digest='d'.repeat(64),complete=vi.fn(async()=>({text:'[]',usage:{inputTokens:NaN,outputTokens:-1},finish:'complete' as const}));const port={contract:{id:'test',provider:'test',model:'test',tokenizer:'test',protocolOverheadMeasured:true as const,maxOutputTokensEnforced:true as const,usageIncludesReasoningAndProtocol:true as const},measureInput:()=>100,complete};
 try{await expect(createAssistantQualityPredictor({store,port,isCurrent:()=>true})({protocol:{analysisContract:'test'},cases:[{id:'case-one',prediction:'unknown',severe:false}],facts:[{id:'case-one',title:'Synthetic fixture',status:'tasks',updatedAt:1,severe:false}]} as any,digest)).rejects.toThrow('assistant_budget_usage');expect(store.readAssistantAnalysisAttempt(`assistant-quality-${digest}-0`)).toMatchObject({state:'settled',chargedInput:100,chargedOutput:1000});}finally{store.close();}
});
