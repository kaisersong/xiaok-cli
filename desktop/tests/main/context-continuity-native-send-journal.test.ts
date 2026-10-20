import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fork} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {CodexNativeService} from '../../electron/codex-native-service';
const actor={requestSource:'user' as const,actorId:'journal-user'};
class Client {
 threadId:string|null=null;activeTurnId:string|null=null;starts:string[]=[];steers:string[]=[];beforeStart?:()=>void;failure=false;
 constructor(readonly options:any){}
 async connect(){} async assertNoExternalTools(){} async create(){this.threadId='native-thread';return {thread:{id:this.threadId}};}async resume(id:string){this.threadId=id;}
 async start(text:string){this.beforeStart?.();this.starts.push(text);if(this.failure)throw new Error('RPC timeout: turn/start');this.activeTurnId='turn-1';this.emit('turn/started',{turn:{id:this.activeTurnId}});return {turnId:this.activeTurnId};}
 async steer(text:string){this.beforeStart?.();this.steers.push(text);if(this.failure)throw new Error('RPC timeout: turn/steer');return {turnId:this.activeTurnId};}
 emit(method:string,params:any){this.options.onEvent({method,params:{threadId:this.threadId,turnId:this.activeTurnId,...params}});}
 async close(){} async interrupt(){}
}
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'native-send-journal-')),dbPath=join(root,'native.sqlite'),clients:Client[]=[];let deny=false;
 const options={dbPath,profileId:actor.actorId,authorizeExecution:()=>{if(deny)throw new Error('admission_revoked');},createClient:(o:any)=>{const c=new Client(o);clients.push(c);return c as any;}};
 let service=new CodexNativeService(options);
 const read=()=>{const db=new DatabaseSync(dbPath,{readOnly:true});try{return db.prepare('SELECT * FROM codex_native_sends ORDER BY sequence').all();}finally{db.close();}};
 return {root,clients,read,get service(){return service;},deny(){deny=true;},allow(){deny=false;},async restart(){await service.dispose();service=new CodexNativeService(options);},async close(){await service.dispose();rmSync(root,{recursive:true,force:true});}};
}
describe('actual NativeService durable send intent',()=>{
 it('commits exact intent before start, and concurrent same ID sends once',async()=>{const f=fixture();try{
  const session=await f.service.create(actor,f.root);f.clients[0].beforeStart=()=>{const rows=f.read();expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({id:'wire-1',session_id:session.id,text:'original work',status:'send_intent'});expect(JSON.parse(String(rows[0].binding))).toMatchObject({nativeThreadId:'native-thread',kind:'start',activeTurnId:null});};
  const [a,b]=await Promise.all([f.service.send(actor,session.id,'original work','wire-1'),f.service.send(actor,session.id,'original work','wire-1')]);
  expect(a).toBeTruthy();expect(b).toEqual(a);expect(f.clients[0].starts).toEqual(['original work']);expect(f.read()[0].status).toBe('accepted');expect(f.service.get(actor,session.id).messages.filter(m=>m.role==='user')).toHaveLength(1);
  await expect(f.service.send(actor,session.id,'changed work','wire-1')).rejects.toThrow('native_send_conflict');
 }finally{await f.close();}});
 it('retains a lost ACK as unknown and never repeats it across same/new IDs or restart',async()=>{const f=fixture();try{
  const session=await f.service.create(actor,f.root);f.clients[0].failure=true;
  await expect(f.service.send(actor,session.id,'possibly executed','wire-unknown')).rejects.toThrow('RPC timeout');
  expect(f.read()[0].status).toBe('unknown');await expect(f.service.send(actor,session.id,'possibly executed','wire-unknown')).rejects.toThrow('native_send_unknown');
  await expect(f.service.send(actor,session.id,'new work','wire-new')).rejects.toThrow('native_send_unknown');
  await f.restart();await expect(f.service.send(actor,session.id,'possibly executed','wire-unknown')).rejects.toThrow('native_send_unknown');await expect(f.service.send(actor,session.id,'new work','wire-new')).rejects.toThrow('native_send_unknown');
  expect(f.clients).toHaveLength(1);expect(f.clients[0].starts).toHaveLength(1);
 }finally{await f.close();}});
 it('returns the original durable accepted receipt after restart without reconnect or another turn',async()=>{const f=fixture();try{
  const session=await f.service.create(actor,f.root),receipt=await f.service.send(actor,session.id,'once','wire-accepted');await f.restart();
  expect(await f.service.send(actor,session.id,'once','wire-accepted')).toEqual(receipt);expect(f.clients).toHaveLength(1);
  expect((f.service as any).getSendState(actor,session.id,'wire-accepted')).toMatchObject({wireSendId:'wire-accepted',status:'accepted',receipt});
  expect(()=> (f.service as any).getSendState({...actor,requestSource:'agent'},session.id,'wire-accepted')).toThrow('native_access_denied');
 }finally{await f.close();}});
 it('keeps queued transport cancellation and original input identity without pretending it was delivered',async()=>{const f=fixture();try{
  const session=await f.service.create(actor,f.root);await f.service.send(actor,session.id,'first','wire-first');expect(await f.service.send(actor,session.id,'queued future input','wire-pending')).toBeNull();
  await f.service.disconnect(actor,session.id);const pending=f.read().find(r=>r.id==='wire-pending');expect(pending).toMatchObject({text:'queued future input',status:'transport_cancelled'});expect(pending?.binding).toBeNull();
  await expect(f.service.send(actor,session.id,'queued future input','wire-pending')).rejects.toThrow('native_send_transport_cancelled');expect(f.clients[0].starts).toEqual(['first']);
 }finally{await f.close();}});
 it('denies pre-admission without send intent and retains an identifiable unsent record',async()=>{const f=fixture();try{
  const session=await f.service.create(actor,f.root);f.deny();await expect(f.service.send(actor,session.id,'not admitted','wire-denied')).rejects.toThrow('admission_revoked');
  expect(f.clients[0].starts).toEqual([]);expect(f.read()[0]).toMatchObject({id:'wire-denied',status:'queued',binding:null});
 }finally{await f.close();}});
 it('writes a steer intent for exactly the queued original IDs before sending',async()=>{const f=fixture();try{
  const session=await f.service.create(actor,f.root);await f.service.send(actor,session.id,'first','wire-first');await f.service.send(actor,session.id,'second','wire-second');
  f.clients[0].beforeStart=()=>{const row=f.read().find(r=>r.id==='wire-second');expect(row?.status).toBe('send_intent');expect(JSON.parse(String(row?.binding))).toMatchObject({kind:'steer',activeTurnId:'turn-1'});};
  f.clients[0].emit('item/agentMessage/delta',{itemId:'assistant',delta:'ready'});await new Promise(r=>setTimeout(r,10));
  expect(f.clients[0].steers).toEqual(['second']);expect(f.read().find(r=>r.id==='wire-second')?.status).toBe('accepted');
 }finally{await f.close();}});
});

