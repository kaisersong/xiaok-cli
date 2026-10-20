import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {CodexNativeService} from '../../electron/codex-native-service';
const actor={requestSource:'user' as const,actorId:'native-public-user'};
class Client{
 threadId:string|null=null;activeTurnId:string|null=null;n=0;wire:string[]=[];
 constructor(readonly options:any){}
 async connect(){}async assertNoExternalTools(){}async create(){this.threadId='new-thread';return {thread:{id:this.threadId}};}async resume(id:string){this.threadId=id;}
 async start(text:string){this.wire.push(text);this.activeTurnId='turn-'+ ++this.n;this.emit('turn/started',{turn:{id:this.activeTurnId}});return {turnId:this.activeTurnId};}
 async steer(text:string){this.wire.push(text);return {turnId:this.activeTurnId};}async interrupt(){}async close(){}
 emit(method:string,params:any){this.options.onEvent({method,params:{threadId:this.threadId,turnId:this.activeTurnId,...params}});if(method==='turn/completed')this.activeTurnId=null;}
}
function fixture(){const root=mkdtempSync(join(tmpdir(),'native-public-')),dbPath=join(root,'native.sqlite'),clients:Client[]=[];const options={dbPath,profileId:actor.actorId,createClient:(o:any)=>{const c=new Client(o);clients.push(c);return c as any;}};let service=new CodexNativeService(options);return {root,dbPath,clients,get service(){return service;},async restart(){await service.dispose();service=new CodexNativeService(options);},async close(){await service.dispose();rmSync(root,{recursive:true,force:true});}};}
describe('native owner public source before display trim',()=>{
 it('retains full early history and assistant bytes across >200 display items and restart',async()=>{const f=fixture();try{
  const s=await f.service.create(actor,f.root),client=f.clients[0],long='早期约束🙂'.repeat(16000);
  for(let i=0;i<105;i++){await f.service.send(actor,s.id,'work-'+i,'wire-'+i);client.emit('item/completed',{item:{id:'answer-'+i,type:'agentMessage',text:i===0?long:'answer-'+i}});client.emit('turn/completed',{turn:{id:client.activeTurnId,status:'completed'}});}
  expect(f.service.get(actor,s.id).messages).toHaveLength(200);expect(f.service.get(actor,s.id).messages.some(m=>m.text==='work-0')).toBe(false);
  const full=(f.service as any).readPublicSource(actor,s.id);expect(full.coverage).toBe('complete');expect(full.messages).toHaveLength(210);expect(full.messages[0].text).toBe('work-0');expect(full.messages[1].text).toBe(long);expect(full.messages.at(-1).text).toBe('answer-104');
  full.messages[0].text='caller copy';await f.restart();const restored=(f.service as any).readPublicSource(actor,s.id);expect(restored.sourceEpoch).toBe(full.sourceEpoch);expect(restored.committedSequence).toBeGreaterThan(full.committedSequence);expect(restored.gapAfterSequence).toBe(full.committedSequence);expect(restored.coverage).toBe('unknown_gap');expect(restored.messages[0].text).toBe('work-0');
 }finally{await f.close();}});
 it('separates main-composed wire context from literal public work without sentinel guessing',async()=>{const f=fixture();try{
  const s=await f.service.create(actor,f.root),prompt='Previous conversation context:\n用户自己输入的标记🙂';
  const receipt=await (f.service as any).sendWork(actor,s.id,{prompt,contextText:'PRIVATE_HISTORY_WRAPPER',attachmentsText:'controlled attachment refs'},'wire-work');
  expect(f.clients[0].wire[0]).toContain('PRIVATE_HISTORY_WRAPPER');expect(f.clients[0].wire[0]).toContain(prompt);expect(f.service.get(actor,s.id).messages).toEqual([{id:receipt.messageId,role:'user',text:prompt,state:'sent'}]);
  const full=(f.service as any).readPublicSource(actor,s.id);expect(full.messages.map((m:any)=>[m.messageId,m.text])).toEqual([[receipt.messageId,prompt]]);expect(JSON.stringify(full)).not.toContain('PRIVATE_HISTORY_WRAPPER');
  const db=new DatabaseSync(f.dbPath,{readOnly:true});try{const row=db.prepare('SELECT * FROM codex_native_sends WHERE id=?').get('wire-work')!;expect(row.public_text).toBe(prompt);const envelope=JSON.parse(String(row.envelope));expect(envelope.turnPurpose).toBe('work_with_context');const wire=Buffer.from(String(row.text));let end=0;for(const segment of envelope.segments){expect(segment.startByte).toBe(end);end=segment.endByte;const bytes=wire.subarray(segment.startByte,segment.endByte);if(segment.kind!=='transport')expect(bytes.toString()).toBe(segment.kind==='work'?prompt:segment.kind==='context'?'PRIVATE_HISTORY_WRAPPER':'controlled attachment refs');}expect(end).toBe(wire.length);}finally{db.close();}
 }finally{await f.close();}});
 it('ordinary native text containing wrapper-looking strings remains exactly the user input',async()=>{const f=fixture();try{
  const s=await f.service.create(actor,f.root),prompt='Previous conversation context:\nUSER_LITERAL\nAttached working copies:\nUSER_LITERAL_2';await f.service.send(actor,s.id,prompt,'literal');
  expect((f.service as any).readPublicSource(actor,s.id).messages[0].text).toBe(prompt);expect(f.clients[0].wire[0]).toBe(prompt);
 }finally{await f.close();}});
 it('exports assistant public text and ignores reasoning, command input and provider user echoes',async()=>{const f=fixture();try{
  const s=await f.service.create(actor,f.root);await f.service.send(actor,s.id,'work','wire-1');const c=f.clients[0];
  c.emit('item/agentMessage/delta',{itemId:'a',delta:'公开'});c.emit('item/agentMessage/delta',{itemId:'a',delta:'回答'});c.emit('item/completed',{item:{id:'a',type:'agentMessage',text:'公开回答'}});
  for(const type of ['reasoning','commandExecution','userMessage'])c.emit('item/completed',{item:{id:'private-'+type,type,text:'PRIVATE_SHOULD_NOT_EXPORT',arguments:'PRIVATE_SHOULD_NOT_EXPORT'}});
  const full=(f.service as any).readPublicSource(actor,s.id);expect(full.messages.map((m:any)=>m.text)).toEqual(['work','公开回答']);expect(JSON.stringify(full)).not.toContain('PRIVATE_SHOULD_NOT_EXPORT');expect(()=> (f.service as any).readPublicSource({...actor,requestSource:'agent'},s.id)).toThrow('native_access_denied');
 }finally{await f.close();}});
 it('never promotes an old bounded native snapshot to complete coverage',async()=>{const f=fixture();try{
  const s=await f.service.create(actor,f.root);await f.service.send(actor,s.id,'old input','old');await f.service.dispose();const db=new DatabaseSync(f.dbPath);db.exec('DELETE FROM codex_native_public_events; DELETE FROM codex_native_public_messages; DELETE FROM codex_native_public_sources');db.close();await f.restart();
  expect((f.service as any).readPublicSource(actor,s.id).coverage).toBe('bounded_legacy');
 }finally{await f.close();}});
});

