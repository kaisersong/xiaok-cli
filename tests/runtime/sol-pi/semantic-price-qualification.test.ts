import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionExecutionAuthority, createSessionExecutionContext } from '../../../src/ai/runtime/session-store/execution-authority.js';
import { qualifySemanticPrice, assertSemanticPriceQualification } from '../../../src/runtime/sol-pi/semantic-price-qualification.js';
const network=vi.hoisted(()=>({alter:false,status:200,calls:[] as Array<{url:string;options:any;body:string}>}));
vi.mock('node:https',async()=>{
 const actual=await vi.importActual<typeof import('node:https')>('node:https');
 const {readFileSync}=await import('node:fs'),{EventEmitter}=await import('node:events'),{PassThrough}=await import('node:stream');
 const html=readFileSync(new URL('../../fixtures/sol-pi-deepseek-pricing-20260919.html',import.meta.url),'utf8');
 return {...actual,request:(url:URL,options:any,callback:(response:any)=>void)=>{
  const request=new EventEmitter() as any;request.destroy=()=>queueMicrotask(()=>request.emit('close'));
  request.end=(body:string)=>{network.calls.push({url:String(url),options,body});queueMicrotask(()=>{
   const response=new PassThrough() as any;response.statusCode=network.status;response.headers={'content-type':'text/html'};response.rawHeaders=['content-type','text/html'];
   callback(response);response.end(network.alter?html.replace('$0.3','$0.9'):html);
  });};return request;
 }};
});
afterEach(()=>{network.alter=false;network.status=200;network.calls=[];vi.restoreAllMocks();});
it.each(['valid','changed','redirect'] as const)('qualifies only the exact reviewed official price document: %s',async scenario=>{
 const root=mkdtempSync(join(tmpdir(),'price-qualification-'));
 const authority=createSessionExecutionAuthority({root,sessionIdentity:'price',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});
 const lease=await authority.acquire({invocationId:'price',kind:'compaction'});
 const binding={operationId:'summary-1',serializedBody:'{"model":"deepseek-flash"}',model:'deepseek-flash',priceRevision:'price-1',inputTokenUpperBound:100,outputTokenUpperBound:128,expiresAt:Date.now()+120000};
 try{
  network.alter=scenario==='changed';network.status=scenario==='redirect'?302:200;
  if(scenario!=='valid')await expect(qualifySemanticPrice(binding,lease)).rejects.toThrow('SEMANTIC_PRICE_UNAVAILABLE');
  else{
   const result=await qualifySemanticPrice(binding,lease);assertSemanticPriceQualification(result,binding);
   for(const patch of [{operationId:'summary-2'},{serializedBody:binding.serializedBody+' '},{model:'other'},{priceRevision:'other'},{inputTokenUpperBound:101},{outputTokenUpperBound:129}])expect(()=>assertSemanticPriceQualification(result,{...binding,...patch})).toThrow();
   expect(()=>assertSemanticPriceQualification({} as any,binding)).toThrow();
   vi.spyOn(Date,'now').mockReturnValue(Date.now()+61000);expect(()=>assertSemanticPriceQualification(result,binding)).toThrow();
  }
  expect(network.calls).toHaveLength(1);
  expect(network.calls[0]).toMatchObject({url:'https://api-docs.deepseek.com/quick_start/pricing/',body:'',options:{method:'GET',agent:false,rejectUnauthorized:true}});
  expect(network.calls[0].options.headers).not.toHaveProperty('authorization');
 }finally{await lease.releaseAfterDrain();authority.dispose();rmSync(root,{recursive:true,force:true});}
});
