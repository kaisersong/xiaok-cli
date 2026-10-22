import {spawn,spawnSync} from 'node:child_process';
import {openSync,closeSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';

// Only the temporary Unix Loop matrix uses this owner. Never adopt an existing PID.
export async function runOwnedChild({argv,cwd,env,logPath,metadataPath,signal,budgetMs=20000}){
 if(process.platform==='win32')throw Error('diagnostic_owner_requires_unix');
 const start=performance.now(),hardEnd=start+budgetMs+5000,nonce=randomBytes(16).toString('hex');
 const row={nonce,parentPid:process.pid,uid:process.getuid(),argv,cwd,startedAt:new Date().toISOString(),budgetMs,signals:[],errors:[],reaped:false};
 let child,leader,result,exited=false,shutdownAt=null,fd;
 const save=()=>{try{writeFileSync(metadataPath,JSON.stringify(row,null,2)+'\n');}catch{row.errors.push('metadata_io');}};
 const observe=()=>{
  const left=hardEnd-performance.now();if(left<=0)throw Error('observation_deadline');
  const ps=spawnSync('ps',['-axo','pid=,ppid=,pgid=,uid=,lstart='],{encoding:'utf8',timeout:Math.max(1,Math.min(1000,left)),maxBuffer:4*1024*1024});
  if(ps.error||ps.status!==0)throw Error('process_observation_failed');
  return ps.stdout.trim().split('\n').filter(Boolean).map(line=>{const f=line.trim().split(/\s+/);return {pid:+f[0],ppid:+f[1],pgid:+f[2],uid:+f[3],start:f.slice(4).join(' ')};});
 };
 const cancel=()=>{if(shutdownAt===null)shutdownAt=performance.now();row.cancelled=true;};
 const handlers=['SIGTERM','SIGINT'];
 // Install cancellation and close/error listeners before fallible metadata writes.
 for(const name of handlers)process.on(name,cancel);signal?.addEventListener('abort',cancel,{once:true});
 const send=kind=>{
  if(row.signals.some(v=>v.kind===kind))return;
  const attempt={kind,atMs:performance.now()-start,sent:false};row.signals.push(attempt);
  if(exited||performance.now()>=hardEnd)return;
  const current=observe().find(v=>v.pid===child.pid);
  if(!leader||JSON.stringify(current)!==JSON.stringify(leader))throw Error('refuse_changed_leader');
  if(exited||performance.now()>=hardEnd)return;
  process.kill(-child.pid,kind);attempt.sent=true;
 };
 try{
  fd=openSync(logPath,'wx');
  child=spawn(argv[0],argv.slice(1),{cwd,env:{...env,XIAOK_DIAGNOSTIC_CHILD_NONCE:nonce},detached:true,stdio:['ignore',fd,fd]});
  child.once('error',()=>{row.errors.push('child_spawn_error');exited=true;});
  child.once('exit',(code,childSignal)=>{result={code,signal:childSignal};exited=true;row.reaped=true;});
  row.pid=child.pid;row.pgid=child.pid;save();
  leader=observe().find(v=>v.pid===child.pid);row.leader=leader;
  if(!leader||leader.ppid!==process.pid||leader.pgid!==child.pid||leader.uid!==row.uid)throw Error('child_identity_unobserved');
 }catch(error){row.errors.push(error.message);shutdownAt??=performance.now();}
 finally{
  if(fd!==undefined){try{closeSync(fd);}catch{row.errors.push('log_close');}}
  if(child?.pid){
   while(!exited&&performance.now()<hardEnd){
    const now=performance.now();
    if(shutdownAt===null&&(signal?.aborted||row.errors.length||now>=start+budgetMs))shutdownAt=now;
    if(shutdownAt!==null){
     try{send(now>=Math.min(shutdownAt+2000,start+budgetMs+2000)?'SIGKILL':'SIGTERM');}
     catch(error){row.errors.push(error.message);}
    }
    await new Promise(accept=>setTimeout(accept,Math.min(25,Math.max(1,hardEnd-performance.now()))));
   }
   try{row.groupResidual=observe().filter(v=>v.pgid===child.pid);}catch{row.groupResidual=[{unknown:true}];}
   if(!row.reaped||row.groupResidual.length)row.errors.push('physical_exit_unknown');
   if(!exited)child.unref();
  }
  signal?.removeEventListener('abort',cancel);for(const name of handlers)process.removeListener(name,cancel);
  Object.assign(row,result??{code:null,signal:null},{elapsedMs:performance.now()-start,finishedAt:new Date().toISOString()});save();
 }
 if(row.errors.length||row.cancelled||shutdownAt!==null){const error=Error('diagnostic_child_owner_incomplete:'+metadataPath);error.owner=row;throw error;}
 return row;
}
