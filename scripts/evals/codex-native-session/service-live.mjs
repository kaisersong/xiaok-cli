import { CodexNativeService } from '../../../desktop/dist/main/desktop/electron/codex-native-service.js';
import { mkdtemp, readFile, access, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
if(!process.argv.includes('--live')){console.log('Use --live after building desktop main.');process.exit(0);}
const cwd=await mkdtemp(join(tmpdir(),'xiaok-native-product-'));const dbPath=join(cwd,'native.sqlite');const actor={actorId:'native-live-user',requestSource:'user'};
const outputIndex=process.argv.indexOf('--output');
const output=resolve(outputIndex>=0?process.argv[outputIndex+1]:join(cwd,'report.json'));
const result={cwd,at:new Date().toISOString(),gates:{}};let service=new CodexNativeService({dbPath,profileId:actor.actorId});let id;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=180000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const v=await fn();if(v)return v;await sleep(100);}throw new Error('live gate timeout');}
async function idle(){return until(()=>{const s=service.get(actor,id);if(s.status==='error')throw new Error(s.error);return s.status==='idle'&&s.queued===0?s:null;});}
async function gate(name,fn){try{const details=await fn();result.gates[name]={status:'passed',...details};console.log(JSON.stringify({gate:name,...result.gates[name]}));}catch(e){result.gates[name]={status:'failed',error:e.message};console.log(JSON.stringify({gate:name,...result.gates[name]}));await service.disconnect(actor,id);}}
try{
 const row=await service.create(actor,cwd);id=row.id;result.id=id;
 const nonce=randomUUID(),extra='APPEND_'+randomUUID();
 await gate('immediateAppend',async()=>{await service.send(actor,id,`[xiaok production native test] No tools. Remember ${nonce}. Reply briefly.`);await service.send(actor,id,`No tools. Keep the previous remembered token. Change your reply to only ${extra}.`);const queued=service.get(actor,id).queued;const s=await idle();if(!s.messages.some(m=>m.role==='assistant'&&m.text.includes(extra)))throw new Error('append marker not adopted');return {queuedBeforeOutput:queued,markerMatched:true};});
 for(const [name,decision]of [['allow','allow'],['deny','deny']])await gate(name,async()=>{
  const file=name+'.txt';await service.send(actor,id,`Authorized isolated native approval test. Use only the native shell tool to execute exactly once: node -e 'require("node:fs").writeFileSync("${file}","${name}")'. Request approval if needed. No alternate tools or commands; stop if denied.`);
  const pending=await until(()=>{const s=service.get(actor,id);if(s.status==='idle')throw new Error('no approval observed');return s.approvals[0];});
  if(!pending.description.includes(file))throw new Error('unexpected approval command');await service.decide(actor,id,pending.token,decision);await idle();
  let exists=false;try{await access(join(cwd,file));exists=true;}catch{}
  if(exists!==(decision==='allow'))throw new Error('file result differs from decision');return {approvalObserved:true,exists};
 });
 await gate('interrupt',async()=>{await service.send(actor,id,'No tools. Explain 30 sorting algorithms with proofs.');await service.interrupt(actor,id);if(service.get(actor,id).status!=='idle')throw new Error('not idle after interrupted terminal');return {terminalObserved:true};});
 await gate('coldResume',async()=>{await service.dispose();service=new CodexNativeService({dbPath,profileId:actor.actorId});if(service.get(actor,id).status!=='disconnected')throw new Error('unexpected restored state');await service.send(actor,id,'No tools. Reply only with the first remembered UUID from the start of this conversation, not the APPEND marker.');const s=await idle();const answer=s.messages.filter(m=>m.role==='assistant').at(-1)?.text;if(!answer?.includes(nonce))throw new Error('memory mismatch');return {sameProductId:true,tokenMatched:true};});
}finally{await service.dispose();await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log('Report: '+output);if(Object.values(result.gates).some(g=>g.status!=='passed'))process.exitCode=1;}
