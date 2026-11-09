// @vitest-environment node
import {afterEach,describe,expect,it} from 'vitest';
import {createServer,type Server} from 'node:http';
import {mkdtempSync,writeFileSync,linkSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {withDecisionCleanup,withDecisionSyncCleanup} from '../../electron/decision-model-cleanup.js';
import {DecisionModelHttp} from '../../electron/decision-model-http.js';
import {DecisionModelFiles} from '../../electron/decision-model-files.js';
import {verifyDecisionFile,downloadDecisionFile} from '../../electron/decision-model-download.js';
const servers:Server[]=[],roots:string[]=[],stocks:DecisionModelHttp[]=[];
afterEach(async()=>{
 const errors:unknown[]=[];
 for(const http of stocks.splice(0)){try{await http.settle();}catch(raw){errors.push(raw);}}
 for(const server of servers.splice(0)){try{await new Promise<void>((yes,no)=>server.close(error=>error?no(error):yes()));}catch(raw){errors.push(raw);}}
 for(const path of roots.splice(0)){try{rmSync(path,{recursive:true,force:true});}catch(raw){errors.push(raw);}}
 if(errors.length)throw new AggregateError(errors,'manual_model_test_cleanup');
});
async function endpoint(handler:Parameters<typeof createServer>[0]){
 const server=createServer(handler);servers.push(server);
 await new Promise<void>(yes=>server.listen(0,'127.0.0.1',yes));const address=server.address();
 if(!address||typeof address==='string')throw Error('fixture_listen');return `http://127.0.0.1:${address.port}`;
}
function directory(){const p=realpathSync(mkdtempSync(join(tmpdir(),'decision-source-')));roots.push(p);return p;}
describe('actual Node HTTP and file component, no Native or model inference claim',()=>{
 it('consumes a real split UTF8 response and closes the original reader/response',async()=>{
  const url=await endpoint((_req,res)=>{const bytes=Buffer.from('你好');res.write(bytes.subarray(0,1));setTimeout(()=>res.end(bytes.subarray(1)),5);});
  const http=new DecisionModelHttp();stocks.push(http);const result=await http.request(url,{},32);
  expect(result).toEqual({status:200,location:null,text:'你好'});await http.settle();
 });
 it('keeps the original bounded-read error after actual stream cleanup',async()=>{
  const url=await endpoint((_req,res)=>{res.end('too many bytes');});const http=new DecisionModelHttp();stocks.push(http);
  await expect(http.request(url,{},3)).rejects.toThrow('size_mismatch');await http.settle();
 });
 it('retains an original Error symbol Promise until it actually settles',async()=>{
  const url=await endpoint((_req,res)=>{res.end('body');});const http=new DecisionModelHttp();stocks.push(http);
  let release!:()=>void;const held=new Promise<void>(yes=>{release=yes;}),first=new Error('sink');Object.defineProperty(first,Symbol('original-held'),{value:held});
  try{await expect(http.request(url,{},32,()=>{throw first;})).rejects.toBe(first);
   let closed=false;const drain=http.settle().then(()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);release();await drain;
  }finally{release();}
 });
 it('hash-verifies the actual original FD and rejects a linked model file',async()=>{
  const root=directory(),path=join(root,'model.bin'),bytes=Buffer.from('fixed model fixture');writeFileSync(path,bytes,{mode:0o600});
  const file={name:'model.bin',size:bytes.length,hash:createHash('sha256').update(bytes).digest('hex'),algorithm:'sha256' as const};
  const files=new DecisionModelFiles(root);expect(await verifyDecisionFile(path,file,files)).toBe(true);
  linkSync(path,join(root,'alias.bin'));await expect(verifyDecisionFile(path,file,files)).rejects.toThrow('unsafe_path');await files.settle();
 });
 it('rejects an untrusted download origin before creating a partial file',async()=>{
  const root=directory(),files=new DecisionModelFiles(root),path=join(root,'partial.bin');
  await expect(downloadDecisionFile('http://127.0.0.1/file',path,{name:'file',size:1,hash:'0'.repeat(64),algorithm:'sha256'},new AbortController().signal,()=>undefined,files)).rejects.toThrow('download_host');await files.settle();
 });
});

describe('same-owner explicit cleanup continuations',()=>{
 it('joins a held cleanup and preserves a bare undefined first failure',async()=>{
  let release!:()=>void,closed=false;
  const held=new Promise<void>(yes=>{release=yes;});
  const work=withDecisionCleanup(async()=>{throw undefined;},async()=>{await held;closed=true;});
  const observed=work.then(()=>({fulfilled:true}),raw=>({fulfilled:false,raw}));
  try{await Promise.resolve();expect(closed).toBe(false);release();
   const outcome=await observed;expect(outcome).toEqual({fulfilled:false,raw:undefined});expect(closed).toBe(true);
  }finally{release();await observed;}
 });
 it('keeps both original failures and their undefined presence',async()=>{
  const cleanup=new Error('original cleanup');
  const raw=await withDecisionCleanup(async()=>{throw undefined;},async()=>{throw cleanup;}).then(()=>null,raw=>raw);
  expect(raw).toBeInstanceOf(AggregateError);expect(Object.hasOwn(raw,'cause')).toBe(true);
  expect(raw.cause).toBeUndefined();expect(raw.errors).toEqual([undefined,cleanup]);
 });
 it('preserves an existing fixed aggregate identity and sync return values',()=>{
  const primary=new Error('primary'),secondary=new Error('cleanup');
  const aggregate=new AggregateError([primary,secondary],'fixed',{cause:primary});
  let caught:unknown;
  try{withDecisionSyncCleanup(()=>{throw primary;},()=>{throw aggregate;});}catch(raw){caught=raw;}
  expect(caught).toBe(aggregate);expect(withDecisionSyncCleanup(()=>17,()=>undefined)).toBe(17);
 });
});