it('accumulates repeated delta-only text in the full source even after display clipping and eviction',async()=>{const f=fixture();try{
 const s=await f.service.create(actor,f.root);await f.service.send(actor,s.id,'work','w');const c=f.clients[0],chunk='中🙂'.repeat(14000);for(let i=0;i<4;i++)c.emit('item/agentMessage/delta',{itemId:'early-answer',delta:chunk});
 for(let i=0;i<205;i++)c.emit('item/completed',{item:{id:'later-'+i,type:'agentMessage',text:'later'}});c.emit('item/agentMessage/delta',{itemId:'early-answer',delta:' final delta'});
 expect((f.service as any).readPublicSource(actor,s.id).messages.find((m:any)=>m.messageId==='early-answer').text).toBe(chunk.repeat(4)+' final delta');
}finally{await f.close();}});
it('rejects isolated Unicode surrogates rather than corrupting public work or wire byte ranges',async()=>{const f=fixture();try{
 const s=await f.service.create(actor,f.root);for(const text of ['bad\ud800','\udc00bad'])await expect(f.service.send(actor,s.id,text,'invalid-'+text.length)).rejects.toThrow('native_invalid_message');expect(f.clients[0].wire).toEqual([]);
}finally{await f.close();}});
it('a disconnected source retains its known prefix and never regains complete coverage on resume',async()=>{const f=fixture();try{
 const s=await f.service.create(actor,f.root);await f.service.send(actor,s.id,'before gap','before');const before=(f.service as any).readPublicSource(actor,s.id);await f.service.disconnect(actor,s.id);await f.service.send(actor,s.id,'after gap','after');const after=(f.service as any).readPublicSource(actor,s.id);
 expect(after.coverage).toBe('unknown_gap');expect(after.sourceEpoch).toBe(before.sourceEpoch);expect(after.gapAfterSequence).toBe(before.committedSequence);expect(after.committedSequence).toBeGreaterThan(before.committedSequence);expect(after.messages.map((m:any)=>m.text)).toEqual(['before gap','after gap']);
}finally{await f.close();}});

