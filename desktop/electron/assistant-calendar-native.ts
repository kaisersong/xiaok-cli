import {createHash} from 'node:crypto';
import {lstat,readFile,realpath} from 'node:fs/promises';
import {basename} from 'node:path';
import {execFile} from 'node:child_process';
import {createYzjCalendarCliReader,type YzjCalendarCliRun} from './yunzhijia-calendar-cli.js';
import type {AssistantCalendarConnection} from './assistant-calendar-store.js';
// SHA256 from the official 0.1.8 release manifest; no npm auto-install shim.
const DARWIN_ARM64_018='2bf97deda348609a560ea162c76c53d331ccf6fabec4db7081c4c9655029211b';
export async function verifyYzjCalendarBinary(path:string):Promise<string>{
 if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('assistant_calendar_platform_unavailable');
 const stat=await lstat(path);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32*1024*1024||basename(path)!=='yzj-cli')throw Error('assistant_calendar_binary_invalid');
 const actual=await realpath(path);
 if(createHash('sha256').update(await readFile(actual)).digest('hex')!==DARWIN_ARM64_018)throw Error('assistant_calendar_binary_unverified');
 return actual;
}
const runIdentity:YzjCalendarCliRun=(binary,args,options)=>new Promise((resolve,reject)=>{
 execFile(binary,[...args],{shell:false,encoding:'utf8',timeout:options.timeoutMs,maxBuffer:options.maxOutputBytes,signal:options.signal,killSignal:'SIGKILL',windowsHide:true},(error,stdout,stderr)=>{
  if(error)reject(Error('assistant_calendar_identity_unavailable'));else resolve({exitCode:0,stdout,stderr});
 });
});
export async function readYzjCalendarAccount(binary:string,run:YzjCalendarCliRun=runIdentity,signal?:AbortSignal):Promise<string>{
 if(signal?.aborted)throw Error('assistant_calendar_cancelled');
 const result=await run(binary,['--profile','xiaok-assistant','contact','user','get'],{timeoutMs:10000,maxOutputBytes:64*1024,signal});
 if(result.exitCode!==0||Buffer.byteLength(result.stdout)>64*1024)throw Error('assistant_calendar_identity_unavailable');
 let value;try{value=JSON.parse(result.stdout);}catch{throw Error('assistant_calendar_identity_unavailable');}
 const data=value?.data;
 if(value?.success!==true||value?.identity!=='user'||!data||typeof data.orgId!=='string'||!data.orgId||typeof data.openId!=='string'||!data.openId)throw Error('assistant_calendar_identity_unavailable');
 return createHash('sha256').update(JSON.stringify(['yunzhijia',data.orgId,data.openId])).digest('hex');
}
export function createNativeCalendarRead(current:()=>AssistantCalendarConnection){
 return async(grant:AssistantCalendarConnection,window:{from:number;to:number},signal?:AbortSignal)=>{
  signal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(30000)]);
  const binary=await verifyYzjCalendarBinary(grant.binary);
  if(await readYzjCalendarAccount(binary,undefined,signal)!==grant.accountId)throw Error('assistant_calendar_account_changed');
  const reader=createYzjCalendarCliReader({nativeBinary:binary,profile:'xiaok-assistant',currentGrant:()=>{const next=current();return {profile:'xiaok-assistant',epoch:next.epoch,accountId:next.accountId,enabled:next.enabled,consent:next.enabled};}});
  const result=await reader.listEvents({...window,signal});
  if(await readYzjCalendarAccount(binary,undefined,signal)!==grant.accountId)throw Error('assistant_calendar_account_changed');
  return result;
 };
}
