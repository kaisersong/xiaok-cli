import type {ArtifactExportFileIdentity, ArtifactExportOutcome} from '../../src/runtime/loop/producer-types.js';
export type {ArtifactExportFileIdentity, ArtifactExportOutcome} from '../../src/runtime/loop/producer-types.js';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';
export interface ArtifactExportProcessHooks {
 prepare(parent:Readonly<ArtifactExportFileIdentity>):Promise<void>;
 created(file:Readonly<ArtifactExportFileIdentity>):Promise<void>;
 staged(file:Readonly<ArtifactExportFileIdentity>,sha256:string,size:number):Promise<void>;
 authorizeCommit():Promise<()=>void>;
 settled(outcome:Readonly<ArtifactExportOutcome>):Promise<void>;
}
interface Input {executable:string;requestSource:'user'|'agent'|'scheduler';parent:string;parentIdentity:ArtifactExportFileIdentity;temporaryName:string;targetName:string;ownershipToken:string;bytes:Buffer;sha256:string;signal:AbortSignal;hooks:ArtifactExportProcessHooks}
type Phase='initial'|'ready'|'created'|'staged'|'finished';
interface Receipt {stage:Exclude<Phase,'initial'>;ok:boolean;committed:boolean;cleanup?:'none'|'removed'|'unknown';identity?:ArtifactExportFileIdentity;sha256?:string;size?:number;error?:string}
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function exact(value:unknown,keys:readonly string[]):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw Error('artifact_export_protocol');}
function identity(value:unknown):Readonly<ArtifactExportFileIdentity>{
 exact(value,['device','inode']);for(const part of [value.device,value.inode])if(typeof part!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(part)||BigInt(part)>18446744073709551615n)throw Error('artifact_export_identity');
 return Object.freeze({device:value.device as string,inode:value.inode as string});
}
const same=(a:ArtifactExportFileIdentity,b:ArtifactExportFileIdentity)=>a.device===b.device&&a.inode===b.inode;
/** Main-only child owner. Fixed executable and durable callbacks come from the
 * composition root, never renderer/model DTOs. No budget or proof is minted. */