it('a cancel barrier catches an input waiting in actual setup and it cannot appear in the next turn',async()=>{const f=fixture();try{
 const session=await f.service.create(actor,f.root);let release!:()=>void,entered!:()=>void;const inside=new Promise<void>(r=>entered=r),latched=new Promise<void>(r=>release=r);
 f.clients[0].assertNoExternalTools=async()=>{entered();await latched;};
 const first=f.service.send(actor,session.id,'cancelled during setup','wire-late');const firstResult=first.then(()=>null,e=>e);await inside;const stopped=f.service.interrupt(actor,session.id);release();
 expect((await firstResult)?.message).toBe('native_send_transport_cancelled');await stopped;f.clients[0].assertNoExternalTools=async()=>{};
 expect(f.read().find(r=>r.id==='wire-late')?.status).toBe('transport_cancelled');await f.service.send(actor,session.id,'new input','wire-new');expect(f.clients[0].starts).toEqual(['new input']);await f.restart();
 await expect(f.service.send(actor,session.id,'cancelled during setup','wire-late')).rejects.toThrow('native_send_transport_cancelled');
}finally{await f.close();}});
it('immediate-only Bridge delivery cancels an unsent queue record before reporting busy',async()=>{const f=fixture();try{
 const session=await f.service.create(actor,f.root);await f.service.send(actor,session.id,'first','wire-first');
 await expect((f.service.send as any)(actor,session.id,'must not execute later','wire-bridge',{requireImmediate:true})).rejects.toThrow('native_busy_not_admitted');
 expect(f.read().find(r=>r.id==='wire-bridge')?.status).toBe('transport_cancelled');f.clients[0].emit('item/agentMessage/delta',{itemId:'assistant',delta:'ready'});await new Promise(r=>setTimeout(r,10));expect(f.clients[0].steers).toEqual([]);
}finally{await f.close();}});

