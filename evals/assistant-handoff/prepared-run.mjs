import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {repo,prepare,save,readJson} from './harness.mjs';
const count=Number(process.argv[2]??1);
if(!Number.isSafeInteger(count)||count<1||count>20)throw Error('count_must_be_1_to_20');
const audit=process.argv[3]==='audit';
const root=prepare();console.log(JSON.stringify({root,audit}));
const require=createRequire(join(repo,'desktop','package.json')),electron=require('electron');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const results=[];
for(const phase of ['prepare','recover']){
 const fd=openSync(join(root,`electron-${phase}.log`),'wx',0o600),args=[join(repo,'evals','assistant-handoff','prepared-electron.cjs'),phase,root,String(count),...(audit?['audit']:[])];
 const child=spawn(electron,args,{cwd:repo,env,stdio:['ignore',fd,fd]});
 save(join(root,`supervisor-${phase}-pid.json`),{pid:child.pid,parentPid:process.pid,executable:electron,args,startedAt:new Date().toISOString()});
 let timedOut=false;
 const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},45000);
 const status=await new Promise(resolve=>{child.once('error',()=>resolve({code:null,error:'spawn_failed'}));child.once('close',(code,signal)=>resolve({code,signal}));});
 clearTimeout(timer);closeSync(fd);
 results.push({phase,pid:child.pid,...status,timedOut,reaped:true});
 if(status.code!==0)break;
}
const summary={root,count,auditProfile:audit,phases:results,realModelExecutions:0,uiOperations:null,pilotPassed:false};
save(join(root,'prepared-supervisor.json'),summary);console.log(JSON.stringify(summary,null,2));
process.exitCode=results.length===2&&results.every(r=>r.code===0)?0:2;