export async function runArtifactExportProcess(raw:Input):Promise<Readonly<ArtifactExportOutcome>>{
 if(raw.requestSource!=='user')throw Error('artifact_export_source');
 const {signal,executable,parent,temporaryName,targetName,sha256,ownershipToken}=raw,parentIdentity=identity(raw.parentIdentity);
 if(typeof ownershipToken!=='string'||!/^[a-f0-9]{64}$/.test(ownershipToken))throw Error('artifact_export_token');
 if(!isAbsolute(executable)||!isAbsolute(parent)||[executable,parent,temporaryName,targetName].some(v=>typeof v!=='string'||v.includes('\0'))||typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256)||!Buffer.isBuffer(raw.bytes)||raw.bytes.length>16*1024**2)throw Error('artifact_export_input');
 const bytes=Buffer.from(raw.bytes);if(hash(bytes)!==sha256)throw Error('artifact_export_source_hash');
 const hooks={prepare:raw.hooks.prepare.bind(raw.hooks),created:raw.hooks.created.bind(raw.hooks),staged:raw.hooks.staged.bind(raw.hooks),authorizeCommit:raw.hooks.authorizeCommit.bind(raw.hooks),settled:raw.hooks.settled.bind(raw.hooks)};
 signal.throwIfAborted();const env:NodeJS.ProcessEnv={};if(process.platform==='win32'&&process.env.SystemRoot)env.SystemRoot=process.env.SystemRoot;
 const child=spawn(executable,[parent,temporaryName,targetName,String(bytes.length),sha256,parentIdentity.device,parentIdentity.inode,ownershipToken],{shell:false,windowsHide:true,env,stdio:'pipe'});
 let stdoutBytes=0,stderrBytes=0,pending='',phase:Phase='initial',file:Readonly<ArtifactExportFileIdentity>|undefined,terminal:Receipt|undefined;
 let sentCreate=false,sentWrite=false,sentCommit=false,closed=false,protocolError=false,fault:string|null=null;
 let terminateTimer:ReturnType<typeof setTimeout>|undefined,killTimer:ReturnType<typeof setTimeout>|undefined;
 const waiters=new Set<()=>void>(),wake=()=>{for(const resolve of waiters)resolve();waiters.clear();};
 function stop(reason?:string){
  if(reason)fault??=reason;if(closed)return;
  if(!child.stdin.writableEnded){try{child.stdin.end();}catch{child.stdin.destroy();}}
  if(!terminateTimer){terminateTimer=setTimeout(()=>{if(closed)return;child.kill('SIGTERM');killTimer=setTimeout(()=>{if(!closed)child.kill('SIGKILL');},1000);killTimer.unref();},5000);terminateTimer.unref();}wake();
 }
 function invalid(){protocolError=true;stop('artifact_export_protocol');}
 function failReceipt(r:Receipt):boolean{
  if(r.ok||typeof r.error!=='string'||r.error.length===0)return false;
  const beforeReady=phase==='initial',ready=phase!=='initial',created=!!file,staged=phase==='staged',noTemp=r.cleanup==='none',hasTemp=r.cleanup==='removed'||r.cleanup==='unknown';
  if(r.committed&&!sentCommit||r.cleanup==='removed'&&!sentCreate||created&&noTemp)return false;
  switch(r.error){
   case 'arguments':case 'path':case 'size':case 'hash':case 'token':case 'directory_open':case 'directory_identity':return beforeReady&&!sentCreate&&!r.committed&&noTemp;
   case 'create_not_requested':return ready&&!created&&!r.committed&&noTemp;
   case 'create_failed':return ready&&sentCreate&&!created&&!r.committed&&noTemp;
   case 'file_identity':case 'file_lock':case 'file_token':return ready&&sentCreate&&!created&&!r.committed&&hasTemp;
   case 'write_not_requested':return created&&!staged&&!sentCommit&&!r.committed&&hasTemp;
   case 'write_failed':case 'sync_failed':return created&&sentWrite&&!staged&&!sentCommit&&!r.committed&&hasTemp;
   case 'content_changed':return created&&sentWrite&&(!staged||sentCommit)&&!r.committed&&hasTemp;
   case 'commit_not_requested':return staged&&!r.committed&&hasTemp;
   case 'extra_command':case 'cancelled':case 'link_failed':case 'commit_prepare_failed':return staged&&sentCommit&&!r.committed&&hasTemp;
   case 'target_changed':case 'directory_sync_failed':return staged&&sentCommit&&r.committed&&hasTemp;
   case 'cleanup_unknown':return staged&&sentCommit&&r.committed&&r.cleanup==='unknown';
   default:return false;
  }
 }
 function receive(line:string){
  if(protocolError)return;
  try{
   const value:unknown=JSON.parse(line);if(JSON.stringify(value)!==line||!value||typeof value!=='object')throw Error();const r=value as Receipt;
   if(typeof r.ok!=='boolean'||typeof r.committed!=='boolean'||phase==='finished')throw Error();
   if(r.stage==='finished'){
    exact(r,['stage','ok','committed','cleanup',...(Object.hasOwn(r,'error')?['error']:[])]);if(!['none','removed','unknown'].includes(r.cleanup!))throw Error();
    if(r.ok){if(phase!=='staged'||!sentCommit||!r.committed||r.cleanup!=='removed'||Object.hasOwn(r,'error'))throw Error();}else if(!failReceipt(r))throw Error();
    terminal=Object.freeze({...r});phase='finished';wake();return;
   }
   exact(r,['stage','ok','committed','identity',...(r.stage==='staged'?['sha256',...(bytes.length?['size']:[])]:[])]);
   if(!r.ok||r.committed)throw Error();const actual=identity(r.identity);
   if(r.stage==='ready'){if(phase!=='initial'||sentCreate||!same(actual,parentIdentity))throw Error();phase='ready';}
   else if(r.stage==='created'){if(phase!=='ready'||!sentCreate||sentWrite)throw Error();file=actual;phase='created';}
   else if(r.stage==='staged'){if(phase!=='created'||!sentWrite||sentCommit||!file||!same(actual,file)||r.sha256!==sha256||(r.size??0)!==bytes.length)throw Error();phase='staged';}
   else throw Error();wake();
  }catch{invalid();}
 }
 // Keep draining after invalid or excessive output; never leave a full pipe
 // preventing the child from observing stdin EOF and completing cleanup.
 child.stdout.on('data',(chunk:Buffer)=>{stdoutBytes+=chunk.length;if(stdoutBytes>16384){pending='';invalid();return;}if(protocolError)return;pending+=chunk.toString('utf8');let index:number;while((index=pending.indexOf('\n'))!==-1){const line=pending.slice(0,index);pending=pending.slice(index+1);receive(line);}});
 child.stderr.on('data',(chunk:Buffer)=>{stderrBytes+=chunk.length;if(stderrBytes>4096)invalid();});
 child.stdout.on('error',invalid);child.stderr.on('error',invalid);child.stdin.on('error',()=>stop('artifact_export_input_pipe'));child.on('error',()=>stop('artifact_export_process'));
 const lifetimeTimer=setTimeout(()=>stop('artifact_export_timeout'),60000);lifetimeTimer.unref();
 const close=new Promise<number|null>(resolve=>child.once('close',code=>{closed=true;clearTimeout(lifetimeTimer);clearTimeout(terminateTimer);clearTimeout(killTimer);if(pending.length)protocolError=true;wake();resolve(code);}));
 const abort=()=>stop('artifact_export_cancelled');signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 function current(){if(signal.aborted||fault||closed||terminal)throw Error('artifact_export_stopped');}
 async function waitPhase(expected:Phase){for(;;){current();if(phase===expected)return;await new Promise<void>(resolve=>waiters.add(resolve));}}
 try{
  await waitPhase('ready');current();await hooks.prepare(parentIdentity);current();sentCreate=true;child.stdin.write('C');
  await waitPhase('created');current();await hooks.created(file!);current();sentWrite=true;child.stdin.write('W');child.stdin.write(bytes);
  await waitPhase('staged');current();await hooks.staged(file!,sha256,bytes.length);current();const fence=await hooks.authorizeCommit();current();if(typeof fence!=='function')throw Error('artifact_export_fence');
  const checked:unknown=fence();
  if(checked!==undefined){
   // A () => void callback can still be async at runtime. Reject its authority,
   // stop the child, and drain its actual work before durable settlement.
   stop('artifact_export_fence_sync');try{await checked;}catch{/* Already rejected; only drain here. */}
   throw Error('artifact_export_fence_sync');
  }
  current();sentCommit=true;child.stdin.end('K');
 }catch{stop(signal.aborted?'artifact_export_cancelled':terminal&&!protocolError?undefined:'artifact_export_host_or_child_failed');}
 const code=await close;signal.removeEventListener('abort',abort);
 const result:Readonly<ArtifactExportOutcome>=Object.freeze(protocolError||!terminal
  ?{status:'unknown',committed:null,cleanup:'unknown',error:fault??'artifact_export_missing_receipt'}
  :{status:terminal.ok&&code===0&&!fault&&!signal.aborted?'completed':'failed',committed:terminal.committed,cleanup:terminal.cleanup!,error:fault??terminal.error??(code===0?null:'artifact_export_exit')});
 // Single coordinator: settle only after all started callbacks AND real close.
 await hooks.settled(result);return result;
}

