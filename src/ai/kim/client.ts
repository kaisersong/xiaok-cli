import {request} from 'node:http';
import {z} from 'zod/v3';
import {KIM_MODEL,KIM_SCORES_SCHEMA,type KimScores,type KimWindow} from './contracts.js';
import {canonicalKimOrigin} from './config.js';
import {renderKimWindow} from './window.js';
const LIMIT=256000;
/** Native direct HTTP to literal loopback: no proxy env, redirects or remote fallback. */
export class KimDecisionClient {
 private busy=false;
 constructor(private readonly options:{timeoutMs?:number}={}){}
 private async call(origin:string,path:string,body:unknown,signal:AbortSignal):Promise<unknown>{
  signal.throwIfAborted();const timeout=AbortSignal.timeout(this.options.timeoutMs??10000),combined=AbortSignal.any([signal,timeout]);
  try{return await new Promise<unknown>((resolve,reject)=>{
   const data=body===undefined?undefined:JSON.stringify(body);if(data!==undefined&&Buffer.byteLength(data)>512000){reject(Error('kim_request_limit'));return;}
   const req=request(new URL(path,canonicalKimOrigin(origin)),{method:data===undefined?'GET':'POST',agent:false,signal:combined,headers:data===undefined?{}:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},res=>{
    if(res.statusCode!==200){res.destroy();reject(Error(`kim_http_${res.statusCode}`));return;}
    const parts:Buffer[]=[];let size=0;
    if(Number(res.headers['content-length'])>LIMIT){res.destroy();reject(Error('kim_response_limit'));return;}
    res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>LIMIT){res.destroy();reject(Error('kim_response_limit'));}else parts.push(chunk);});
    res.on('error',()=>reject(Error('kim_unavailable')));res.on('aborted',()=>reject(Error('kim_unavailable')));
    res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));}catch{reject(Error('kim_invalid_response'));}});
   });
   req.on('error',()=>reject(Error(timeout.aborted&&!signal.aborted?'kim_timeout':signal.aborted?'kim_cancelled':'kim_unavailable')));if(data)req.write(data);req.end();
  });}catch(e){if(timeout.aborted&&!signal.aborted)throw Error('kim_timeout');if(signal.aborted)signal.throwIfAborted();throw e;}
 }
 async health(origin:string,signal:AbortSignal){const start=Date.now();const raw=z.object({status:z.literal('ok'),model:z.literal(KIM_MODEL),engine:z.string().max(30).optional()}).parse(await this.call(origin,'/health',undefined,signal));return {available:true,model:KIM_MODEL,...(raw.engine?{engine:raw.engine}:{}),latencyMs:Date.now()-start} as const;}
 async judge(windows:KimWindow[],origin:string,signal:AbortSignal):Promise<KimScores[]>{
  if(this.busy)throw Error('kim_busy');if(windows.length>100)throw Error('kim_input_limit');signal.throwIfAborted();this.busy=true;
  try{const results:KimScores[]=[];for(let i=0;i<windows.length;i+=8){signal.throwIfAborted();const texts=windows.slice(i,i+8).map(renderKimWindow);let parsed;
    try{parsed=z.object({results:z.array(KIM_SCORES_SCHEMA).max(8)}).strict().parse(await this.call(origin,'/decide_batch',{texts},signal));}
    catch(e){if(e instanceof z.ZodError)throw Error('kim_invalid_response');throw e;}
    if(parsed.results.length!==texts.length)throw Error('kim_invalid_response');results.push(...parsed.results);
   }return results;
  }finally{this.busy=false;}
 }
}
