import type {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import type {NativeSendReceipt} from './codex-native-service.js';

export type NativeSendStatus='queued'|'send_intent'|'accepted'|'transport_cancelled'|'unknown';
export interface NativeSendBinding {
 connectionGeneration:string;nativeThreadId:string;afterEvent:number;
 kind:'start'|'steer';activeTurnId:string|null;wireHash:string;wireSendIds:string[];
}
export interface NativeSendRecord {
 id:string;sessionId:string;messageId:string;sequence:number;text:string;payloadHash:string;
 publicText:string|null;envelope:unknown;status:NativeSendStatus;generation:number;binding:NativeSendBinding|null;
}
export const nativeSendHash=(text:string)=>createHash('sha256').update(text).digest('hex');
/** Main's transport journal only. Neither delivery status nor parent completion proves physical closure. */
export class NativeSendJournal {
 constructor(private readonly db:DatabaseSync){
  db.exec(`CREATE TABLE IF NOT EXISTS codex_native_send_barriers(session_id TEXT PRIMARY KEY,generation INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS codex_native_sends(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,message_id TEXT NOT NULL UNIQUE,sequence INTEGER NOT NULL,text TEXT NOT NULL,payload_hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('queued','send_intent','accepted','transport_cancelled','unknown')),generation INTEGER NOT NULL,binding TEXT,UNIQUE(session_id,sequence));`);
  for(const column of ['public_text','envelope'])if(!db.prepare('PRAGMA table_info(codex_native_sends)').all().some(r=>r.name===column))db.exec(`ALTER TABLE codex_native_sends ADD COLUMN ${column} TEXT`);
 }
 atomic<T>(run:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=run();this.db.exec('COMMIT');return result;}catch(error){try{this.db.exec('ROLLBACK');}catch{/* Keep the original storage failure. */}throw error;}}
 private generation(sessionId:string):number{return Number(this.db.prepare('SELECT generation FROM codex_native_send_barriers WHERE session_id=?').get(sessionId)?.generation??0);}
 get(id:string):NativeSendRecord|null{
  const r=this.db.prepare('SELECT * FROM codex_native_sends WHERE id=?').get(id);return r?{id:String(r.id),sessionId:String(r.session_id),messageId:String(r.message_id),sequence:Number(r.sequence),text:String(r.text),payloadHash:String(r.payload_hash),publicText:r.public_text===null?null:String(r.public_text),envelope:r.envelope===null?null:JSON.parse(String(r.envelope)),status:r.status as NativeSendStatus,generation:Number(r.generation),binding:r.binding===null?null:JSON.parse(String(r.binding))}:null;
 }
 forMessage(messageId:string):NativeSendRecord|null{const r=this.db.prepare('SELECT id FROM codex_native_sends WHERE message_id=?').get(messageId);return r?this.get(String(r.id)):null;}
 assertKnown(sessionId:string):void{if(this.db.prepare("SELECT 1 FROM codex_native_sends WHERE session_id=? AND status IN ('send_intent','unknown') LIMIT 1").get(sessionId))throw new Error('native_send_unknown');}
 enqueue(id:string,sessionId:string,messageId:string,text:string,publicText:string,envelope:unknown,payloadHash:string):NativeSendRecord{
  this.db.prepare('INSERT OR IGNORE INTO codex_native_send_barriers VALUES (?,0)').run(sessionId);
  const sequence=Number(this.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM codex_native_sends WHERE session_id=?').get(sessionId)!.next);
  this.db.prepare("INSERT INTO codex_native_sends (id,session_id,message_id,sequence,text,payload_hash,status,generation,binding,public_text,envelope) VALUES (?,?,?,?,?,?,'queued',?,NULL,?,?)").run(id,sessionId,messageId,sequence,text,payloadHash,this.generation(sessionId),publicText,JSON.stringify(envelope));return this.get(id)!;
 }
 assertQueued(record:NativeSendRecord):void{
  const current=this.get(record.id);if(!current||current.sessionId!==record.sessionId||current.messageId!==record.messageId||current.payloadHash!==record.payloadHash)throw new Error('native_send_conflict');
  if(current.status==='transport_cancelled'||current.generation!==this.generation(record.sessionId))throw new Error('native_send_transport_cancelled');
  if(current.status!=='queued')throw new Error('native_send_unknown');
 }
 queued(sessionId:string):NativeSendRecord[]{return this.db.prepare("SELECT id FROM codex_native_sends WHERE session_id=? AND generation=? AND status='queued' ORDER BY sequence").all(sessionId,this.generation(sessionId)).map(r=>this.get(String(r.id))!);}
 claim(records:NativeSendRecord[],binding:NativeSendBinding):void{
  for(const r of records){this.assertQueued(r);const changed=this.db.prepare("UPDATE codex_native_sends SET status='send_intent',binding=? WHERE id=? AND session_id=? AND generation=? AND status='queued'").run(JSON.stringify(binding),r.id,r.sessionId,r.generation);if(changed.changes!==1)throw new Error('native_send_unknown');}
 }
 accept(records:NativeSendRecord[],binding:NativeSendBinding,receipts:NativeSendReceipt[],completedEvent:number|null):void{
  for(let i=0;i<records.length;i++){
   const r=records[i],receipt=receipts[i],current=this.get(r.id);
   if(!current||current.status!=='send_intent'||JSON.stringify(current.binding)!==JSON.stringify(binding))throw new Error('native_send_unknown');
   this.db.prepare('INSERT INTO codex_native_send_receipts VALUES (?,?,?,?,?,?,?)').run(receipt.messageId,receipt.nativeSessionId,receipt.connectionGeneration,receipt.nativeThreadId,receipt.turnId,receipt.afterEvent,completedEvent);
   const changed=this.db.prepare("UPDATE codex_native_sends SET status='accepted' WHERE id=? AND status='send_intent'").run(r.id);if(changed.changes!==1)throw new Error('native_send_unknown');
  }
 }
 markUnknown(sessionId:string):void{this.db.prepare("UPDATE codex_native_sends SET status='unknown' WHERE session_id=? AND status='send_intent'").run(sessionId);}
 cancelQueued(sessionId:string,wireSendId?:string):void{
  if(wireSendId!==undefined){this.db.prepare("UPDATE codex_native_sends SET status='transport_cancelled' WHERE session_id=? AND id=? AND status='queued'").run(sessionId,wireSendId);return;}
  this.db.prepare('INSERT INTO codex_native_send_barriers VALUES (?,1) ON CONFLICT(session_id) DO UPDATE SET generation=generation+1').run(sessionId);
  this.db.prepare("UPDATE codex_native_sends SET status='transport_cancelled' WHERE session_id=? AND status='queued'").run(sessionId);
 }
 recover(sessionId:string):void{this.atomic(()=>{this.markUnknown(sessionId);this.cancelQueued(sessionId);});}
}
