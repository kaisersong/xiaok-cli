// @vitest-environment node
import {it,expect,vi} from 'vitest';import * as services from '../../electron/desktop-services.js';
const finalize=(services as unknown as {__testFinalization:(input:any)=>Promise<any>}).__testFinalization;
it('no-tool finalization refuses late content and closes the real source iterator',async()=>{
 vi.useFakeTimers({toFake:['Date']});const start=Date.now();let closed=0;try{
 const result=finalize({adapter:{async *stream(){try{vi.setSystemTime(start+1001);yield {type:'text',delta:'must not commit late summary'};yield {type:'done'};}finally{closed++;}}},apiMessages:[{role:'user',content:[{type:'text',text:'fictional'}]}],systemPrompt:'',streamOptions:{},signal:new AbortController().signal,deadline:start+1000,sessionId:'fictional',turnId:'turn',intentId:'intent',stepId:'step',emitRuntimeEvent:async()=>{}});
 await expect(result).rejects.toThrow('desktop_tool_loop_deadline_exceeded');expect(closed).toBe(1);
 }finally{vi.useRealTimers();}
});
