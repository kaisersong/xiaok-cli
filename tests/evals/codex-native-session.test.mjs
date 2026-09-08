import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionProbe, resolveLaunch } from '../../scripts/evals/codex-native-session/session-probe.mjs';

const fixture = `
import { createInterface } from 'node:readline';
const send = x => process.stdout.write(JSON.stringify(x)+'\\n');
let turn=0, late=false;
for await (const line of createInterface({input:process.stdin})) {
 const m=JSON.parse(line); if (!m.method) {send({method:'fixture/decision',params:m});continue;}
 const ok=result=>send({id:m.id,result});
 if(m.method==='initialize')ok({userAgent:'fixture',codexHome:'fixture'});
 else if(m.method==='initialized'){}
 else if(m.method==='thread/start'||m.method==='thread/resume')ok({thread:{id:m.params.threadId||'thread-1'}});
 else if(m.method==='turn/start'){
  const id='turn-'+(++turn), text=m.params.input[0].text; late=text==='late';
  send({method:'turn/started',params:{threadId:'thread-1',turn:{id,status:'inProgress'}}});
  if(text==='early')send({method:'turn/completed',params:{threadId:'thread-1',turn:{id,status:'completed'}}});
  if(text==='approval')for(const method of ['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval','mcpServer/elicitation/request','unknown/request'])send({id:method,method,params:{threadId:'thread-1',turnId:id,itemId:'item-1'}});
  if(text==='foreign')send({method:'turn/completed',params:{threadId:'foreign',turn:{id,status:'completed'}}});
  if(text==='crash'){process.exit(4);}
  if(text==='malformed'){process.stdout.write('not-json\\n');continue;}
  if(text==='oversized'){process.stdout.write('x'.repeat(1024*1024+1));continue;}
  if(text==='hang')continue;
  ok({turn:{id,status:'inProgress'}});
 }else if(m.method==='turn/steer')ok({turnId:m.params.expectedTurnId});
 else if(m.method==='turn/interrupt'){
  if(late){late=false;send({id:m.id,error:{code:-32600,message:'no active turn to interrupt'}});continue;}
  ok({});send({method:'turn/completed',params:{threadId:m.params.threadId,turn:{id:m.params.turnId,status:'interrupted'}}});
 }else if(m.method==='fixture/malformed'){process.stdout.write('not-json\\n');}
}
`;
async function setup(t, extra={}) {
 const dir=await mkdtemp(join(tmpdir(),'xiaok-codex-contract-'));const file=join(dir,'fixture.mjs');await writeFile(file,fixture);
 const probe=new SessionProbe({executable:process.execPath,prefixArgs:[file],cwd:dir,timeoutMs:1500,...extra});
 t.after(async()=>{await probe.close();await rm(dir,{recursive:true,force:true,maxRetries:3});});
 await probe.connect();await probe.create();return probe;
}
test('real stdio handshake, thread creation and same-turn steering',async t=>{
 const p=await setup(t);assert.equal(p.threadId,'thread-1');const turn=await p.start('active');
 assert.deepEqual(await p.steer('extra'),{turnId:turn.turnId});assert.equal(p.activeTurnId,turn.turnId);
});
test('completion that precedes RPC response remains authoritative',async t=>{
 const p=await setup(t);const turn=await p.start('early');const e=await p.waitFor('turn/completed',e=>e.params.turn.id===turn.turnId);
 assert.equal(e.params.turn.status,'completed');assert.equal(p.activeTurnId,null);await p.start('active');
});
test('interrupt waits for terminal event, not only acknowledgement',async t=>{
 const p=await setup(t);await p.start('active');const end=await p.interrupt();assert.equal(end.params.turn.status,'interrupted');assert.equal(p.activeTurnId,null);
});
test('all approval siblings are denied and unknown requests fail closed',async t=>{
 const p=await setup(t);await p.start('approval');
 for(const method of ['item/commandExecution/requestApproval','item/fileChange/requestApproval']){
  const e=await p.waitFor('fixture/decision',e=>e.params.id===method);assert.deepEqual(e.params.result,{decision:'decline'});
 }
 assert.deepEqual((await p.waitFor('fixture/decision',e=>e.params.id==='item/permissions/requestApproval')).params.result,{permissions:{},scope:'turn'});
 assert.deepEqual((await p.waitFor('fixture/decision',e=>e.params.id==='mcpServer/elicitation/request')).params.result,{action:'decline',content:null});
 assert.equal((await p.waitFor('fixture/decision',e=>e.params.id==='unknown/request')).params.error.code,-32601);
});
test('foreign completion does not settle or clear the owned turn',async t=>{
 const p=await setup(t);const turn=await p.start('foreign');assert.equal(p.activeTurnId,turn.turnId);
 await assert.rejects(p.waitFor('turn/completed',e=>e.params.threadId===p.threadId,{timeoutMs:25}),/event timeout/);
 assert.equal((await p.interrupt()).params.threadId,p.threadId);
});
test('overlapping starts are rejected; idle steer and interrupt reject',async t=>{
 const p=await setup(t);await assert.rejects(p.steer('no'),/no active turn/);await assert.rejects(p.interrupt(),/no active turn/);
 const first=p.start('active');await assert.rejects(p.start('second'),/active turn/);await first;
});
test('process crash rejects pending RPC and event waiters',async t=>{
 const p=await setup(t);const waiting=p.waitFor('missing',()=>true);const check=assert.rejects(waiting,/closed|exited/);
 await assert.rejects(p.start('crash'),/closed|exited/);await check;
});
test('RPC timeout poisons the connection; mutation is not automatically retried',async t=>{
 const p=await setup(t,{timeoutMs:70});await assert.rejects(p.start('hang'),/RPC timeout/);await assert.rejects(p.start('again'),/closed|RPC timeout/);
});
test('close is idempotent and process exit is observed',async t=>{
 const p=await setup(t);const pid=p.pid;await p.close();await p.close();assert.equal(p.exited,true);assert.throws(()=>process.kill(pid,0));
});
test('new client can resume a persisted native handle',async t=>{
 const p=await setup(t);await p.close();const next=new SessionProbe({...p.options});t.after(()=>next.close());await next.connect();await next.resume('thread-1');assert.equal(next.threadId,'thread-1');
});
test('Windows shim is never spawned; explicit native executable and JS paths supported',()=>{
 assert.throws(()=>resolveLaunch('C:\\tools\\codex.cmd',[],'win32'),/real.*entry|shim/);
 assert.deepEqual(resolveLaunch('C:\\tools\\codex.exe',['app-server'],'win32'),{command:'C:\\tools\\codex.exe',args:['app-server']});
 assert.deepEqual(resolveLaunch('/tmp/codex.js',['app-server'],'darwin'),{command:process.execPath,args:['/tmp/codex.js','app-server']});
});

for (const kind of ['malformed', 'oversized']) test(`${kind} protocol data terminates the connection`, async t => {
 const p = await setup(t); await assert.rejects(p.start(kind), /protocol frame/);
 await assert.rejects(p.start('again'), /protocol frame|closed/);
});

test('missing executable rejects handshake and cleanup still completes', async () => {
 const p = new SessionProbe({executable:join(tmpdir(),'xiaok-missing-'+process.pid),timeoutMs:1000});
 await assert.rejects(p.connect(), /ENOENT/); await p.close(); assert.equal(p.exited,true);
});

test('interrupt retries only explicit not-yet-active rejection and waits for terminal',async t=>{const p=await setup(t);await p.start('late');assert.equal((await p.interrupt()).params.turn.status,'interrupted');});