interface RecoveryInput {
 executable:string;requestSource:'user'|'agent'|'scheduler';parent:string;parentIdentity:ArtifactExportFileIdentity;
 temporaryName:string;fileIdentity:ArtifactExportFileIdentity;ownershipToken:string;size:number;sha256:string;
 progress:'created'|'staged'|'committing';signal:AbortSignal;
}
export interface ArtifactExportRecoveryOutcome {readonly cleanup:'removed'|'unknown';readonly error:string|null}
/** Fixed Main lifecycle only. Caller must select an original journal entry;
 * neither a DTO nor an absence observation proves a deletion. */
export async function runArtifactExportRecovery(raw:RecoveryInput):Promise<Readonly<ArtifactExportRecoveryOutcome>> {
 if(raw.requestSource!=='user')throw Error('artifact_export_source');
 const {executable,parent,temporaryName,ownershipToken,size,sha256,progress,signal}=raw,parentIdentity=identity(raw.parentIdentity),file=identity(raw.fileIdentity);
 if(typeof executable!=='string'||typeof parent!=='string'||!isAbsolute(executable)||!isAbsolute(parent)||typeof temporaryName!=='string'||[executable,parent,temporaryName].some(v=>v.includes('\0'))||typeof ownershipToken!=='string'||!/^[a-f0-9]{64}$/.test(ownershipToken)||typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256)||!Number.isSafeInteger(size)||size<0||size>16*1024**2||!['created','staged','committing'].includes(progress))throw Error('artifact_export_input');
 signal.throwIfAborted();const env:NodeJS.ProcessEnv={};if(process.platform==='win32'&&process.env.SystemRoot)env.SystemRoot=process.env.SystemRoot;
 const child=spawn(executable,['--recover',parent,temporaryName,String(size),sha256,parentIdentity.device,parentIdentity.inode,file.device,file.inode,ownershipToken,progress],{shell:false,windowsHide:true,env,stdio:'pipe'});
 let closed=false,stdoutBytes=0,stderrBytes=0,pending='',fault:string|null=null,receipt:{ok:boolean;error:string|null}|undefined;
 let terminateTimer:ReturnType<typeof setTimeout>|undefined,killTimer:ReturnType<typeof setTimeout>|undefined;
 function stop(reason:string){
  fault??=reason;if(closed)return;if(!child.stdin.writableEnded){try{child.stdin.end();}catch{child.stdin.destroy();}}
  if(!terminateTimer){terminateTimer=setTimeout(()=>{if(closed)return;child.kill('SIGTERM');killTimer=setTimeout(()=>{if(!closed)child.kill('SIGKILL');},1000);killTimer.unref();},5000);terminateTimer.unref();}
 }
 function receive(line:string){
  if(fault)return;
  try{
   const r=JSON.parse(line);if(JSON.stringify(r)!==line||!r||typeof r!=='object'||receipt||r.stage!=='recovered'||typeof r.ok!=='boolean')throw Error();
   exact(r,r.ok?['stage','ok','cleanup','identity','token']:['stage','ok','cleanup','error']);
   if(r.ok){if(r.cleanup!=='removed'||r.token!==ownershipToken||!same(identity(r.identity),file))throw Error();receipt={ok:true,error:null};}
   else{if(r.cleanup!=='unknown'||typeof r.error!=='string'||!r.error||r.error.length>160)throw Error();receipt={ok:false,error:r.error};}
  }catch{stop('artifact_export_protocol');}
 }
 child.stdout.on('data',(chunk:Buffer)=>{stdoutBytes+=chunk.length;if(stdoutBytes>16384){pending='';stop('artifact_export_protocol');return;}if(fault)return;pending+=chunk.toString('utf8');let n:number;while((n=pending.indexOf('\n'))!==-1){const line=pending.slice(0,n);pending=pending.slice(n+1);receive(line);}});
 child.stderr.on('data',(chunk:Buffer)=>{stderrBytes+=chunk.length;if(stderrBytes>4096)stop('artifact_export_protocol');});
 child.stdout.on('error',()=>stop('artifact_export_protocol'));child.stderr.on('error',()=>stop('artifact_export_protocol'));child.stdin.on('error',()=>stop('artifact_export_input_pipe'));child.on('error',()=>stop('artifact_export_process'));
 const lifetimeTimer=setTimeout(()=>stop('artifact_export_timeout'),60000);lifetimeTimer.unref();
 const close=new Promise<number|null>(resolve=>child.once('close',code=>{closed=true;clearTimeout(lifetimeTimer);clearTimeout(terminateTimer);clearTimeout(killTimer);if(pending.length)fault??='artifact_export_protocol';resolve(code);}));
 const abort=()=>stop('artifact_export_cancelled');signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 child.stdin.end();const code=await close;signal.removeEventListener('abort',abort);
 if(!fault&&!signal.aborted&&receipt?.ok&&code===0)return Object.freeze({cleanup:'removed',error:null});
 return Object.freeze({cleanup:'unknown',error:fault??(signal.aborted?'artifact_export_cancelled':receipt?.error)??'artifact_export_missing_receipt'});
}
