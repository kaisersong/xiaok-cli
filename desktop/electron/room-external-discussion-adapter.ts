import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, realpath, readFile, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RoomExternalDiscussionAdapter, RoomExternalDiscussionRuntime, RoomExternalDiscussionCapability, RoomExternalDiscussionStarted } from '../shared/room-external-discussion.js';

const execFileAsync=promisify(execFile);
const proof={freshSession:true,toolsDisabled:true,mcpDisabled:true,hooksDisabled:true} as const;
const qoderIsolationArgs=[
  '--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','',
  '--settings',JSON.stringify({disableAllHooks:true,hooks:{},hooksConfig:{},enabledPlugins:{},general:{enableAutoUpdate:false,enableNotifications:false},agentsMdExcludes:['**/*']}),
  '--disable-builtin-skills','--no-session-persistence','--permission-mode','dont_ask',
] as const;
const supervisor=String.raw`
const {spawn}=require('node:child_process');let input='';
process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>input+=chunk);
process.stdin.on('end',()=>{try{const request=JSON.parse(input);const child=spawn(request.executable,request.args,{cwd:process.cwd(),env:process.env,stdio:['pipe','pipe','pipe']});
child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);child.stdin.on('error',()=>{});child.stdin.end(request.input||'');
child.on('error',error=>{process.stderr.write(error.message);process.exitCode=1;});child.on('close',code=>{process.exitCode=code===null?1:code;});
}catch(error){process.stderr.write(error.message);process.exitCode=1;}});
`;
function safeEnvironment(input:NodeJS.ProcessEnv):NodeJS.ProcessEnv {
  const env={...input};
  for(const key of Object.keys(env))if(/^(INTENT_BROKER_|KSWARM_|NODE_OPTIONS$|NODE_PATH$)/.test(key))delete env[key];
  return {...env,ELECTRON_RUN_AS_NODE:'1'};
}
function groupExists(pid:number):boolean {
  try{process.kill(-pid,0);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error;}
}
const pause=(milliseconds:number)=>new Promise<void>(done=>setTimeout(done,milliseconds));
function groupSignal(pid:number,signal:NodeJS.Signals){try{process.kill(-pid,signal);}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}}