it('another flush cannot claim a not-yet-validated immediate-only submission',async()=>{const f=fixture();try{
 const session=await f.service.create(actor,f.root);const a=f.service.send(actor,session.id,'first','wire-first');const b=(f.service.send as any)(actor,session.id,'bridge must fail busy','wire-bridge',{requireImmediate:true});const bResult=b.then(()=>null,(e:Error)=>e);
 await a;expect((await bResult)?.message).toBe('native_busy_not_admitted');expect(f.clients[0].starts).toEqual(['first']);expect(f.read().find(r=>r.id==='wire-bridge')?.status).toBe('transport_cancelled');
}finally{await f.close();}});
it('cancel while RPC is in flight never rewrites actual accepted delivery as a cancelled send',async()=>{const f=fixture();try{
 const session=await f.service.create(actor,f.root);let release!:(v:{turnId:string})=>void,entered!:()=>void;const inside=new Promise<void>(r=>entered=r),pending=new Promise<{turnId:string}>(r=>release=r);
 f.clients[0].start=async(text:string)=>{f.clients[0].starts.push(text);entered();return pending;};const sending=f.service.send(actor,session.id,'in flight','wire-flight');await inside;const stopped=f.service.interrupt(actor,session.id);
 expect(f.read()[0].status).toBe('send_intent');release({turnId:'accepted-before-cancel'});const receipt=await sending;await stopped;expect(receipt?.turnId).toBe('accepted-before-cancel');expect(f.read()[0].status).toBe('accepted');
}finally{await f.close();}});

it('an immediate Bridge preflight denial cannot survive to be executed by a later successful task',async()=>{const f=fixture();try{
 const session=await f.service.create(actor,f.root);f.deny();await expect((f.service.send as any)(actor,session.id,'failed task text','wire-failed',{requireImmediate:true})).rejects.toThrow('admission_revoked');
 expect(f.read().find(r=>r.id==='wire-failed')?.status).toBe('transport_cancelled');f.allow();await f.service.send(actor,session.id,'authorized task','wire-authorized');expect(f.clients[0].starts).toEqual(['authorized task']);
}finally{await f.close();}});

