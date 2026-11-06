import {expect,it,vi} from 'vitest';
import {triageAssistantRecords} from '../../electron/assistant-triage.js';
import type {AssistantTriageInput} from '../../electron/assistant-inbox-service.js';
import type {LoopLLMPort} from '../../electron/loop-llm-port.js';
const rows=(n:number):AssistantTriageInput[]=>Array.from({length:n},(_,i)=>({key:i.toString(16).padStart(64,'0'),source:'yzj_message',accountKey:'qa',sourceId:String(i),title:'Synthetic notice',summary:'Read-only triage diagnostic',reason:'',nextStep:'',priority:'later',observedAt:100}));
const output=(input:Parameters<LoopLLMPort['complete']>[0])=>JSON.parse(input.userMessage).map((r:{key:string})=>({sourceKey:r.key,priority:'later',reason:'No decision needed',nextStep:'Review later'}));
it('finishes a realistic 54-item scan within bounded model calls and preserves original identity',async()=>{
 const complete=vi.fn(async input=>{if(JSON.parse(input.userMessage).length>8)throw Error('loop_llm_timeout');return{text:JSON.stringify(output(input))};});
 const records=rows(54),result=await triageAssistantRecords({complete},records,new AbortController().signal);
 expect(result.map(r=>r.sourceKey)).toEqual(records.map(r=>r.key));
 expect(complete.mock.calls.every(([i])=>i.queueTimeoutMs===60000)).toBe(true);
});
it.each(['unknown','duplicate','missing'])('rejects %s output identities before producing any result',async kind=>{
 const complete=vi.fn(async input=>{const items=output(input);if(kind==='unknown')items[0].sourceKey='untrusted';if(kind==='duplicate')items[1]=items[0];if(kind==='missing')items.pop();return{text:JSON.stringify(items)};});
 await expect(triageAssistantRecords({complete},rows(10),new AbortController().signal)).rejects.toThrow();
 expect(complete).toHaveBeenCalledTimes(1);
});
it('stops before another batch when cancelled and never returns partial classification',async()=>{
 const controller=new AbortController();const complete=vi.fn(async input=>{controller.abort();return{text:JSON.stringify(output(input))};});
 await expect(triageAssistantRecords({complete},rows(20),controller.signal)).rejects.toThrow();expect(complete).toHaveBeenCalledTimes(1);
});
it('does not call the model for an empty source list',async()=>{
 const complete=vi.fn();expect(await triageAssistantRecords({complete},[],new AbortController().signal)).toEqual([]);expect(complete).not.toHaveBeenCalled();
});