/** Profiles are resolved once by trusted main, never by an execution payload. */
export function createRoomExternalDiscussionAdapter(options:{
  profiles:Partial<Record<RoomExternalDiscussionRuntime,{executable:string;argsPrefix?:readonly string[]}>>;
  env?:NodeJS.ProcessEnv;temporaryRoot?:string;
}):RoomExternalDiscussionAdapter {
  const env=safeEnvironment(options.env??process.env);
  const profiles=Object.fromEntries(Object.entries(options.profiles).map(([key,value])=>[key,{...value,argsPrefix:[...(value?.argsPrefix??[])]}])) as typeof options.profiles;
  async function probe(runtime:RoomExternalDiscussionRuntime):Promise<RoomExternalDiscussionCapability>{
    const denied=(reason:string):RoomExternalDiscussionCapability=>({protocol:'room_discussion_v1',runtime,supported:false,reason});
    if(process.platform==='win32')return denied('room_discussion_process_group_unsupported');
    if(runtime==='kiro')return denied('room_discussion_isolation_unverified');
    const profile=profiles[runtime];if(!profile||!isAbsolute(profile.executable))return denied('room_discussion_executable_unavailable');
    try{
      await realpath(profile.executable);
      // The capability probe also disables startup hooks/settings, not just the
      // model execution. Unknown flag combinations fail closed.
      const {stdout}=await execFileAsync(profile.executable,[...(profile.argsPrefix??[]),...(runtime==='xiaok'?['--room-discussion-v1','--probe']:[...qoderIsolationArgs,'--help'])],{env,cwd:tmpdir(),timeout:10000,maxBuffer:1024*1024});
      if(runtime==='xiaok'){
        const marker=JSON.parse(stdout.trim());
        if(marker.protocol!=='room_discussion_v1'||marker.runtime!=='xiaok'||Object.keys(proof).some(key=>marker[key]!==true))return denied('room_discussion_isolation_unverified');
      }else{
        if(!['--tools','--strict-mcp-config','--setting-sources','--settings','--no-session-persistence','--system-prompt'].every(flag=>stdout.includes(flag)))return denied('room_discussion_isolation_unverified');
        // This supported Qoder distribution exposes the actual hook-disable
        // setting in its JS bundle; unknown/native variants stay unavailable.
        const entry=profile.argsPrefix?.find(arg=>isAbsolute(arg)&&/\.[cm]?js$/.test(arg))??profile.executable;
        const executable=await readFile(await realpath(entry),'utf8');
        if(!executable.includes('disableAllHooks'))return denied('room_discussion_hooks_unverified');
      }
      return {protocol:'room_discussion_v1',runtime,supported:true,proof};
    }catch{return denied('room_discussion_probe_failed');}
  }
  return {probe,async execute(input){
    input.signal.throwIfAborted();
    if(!(await probe(input.runtime)).supported)throw new Error('room_discussion_unsupported');
    input.signal.throwIfAborted();
    const profile=profiles[input.runtime]!;
    const neutralRoot=await mkdtemp(join(options.temporaryRoot??tmpdir(),'xiaok-room-discussion-'));
    const prepared={operationId:input.operationId,runtime:input.runtime,neutralRoot,ownerPid:process.pid,phase:'prepared' as const};
    try{await input.onPrepared(prepared);input.signal.throwIfAborted();}
    catch(error){
      // This is a live fact before any spawn call, not an inference from an old
      // prepared journal after restart. Do not conflate the two recovery cases.
      await input.onNotSpawned?.({...prepared,phase:'not-spawned',noSpawnVerified:true});
      await rm(neutralRoot,{recursive:true,force:true});throw error;
    }
    const child=spawn(process.execPath,['-e',supervisor],{cwd:neutralRoot,env,detached:true,stdio:['pipe','pipe','pipe']});
    let output='',stderr='',exitCode:number|null=null,closed=false,spawnError:Error|undefined,cleanupError:unknown;
    const signalGroup=(signal:NodeJS.Signals)=>{if(child.pid)try{groupSignal(child.pid,signal);}catch(error){cleanupError=error;}};
    const alive=()=>{if(!child.pid)return false;try{return groupExists(child.pid);}catch(error){cleanupError=error;return true;}};
    const finished=new Promise<void>(done=>{child.once('error',error=>{spawnError=error;});child.once('close',code=>{exitCode=code;closed=true;done();});});
    child.stdout.on('data',data=>{output+=String(data);if(output.length>8*1024*1024)signalGroup('SIGTERM');});
    child.stderr.on('data',data=>{if(stderr.length<65536)stderr+=String(data);});child.stdin.on('error',()=>{});
    let started:RoomExternalDiscussionStarted|undefined,killTimer:ReturnType<typeof setTimeout>|undefined;
    const abort=()=>{signalGroup('SIGTERM');killTimer??=setTimeout(()=>signalGroup('SIGKILL'),500);};
    input.signal.addEventListener('abort',abort,{once:true});
    try{
      if(!child.pid)throw new Error('room_discussion_spawn_failed');
      const identity=await execFileAsync('/bin/ps',['-o','lstart=','-p',String(child.pid)],{env,timeout:3000});
      if(!identity.stdout.trim())throw new Error('room_discussion_process_identity_unavailable');
      started={...prepared,phase:'running',pid:child.pid,processGroupId:child.pid,processStartIdentity:identity.stdout.trim()};
      await input.onStarted(started);input.signal.throwIfAborted();
      const args=input.runtime==='xiaok'?['--room-discussion-v1']:[
        ...qoderIsolationArgs,
        '--system-prompt','You are a discussion-only participant. No tools, hooks, MCP, prior sessions, or filesystem context are available. Answer only the supplied discussion text.',
        '--output-format','json','-p',input.prompt,
      ];
      // Supervisor cannot start the CLI until the durable onStarted gate returns.
      child.stdin.end(JSON.stringify({executable:profile.executable,args:[...(profile.argsPrefix??[]),...args],input:input.runtime==='xiaok'?JSON.stringify({prompt:input.prompt}):''}));
      await finished;
      if(spawnError)throw spawnError;
      input.signal.throwIfAborted();
      if(exitCode!==0)throw new Error(`room_discussion_process_failed:${exitCode}`,{cause:stderr});
    }finally{
      input.signal.removeEventListener('abort',abort);if(killTimer)clearTimeout(killTimer);
      if(child.pid){
        // Even successful direct-child exit cannot leave a surviving descendant.
        if(!closed||alive())signalGroup('SIGTERM');
        for(let i=0;i<50&&alive();i++)await pause(10);
        if(alive())signalGroup('SIGKILL');
        for(let i=0;i<250&&alive();i++)await pause(10);
        if(alive())throw new Error('room_discussion_cleanup_pending',{cause:cleanupError});
        await finished;
        if(started)await input.onExited({...started,phase:'released',exitCode,groupExitVerified:true});
      }
      await rm(neutralRoot,{recursive:true,force:true});
    }
    const result=JSON.parse(output.trim()) as {text?:unknown;result?:unknown;is_error?:boolean};
    if(result.is_error)throw new Error('room_discussion_model_failed');
    const text=input.runtime==='xiaok'?result.text:result.result;
    if(typeof text!=='string')throw new Error('room_discussion_output_invalid');
    return {text,resourcesReleased:true};
  }};
}
