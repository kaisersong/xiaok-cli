import type { ModelAdapter, UsageStats } from '../../types.js';
import { performance } from 'node:perf_hooks';
/** Record before yielding done: the production recovery owner does not await iterator.return. */
export function instrumentCapabilityAdapter(inner:ModelAdapter,signal:AbortSignal){
  const calls:Array<{wallMs:number;status:'pending'|'completed'|'failed';usage:UsageStats|null}>=[];
  const adapter:ModelAdapter={getModelName:()=>inner.getModelName(),
    ...(inner.getHarnessProfileId?{getHarnessProfileId:()=>inner.getHarnessProfileId!()}:{}),
    ...(inner.getOutputTokenReserve?{getOutputTokenReserve:()=>inner.getOutputTokenReserve!()}:{}),
    async *stream(messages,tools,system,options){
      const at=performance.now();const call:{wallMs:number;status:'pending'|'completed'|'failed';usage:UsageStats|null}={wallMs:0,status:'pending',usage:null};calls.push(call);
      try{for await(const chunk of inner.stream(messages,tools,system,{...options,signal:options?.signal?AbortSignal.any([signal,options.signal]):signal})){
        if(chunk.type==='usage')call.usage=chunk.usage;
        call.wallMs=Math.round(performance.now()-at);if(chunk.type==='done')call.status='completed';yield chunk;
      }if(call.status==='pending')call.status='completed';}
      catch(e){call.status='failed';throw e;}
      finally{call.wallMs=Math.round(performance.now()-at);}
    },
  };return{adapter,calls};
}
