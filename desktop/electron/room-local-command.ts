import {spawn} from 'node:child_process';
import {homedir} from 'node:os';
import {delimiter,join} from 'node:path';
import {bashTool} from '../../src/ai/tools/bash.js';
import {classifyBashCommand} from '../../src/ai/tools/bash-safety.js';
import {truncateText} from '../../src/ai/tools/truncation.js';
import type {Tool} from '../../src/types.js';

const pause=(ms:number)=>new Promise<void>(done=>setTimeout(done,ms));
/** Trusted local execution, explicitly enabled per binding. This is not a sandbox.
 * Detached sessions/daemons are unsupported; recurring work belongs to scheduler. */
export function createRoomLocalCommandTool(options:{cwd:string;onCleanupPending:()=>void}):Tool {
  return {...bashTool,definition:{...bashTool.definition,description: `${bashTool.definition.description}\nRuns with the local user account in the authorized room directory. Do not start detached sessions, daemons, launch agents, cron, or background schedulers. Use scheduled tasks for recurring work. workdir is fixed to the room directory.`},async execute(input,context){
    if(process.platform==='win32')throw new Error('room_command_process_group_unsupported');
    context?.signal?.throwIfAborted();
    const command=String(input.command??'');
    const risk=classifyBashCommand(command);
    if(risk.level==='block')return `Error: ${risk.reason}`;
    if(/\b(?:sudo|setsid|nohup|launchctl|crontab)\b/.test(command))return 'Error: room_command_detached_or_privileged_unsupported';
    const env={...process.env};
    env.PATH=[...(env.PATH??'').split(delimiter),join(homedir(),'.local','node','bin'),join(homedir(),'.local','bin'),join(homedir(),'.npm-global','bin'),'/opt/homebrew/bin','/usr/local/bin'].filter(Boolean).join(delimiter);
    for(const key of Object.keys(env))if(/^(INTENT_BROKER_|KSWARM_|NODE_OPTIONS$|NODE_PATH$)/.test(key))delete env[key];
    const child=spawn('/bin/sh',['-c',command],{cwd:options.cwd,env,detached:true,stdio:['ignore','pipe','pipe']});
    let output='',exitCode:number|null=null,error:Error|undefined;
    const limit=Math.min(100000,Math.max(1000,Number(input.max_chars)||12000));
    const append=(data:Buffer)=>{if(output.length<limit)output+=data.toString().slice(0,limit-output.length);};
    child.stdout.on('data',append);child.stderr.on('data',append);
    const exited=new Promise<void>(done=>{child.once('exit',code=>{exitCode=code;done();});child.once('error',e=>{error=e;done();});});
    const closed=new Promise<void>(done=>child.once('close',()=>done()));
    const alive=()=>{if(!child.pid)return false;try{process.kill(-child.pid,0);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')return false;throw e;}};
    const kill=()=>{if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}};
    let timedOut=false;
    const abort=()=>{try{kill();}catch{options.onCleanupPending();}};
    const timer=setTimeout(()=>{timedOut=true;abort();},Math.min(600000,Math.max(1,Number(input.timeout_ms)||30000)));
    context?.signal?.addEventListener('abort',abort,{once:true});
    if(context?.signal?.aborted)abort();
    try {
      await exited;
    } finally {
      clearTimeout(timer);context?.signal?.removeEventListener('abort',abort);
      try {
        if(alive())kill();
        for(let i=0;i<300&&alive();i++)await pause(10);
        if(alive())throw new Error('room_command_cleanup_pending');
        await closed;
      } catch(e) {options.onCleanupPending();throw e;}
    }
    context?.signal?.throwIfAborted();
    if(error)throw error;
    if(timedOut)return `Error: command timed out\n${output}`;
    return truncateText(exitCode===0?output||'(command completed)':`Error (exit ${exitCode}): ${output}`,limit).text;
  }};
}
