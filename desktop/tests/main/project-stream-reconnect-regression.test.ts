import {it,expect,vi} from 'vitest';
import {createProjectAgentModel} from '../../electron/project-agent-model.js';
import type {Config} from '../../../src/types.js';
const cfg={schemaVersion:2,defaultProvider:'p',defaultModelId:'m',providers:{p:{type:'custom',protocol:'openai_legacy',baseUrl:'http://localhost/v1'}},models:{m:{provider:'p',model:'m',label:'M',capabilities:['tools']}}} as Config;
it('reconnects a project default-model read and preserves completed tool history',async()=>{
 let calls=0;const seen:any[]=[];const recovery=vi.fn();
 const model=await createProjectAgentModel({loadConfig:async()=>cfg,createAdapter:()=>({getModelName:()=> 'm',async *stream(messages){seen.push(messages);if(++calls===1){yield{type:'text' as const,delta:'已写入产物。'};throw Object.assign(new Error('OpenAI stream ended before finish_reason'),{code:'ERR_STREAM_PREMATURE_CLOSE'});}yield{type:'text' as const,delta:'继续完成报告'};yield{type:'done' as const};}})});
 const history:any[]=[{role:'assistant',content:[{type:'tool_use',id:'write-once',name:'write',input:{}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'write-once',content:'saved'}]}];const chunks=[];
 for await(const c of model.stream({messages:history,tools:[],systemPrompt:'test',invocationId:'first',deadline:Date.now()+1000,options:{signal:new AbortController().signal},policy:{windowMs:200,idleMs:1000,initialDelayMs:0,maxDelayMs:0},onRecovery:recovery} as any))chunks.push(c);
 expect(calls).toBe(2);expect(recovery).toHaveBeenCalledTimes(1);expect(JSON.stringify(seen[1])).toContain('write-once');expect(JSON.stringify(seen[1])).toContain('not a completed answer');expect(chunks.at(-1)).toEqual({type:'done'});
});
