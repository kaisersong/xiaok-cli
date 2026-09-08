import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexNativeService } from '../../electron/codex-native-service';

class FakeClient {
  threadId: string | null = null; activeTurnId: string | null = null; pid = 1; exited = false;
  options: any; n = 0; steers: string[] = []; approvals: any[] = [];
  constructor(options: any) { this.options = options; }
  async connect() {}
  async create() { this.threadId = 'native-1'; return { thread: {id:this.threadId} }; }
  async resume(id: string) { this.threadId = id; }
  async start(text: string) { this.activeTurnId = 'turn-' + ++this.n; this.emit('turn/started',{thread:{},turn:{id:this.activeTurnId,status:'inProgress'}}); return {turnId:this.activeTurnId}; }
  async steer(text: string) { this.steers.push(text); return {turnId:this.activeTurnId}; }
  async interrupt() { this.emit('turn/completed',{turn:{id:this.activeTurnId,status:'interrupted'}}); this.activeTurnId = null; }
  async close() { this.exited = true; }
  emit(method: string, params: any) { if(method==='turn/completed'&&params.turn.id===this.activeTurnId)this.activeTurnId=null; this.options.onEvent({method,params:{threadId:this.threadId,turnId:this.activeTurnId,...params}}); }
  request(method: string, params: any = {}) { if(method==='item/fileChange/requestApproval')this.emit('item/started',{item:{id:'i',type:'fileChange',changes:[{path:'file',diff:'+test'}]}}); return this.options.onApproval({id:1,method,params:{threadId:this.threadId,turnId:this.activeTurnId,itemId:'i',...params}}); }
}
const user = { requestSource:'user' as const, actorId:'user-1' };
async function setup() {
 const dir=mkdtempSync(join(tmpdir(),'native-service-')); const clients:FakeClient[]=[];
 const service=new CodexNativeService({dbPath:join(dir,'native.sqlite'),profileId:'user-1',createClient:(options:any)=>{const c=new FakeClient(options);clients.push(c);return c as any;},approvalTimeoutMs:40});
 return {service,clients,dir,cleanup:async()=>{await service.dispose();rmSync(dir,{recursive:true,force:true});}};
}
describe('native service ownership and lifecycle',()=>{
 it('denies agent/scheduler/foreign user mutations',async()=>{const s=await setup();try{
  for(const auth of [{...user,requestSource:'agent'},{...user,requestSource:'scheduler'},{...user,actorId:'other'}]) await expect(s.service.create(auth as any,s.dir)).rejects.toThrow(/denied/);
 }finally{await s.cleanup();}});
 it('queues immediate input then steers only after output; interrupts clear queue',async()=>{const s=await setup();try{
  const row=await s.service.create(user,s.dir);await s.service.send(user,row.id,'first');await s.service.send(user,row.id,'second');
  expect(s.clients[0].steers).toEqual([]);s.clients[0].emit('item/agentMessage/delta',{itemId:'a',delta:'hello'});await new Promise(r=>setTimeout(r,10));
  expect(s.clients[0].steers).toEqual(['second']);await s.service.interrupt(user,row.id);expect(s.service.get(user,row.id).status).toBe('idle');
 }finally{await s.cleanup();}});
 it('issues one-use approval bound to owned thread and revokes on timeout',async()=>{const s=await setup();try{
  const row=await s.service.create(user,s.dir);await s.service.send(user,row.id,'first');const promise=s.clients[0].request('item/commandExecution/requestApproval',{command:'echo test'});
  const approval=s.service.get(user,row.id).approvals[0];expect(approval).toBeTruthy();
  await expect(s.service.decide({...user,actorId:'other'},row.id,approval.token,'allow')).rejects.toThrow(/denied/);
  await s.service.decide(user,row.id,approval.token,'allow');expect(await promise).toEqual({decision:'accept'});
  await expect(s.service.decide(user,row.id,approval.token,'allow')).rejects.toThrow(/approval/);
  const pending=s.clients[0].request('item/fileChange/requestApproval');expect(await pending).toEqual({decision:'decline'});
  expect(s.service.get(user,row.id).approvals).toHaveLength(0);
 }finally{await s.cleanup();}});
 it('foreign approval and sibling permissions cannot grant access',async()=>{const s=await setup();try{
  const row=await s.service.create(user,s.dir);await s.service.send(user,row.id,'first');
  expect(await s.clients[0].request('item/commandExecution/requestApproval',{threadId:'foreign'})).toEqual({decision:'decline'});
  expect(await s.clients[0].request('item/permissions/requestApproval')).toEqual({permissions:{},scope:'turn'});
  expect(s.service.get(user,row.id).approvals).toHaveLength(0);
 }finally{await s.cleanup();}});
 it('disconnect revokes approval and next send resumes persisted native ID',async()=>{const s=await setup();try{
  const row=await s.service.create(user,s.dir);await s.service.send(user,row.id,'first');const pending=s.clients[0].request('item/fileChange/requestApproval');
  await s.service.disconnect(user,row.id);expect(await pending).toEqual({decision:'decline'});expect(s.clients[0].exited).toBe(true);
  await s.service.send(user,row.id,'resume');expect(s.clients[1].threadId).toBe('native-1');
 }finally{await s.cleanup();}});
});
it('stale completion cannot cancel a newer turn or its approval',async()=>{const s=await setup();try{
 const row=await s.service.create(user,s.dir);await s.service.send(user,row.id,'first');
 s.clients[0].emit('turn/completed',{turn:{id:'foreign-turn',status:'completed'}});
 expect(s.service.get(user,row.id).status).toBe('running');
 const pending=s.clients[0].request('item/commandExecution/requestApproval',{command:'echo bound'});
 const token=s.service.get(user,row.id).approvals[0].token;await s.service.interrupt(user,row.id);expect(await pending).toEqual({decision:'decline'});
 await expect(s.service.decide(user,row.id,token,'allow')).rejects.toThrow(/approval/);
}finally{await s.cleanup();}});
it('cold service restart restores only owned mappings and rejects foreign IDs',async()=>{const s=await setup();let next:CodexNativeService|undefined;try{
 const row=await s.service.create(user,s.dir);await s.service.send(user,row.id,'remember');await s.service.dispose();
 next=new CodexNativeService({dbPath:join(s.dir,'native.sqlite'),profileId:user.actorId,createClient:options=>new FakeClient(options) as any});
 expect(next.get(user,row.id).status).toBe('disconnected');await expect(next.send(user,'arbitrary-native-id','hello')).rejects.toThrow(/denied/);
 await next.send(user,row.id,'continue');expect(next.get(user,row.id).messages.map(m=>m.text)).toEqual(['remember','continue']);
}finally{await next?.dispose();await s.cleanup();}});
it('server-resolved approval is revoked before a late user decision',async()=>{const s=await setup();try{
 const row=await s.service.create(user,s.dir);await s.service.send(user,row.id,'first');
 const pending=s.clients[0].request('item/commandExecution/requestApproval',{command:'echo test'});const token=s.service.get(user,row.id).approvals[0].token;
 s.clients[0].emit('serverRequest/resolved',{requestId:1});expect(await pending).toEqual({decision:'decline'});
 await expect(s.service.decide(user,row.id,token,'allow')).rejects.toThrow(/approval/);
}finally{await s.cleanup();}});
it('queued input becomes a new turn if the previous turn completes without output',async()=>{const s=await setup();try{
 const row=await s.service.create(user,s.dir);await s.service.send(user,row.id,'first');await s.service.send(user,row.id,'second');
 s.clients[0].emit('turn/completed',{turn:{id:'turn-1',status:'completed'}});await new Promise(r=>setTimeout(r,10));
 expect(s.clients[0].n).toBe(2);expect(s.service.get(user,row.id).queued).toBe(0);expect(s.service.get(user,row.id).messages.every(m=>m.state==='sent')).toBe(true);
}finally{await s.cleanup();}});
it('limits concurrent native processes and allows reconnect after one disconnects',async()=>{const s=await setup();try{
 const first=await s.service.create(user,s.dir);for(let i=0;i<3;i++)await s.service.create(user,s.dir);
 await expect(s.service.create(user,s.dir)).rejects.toThrow(/limit/);await s.service.disconnect(user,first.id);await s.service.send(user,first.id,'resume');
 expect(s.service.get(user,first.id).status).toBe('running');
}finally{await s.cleanup();}});
it('an uncertain RPC result is visible as unknown rather than an unsent cancellation',async()=>{const s=await setup();try{
 const row=await s.service.create(user,s.dir);s.clients[0].start=async()=>{throw new Error('RPC timeout: turn/start');};
 await expect(s.service.send(user,row.id,'possibly delivered')).rejects.toThrow(/timeout/);
 expect(s.service.get(user,row.id).messages[0].state).toBe('unknown');
}finally{await s.cleanup();}});
