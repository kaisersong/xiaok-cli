// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { streamDesktopSummaryRecovery } from '../../electron/desktop-summary-stream.js';
describe('Desktop observation preparation at each actual request',()=>{
 it('reprepares recovery with empty tools and native history, never previous full projection',async()=>{
  const preparations:any[]=[],requests:any[]=[];
  const adapter={async *stream(messages:any,tools:any){requests.push({messages,tools});if(requests.length===1){yield {type:'text',delta:'partial'};throw new Error('terminated');}yield {type:'text',delta:'done'};}};
  const input:any={adapter,messages:[{role:'user',content:[{type:'text',text:'native'}]}],tools:[{name:'read',description:'',inputSchema:{type:'object'}}],systemPrompt:'',invocationId:'initial',deadline:Date.now()+10000,canRecover:()=>true,
   prepareRequest:async(request:any)=>{await Promise.resolve();preparations.push(structuredClone({messages:request.messages,tools:request.tools,id:request.invocationId}));return {...request,messages:[...request.messages,{role:'user',content:[{type:'text',text:'projection-'+preparations.length}]}]};}};
  for await(const _ of streamDesktopSummaryRecovery(input)){}
  expect(preparations).toHaveLength(2);expect(preparations[1].tools).toEqual([]);expect(preparations[1].id).not.toBe(preparations[0].id);
  expect(JSON.stringify(preparations[1].messages)).toContain('partial');expect(JSON.stringify(preparations[1].messages)).not.toContain('projection-1');
  expect(JSON.stringify(requests[1].messages)).toContain('projection-2');expect(input.messages).toHaveLength(1);
 });
 it('preparation rejection does not create or retry provider requests',async()=>{
  let calls=0;const adapter={async *stream(){calls++;yield {type:'text',delta:'bad'};}};
  const input:any={adapter,messages:[],tools:[],systemPrompt:'',invocationId:'initial',deadline:Date.now()+10000,canRecover:()=>true,prepareRequest:async()=>{throw new Error('durable barrier failed');}};
  await expect((async()=>{for await(const _ of streamDesktopSummaryRecovery(input)){} })()).rejects.toThrow('durable barrier');expect(calls).toBe(0);
 });
 it('does not send after the task deadline crosses during asynchronous preparation',async()=>{
  let calls=0;const adapter={async *stream(){calls++;yield {type:'text',delta:'bad'};}};
  const input:any={adapter,messages:[],tools:[],systemPrompt:'',invocationId:'initial',deadline:Date.now()+10000,prepareRequest:async(request:any)=>{await Promise.resolve();input.deadline=0;return request;}};
  await expect((async()=>{for await(const _ of streamDesktopSummaryRecovery(input)){} })()).rejects.toThrow(/deadline/);expect(calls).toBe(0);
 });

});
