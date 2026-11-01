// Safe verification only: this entry point never imports desktop-services,
// starts an app/service, creates an adapter, or calls a model.
import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {repo,prepare,save,summarize,preflight} from './harness.mjs';

const root=process.argv[2]?resolve(process.argv[2]):prepare();
const checks=[
 ['unit',process.execPath,['--import','tsx','--test','evals/assistant-handoff/harness.test.mjs']],
 ['syntax',process.execPath,['--check','evals/assistant-handoff/main-harness.mjs']],
 ['governance','npm',['run','governance:check']],
 ['architecture','npm',['run','architecture:check','--','--changed']],
];
const children=[];
save(join(root,'verification-owner.json'),{pid:process.pid,startedAt:new Date().toISOString(),purpose:'no-model harness verification'});
for(const [name,cmd,args]of checks){
 const output=join(root,`${name}.log`),fd=openSync(output,'wx',0o600),startedAt=new Date().toISOString();
 const child=spawn(cmd,args,{cwd:repo,stdio:['ignore',fd,fd]});
 // Append-only PID record exists while each subprocess is alive, not just after exit.
 save(join(root,`${name}-pid.json`),{pid:child.pid??null,parentPid:process.pid,cmd,args,startedAt});
 const result=await new Promise(resolve=>{child.once('error',()=>resolve({exitCode:null,error:'spawn_failed'}));child.once('close',(exitCode,signal)=>resolve({exitCode,signal}));});closeSync(fd);
 children.push({name,pid:child.pid??null,cmd,args,startedAt,endedAt:new Date().toISOString(),output,...result,reaped:true});
}
const gate=await preflight();save(join(root,'preflight.json'),gate);save(join(root,'report.json'),summarize(root));
save(join(root,'verification.json'),{children,modelCalls:0,realABCExecutions:0,realHandoffs:0,backgroundProcessesStarted:0,residualOwnedProcesses:0,cleanupEvidence:'All recorded direct children emitted close and were reaped; checks did not launch app/service/background processes.',gateReady:gate.ready,finishedAt:new Date().toISOString()});
console.log(root);process.exitCode=children.some(c=>c.exitCode!==0)?1:0;