it('restores display disposition from the durable accepted receipt after a stale-view crash point',async()=>{const f=fixture();try{
 const session=await f.service.create(actor,f.root),receipt=await f.service.send(actor,session.id,'accepted work','wire-accepted');await f.service.dispose();const db=new DatabaseSync(join(f.root,'native.sqlite'));
 const raw=JSON.parse(String(db.prepare('SELECT snapshot FROM codex_native_sessions WHERE id=?').get(session.id)?.snapshot));raw.messages.find((m:any)=>m.id===receipt?.messageId).state='queued';db.prepare('UPDATE codex_native_sessions SET snapshot=? WHERE id=?').run(JSON.stringify(raw),session.id);db.close();await f.restart();
 expect(f.service.get(actor,session.id).messages.find(m=>m.id===receipt?.messageId)?.state).toBe('sent');expect(f.clients[0].starts).toEqual(['accepted work']);
}finally{await f.close();}});
it('a real SQLite enqueue rollback restores both display and queued-count memory',async()=>{const f=fixture();try{
 const session=await f.service.create(actor,f.root),db=new DatabaseSync(join(f.root,'native.sqlite'));db.exec("CREATE TRIGGER fail_enqueue BEFORE INSERT ON codex_native_sessions BEGIN SELECT RAISE(ABORT,'test persistence failure'); END");db.close();
 await expect(f.service.send(actor,session.id,'not accepted','wire-rollback')).rejects.toThrow('test persistence failure');expect(f.read()).toEqual([]);expect(f.service.get(actor,session.id).messages).toEqual([]);
 const next=new DatabaseSync(join(f.root,'native.sqlite'));next.exec('DROP TRIGGER fail_enqueue');next.close();await f.service.send(actor,session.id,'accepted','wire-next');expect(f.service.get(actor,session.id).queued).toBe(0);expect(f.clients[0].starts).toEqual(['accepted']);
}finally{await f.close();}});

for(const mode of ['intent','accepted'] as const)it(`real SIGKILL at ${mode} keeps original send identity and never replays it`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'native-send-crash-')),dbPath=join(root,'native.sqlite'),compiled=join(root,'compiled'),worker=fork(resolve('tests/fixtures/continuity-native/send-journal-worker.mjs'),[],{execArgv:[],stdio:['ignore','ignore','ignore','ipc']});let service:CodexNativeService|undefined;
 const exit=new Promise<void>((r,j)=>{worker.once('exit',()=>r());worker.once('error',j);});
 try{
  mkdirSync(compiled);writeFileSync(join(compiled,'package.json'),JSON.stringify({type:'module'}));for(const name of ['codex-native-service','codex-native-transport','codex-native-send-journal','codex-native-public-source']){const source=readFileSync(resolve('electron',name+'.ts'),'utf8');writeFileSync(join(compiled,name+'.js'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);}
  const reached=new Promise<any>((r,j)=>{const timer=setTimeout(()=>j(new Error('crash point timeout')),5000);worker.once('message',m=>{clearTimeout(timer);r(m);});});worker.send({mode,dbPath,cwd:root,moduleUrl:pathToFileURL(join(compiled,'codex-native-service.js')).href});const point=await reached;expect(point.phase).toBe(mode==='intent'?'intent':'accepted-display-failed');
  worker.kill('SIGKILL');await exit;const db=new DatabaseSync(dbPath);expect(db.prepare('SELECT status FROM codex_native_sends WHERE id=?').get('wire-crash')?.status).toBe(mode==='intent'?'send_intent':'accepted');if(mode==='accepted')db.exec('DROP TRIGGER reject_post_accept_display');db.close();
  const clients:Client[]=[];service=new CodexNativeService({dbPath,profileId:actor.actorId,createClient:o=>{const c=new Client(o);clients.push(c);return c as any;}});
  if(mode==='intent'){await expect(service.send(actor,point.sessionId,'synthetic crash-point work','wire-crash')).rejects.toThrow('native_send_unknown');expect(service.get(actor,point.sessionId).messages[0].state).toBe('unknown');}
  else{expect((await service.send(actor,point.sessionId,'synthetic crash-point work','wire-crash'))?.turnId).toBe('turn-accepted');expect(service.get(actor,point.sessionId).messages[0].state).toBe('sent');}
  expect(clients).toEqual([]);expect(()=>process.kill(worker.pid!,0)).toThrow();console.info('native journal crash PID reaped',worker.pid,'mode',mode);
 }finally{if(worker.exitCode===null&&worker.signalCode===null)worker.kill('SIGKILL');await exit;await service?.dispose();rmSync(root,{recursive:true,force:true});}
},10000);
