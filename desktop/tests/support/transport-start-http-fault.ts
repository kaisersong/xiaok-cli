import {expect} from 'vitest';
import {KSwarmUnavailableError} from '../../electron/kswarm-service.js';

/** Fault the real Hub reply only after its body EOF; never replace a private IO. */
export function holdOriginalExecutionReadFault(failAt:number,sentinel:unknown){
 const previousFetch=globalThis.fetch;
 let entered!:()=>void,release!:()=>void,reads=0;
 const ready=new Promise<void>(resolve=>entered=resolve),held=new Promise<void>(resolve=>release=resolve);
 const replies:Array<{url:string;status:number;bytes:number}>=[];
 const dispatch:typeof fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  const target=url.pathname==='/projects/p/execution-start-admission'&&(init?.method??'GET')==='GET';
  const ordinal=target?++reads:0;
  const response=await previousFetch(input,init);
  if(!target||ordinal<failAt)return response;
  const body=await response.arrayBuffer();
  replies.push({url:url.href,status:response.status,bytes:body.byteLength});
  if(ordinal===failAt){entered();await held;}
  throw sentinel;
 };
 globalThis.fetch=dispatch;
 return {
  release,
  restore(){const current=globalThis.fetch;globalThis.fetch=previousFetch;expect(current).toBe(dispatch);},
  async waitEntered(work:Promise<unknown>){
   const actual=await Promise.race([ready.then(()=>true),work.then(()=>false,()=>false)]);
   expect(actual,'real execution-read fault boundary was not reached').toBe(true);
  },
  assertReplies(){
   expect(reads).toBe(failAt+1);
   expect(replies.map(reply=>reply.url)).toEqual([
    'http://127.0.0.1:4400/projects/p/execution-start-admission',
    'http://localhost:4400/projects/p/execution-start-admission',
   ]);
   for(const reply of replies){expect(reply.status).toBe(200);expect(reply.bytes).toBeGreaterThan(0);}
   console.log(JSON.stringify({fixture:'original-execution-read-fault',failAt,reads,replies}));
  },
 };
}
export function assertOriginalExecutionReadFailure(error:unknown,sentinel:unknown,fault:ReturnType<typeof holdOriginalExecutionReadFault>){
 expect(error).toBeInstanceOf(AggregateError);
 const failure=error as AggregateError;
 expect(failure.message).toBe('kswarm_execution_read_transport_failed');expect(failure.cause).toBe(sentinel);
 expect(failure.errors).toHaveLength(3);expect(failure.errors[0]).toBe(sentinel);expect(failure.errors[1]).toBe(sentinel);
 expect(failure.errors[2]).toBeInstanceOf(KSwarmUnavailableError);fault.assertReplies();
}
export function assertOriginalStopFailure(error:unknown,originals:unknown[]){
 expect(error).toBeInstanceOf(AggregateError);
 const failure=error as AggregateError;
 expect(failure.message).toBe('runtime_bridge_stop_unconfirmed');expect(failure.errors).toHaveLength(originals.length);
 for(let i=0;i<originals.length;i++)expect(failure.errors[i]).toBe(originals[i]);
}