it('fresh native ID, qualification and complete source epoch cannot partially commit',async()=>{const f=fixture();try{
 const db=new DatabaseSync(f.dbPath);db.exec("CREATE TRIGGER reject_fresh_binding BEFORE INSERT ON codex_native_sessions WHEN json_extract(NEW.snapshot,'$.status')='idle' BEGIN SELECT RAISE(ABORT,'fresh binding storage failure'); END");db.close();await expect(f.service.create(actor,f.root)).rejects.toThrow('fresh binding storage failure');
 const inspect=new DatabaseSync(f.dbPath,{readOnly:true});try{expect(inspect.prepare('SELECT native_thread_id,coverage FROM codex_native_public_sources').get()).toMatchObject({native_thread_id:null,coverage:'unknown_gap'});expect(inspect.prepare('SELECT native_id FROM codex_native_sessions').get()?.native_id).toBeNull();expect(inspect.prepare('SELECT COUNT(*) AS n FROM codex_native_context_qualifications').get()?.n).toBe(0);}finally{inspect.close();}
}finally{await f.close();}});
it('public event persistence failure creates a sticky gap and forbids a complete export',async()=>{const f=fixture();try{
 const s=await f.service.create(actor,f.root);await f.service.send(actor,s.id,'work','w');const before=(f.service as any).readPublicSource(actor,s.id),db=new DatabaseSync(f.dbPath);db.exec("CREATE TRIGGER reject_delta BEFORE INSERT ON codex_native_public_events WHEN NEW.kind='assistant_delta' BEGIN SELECT RAISE(ABORT,'public source write failed'); END");db.close();
 expect(()=>f.clients[0].emit('item/agentMessage/delta',{itemId:'a',delta:'not committed'})).toThrow('public source write failed');expect(()=> (f.service as any).readPublicSource(actor,s.id)).toThrow('native_public_source_unavailable');
 const inspect=new DatabaseSync(f.dbPath,{readOnly:true});try{expect(inspect.prepare('SELECT coverage,gap_after_sequence FROM codex_native_public_sources').get()).toMatchObject({coverage:'unknown_gap',gap_after_sequence:before.committedSequence});}finally{inspect.close();}
}finally{await f.close();}});
it('actual ACK disposition changes advance the same owner cursor and user revision',async()=>{const f=fixture();try{
 const s=await f.service.create(actor,f.root),c=f.clients[0];let release!:(r:{turnId:string})=>void,entered!:()=>void;const pending=new Promise<{turnId:string}>(r=>release=r),inside=new Promise<void>(r=>entered=r);c.start=async()=>{c.activeTurnId='turn-ack';c.emit('turn/started',{turn:{id:c.activeTurnId}});entered();return pending;};
 const sending=f.service.send(actor,s.id,'work','work');await inside;const before=(f.service as any).readPublicSource(actor,s.id);release({turnId:'turn-ack'});await sending;const after=(f.service as any).readPublicSource(actor,s.id);
 expect(after.messages[0].deliveryState).toBe('sent');expect(after.messages[0].turnId).toBe('turn-ack');expect(after.messages[0].revision).toBeGreaterThan(before.messages[0].revision);expect(after.committedSequence).toBeGreaterThan(before.committedSequence);
}finally{await f.close();}});
it('context segments alone cannot create an unauthorized priming turn',async()=>{const f=fixture();try{
 const s=await f.service.create(actor,f.root);await expect(f.service.sendWork(actor,s.id,{prompt:' ',contextText:'reference-only context'},'no-work')).rejects.toThrow('native_invalid_message');expect(f.clients[0].wire).toEqual([]);
}finally{await f.close();}});
