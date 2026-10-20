import type {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
export type NativePublicCoverage='complete'|'bounded_legacy'|'unknown_gap';
export interface NativeWireSegment{kind:'transport'|'context'|'work'|'attachments';startByte:number;endByte:number;hash:string}
export interface NativeWireMetadata{schemaVersion:1;turnPurpose:'work'|'work_with_context';wireHash:string;segments:NativeWireSegment[]}
export interface NativeWorkEnvelope{readonly wireText:string}
interface ComposedEnvelope{wireText:string;publicText:string;metadata:NativeWireMetadata;payloadHash:string}
const composed=new WeakMap<NativeWorkEnvelope,ComposedEnvelope>();
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
// Unicode mode treats valid surrogate pairs as one scalar outside this range.
const wellFormed=(value:string)=>!/[\uD800-\uDFFF]/u.test(value);
export function composeNativeWork(input:{prompt:string;contextText?:string;attachmentsText?:string}):NativeWorkEnvelope{
 if(!input||typeof input.prompt!=='string'||!input.prompt.trim())throw new Error('native_invalid_message');
 for(const text of [input.prompt,input.contextText,input.attachmentsText])if(text!==undefined&&(typeof text!=='string'||!wellFormed(text)))throw new Error('native_invalid_message');
 const parts:Buffer[]=[],segments:NativeWireSegment[]=[];let position=0;
 const append=(kind:NativeWireSegment['kind'],text:string)=>{const bytes=Buffer.from(text);segments.push({kind,startByte:position,endByte:position+bytes.length,hash:hash(bytes)});parts.push(bytes);position+=bytes.length;};
 if(input.contextText){append('transport','Previous conversation context:\n');append('context',input.contextText);append('transport','\n\n');}
 append('work',input.prompt);
 if(input.attachmentsText){append('transport','\n\nAttached working copies:\n');append('attachments',input.attachmentsText);}
 const bytes=Buffer.concat(parts),wireText=bytes.toString('utf8'),metadata:NativeWireMetadata={schemaVersion:1,turnPurpose:input.contextText?'work_with_context':'work',wireHash:hash(bytes),segments};
 const envelope=Object.freeze({wireText});for(const segment of segments)Object.freeze(segment);Object.freeze(segments);Object.freeze(metadata);
 composed.set(envelope,Object.freeze({wireText,publicText:input.prompt,metadata,payloadHash:hash(JSON.stringify([1,wireText,input.prompt,metadata]))}));return envelope;
}
/** Only an actual fixed composition can supply synthetic segment metadata. */
export function inspectNativeWork(envelope:NativeWorkEnvelope):ComposedEnvelope{const value=composed.get(envelope);if(!value||envelope.wireText!==value.wireText)throw new Error('native_invalid_message');return value;}

/** Full public owner export. Display trimming never feeds this store; no physical proof is minted. */
export class NativePublicSource {
 constructor(private readonly db:DatabaseSync,private readonly profileId:string){
  db.exec(`CREATE TABLE IF NOT EXISTS codex_native_public_sources(session_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,source_epoch TEXT NOT NULL UNIQUE,native_thread_id TEXT,coverage TEXT NOT NULL,committed_sequence INTEGER NOT NULL,gap_after_sequence INTEGER);
   CREATE TABLE IF NOT EXISTS codex_native_public_messages(session_id TEXT NOT NULL,message_id TEXT NOT NULL,first_sequence INTEGER NOT NULL,revision INTEGER NOT NULL,role TEXT NOT NULL,text TEXT NOT NULL,delivery_state TEXT,turn_id TEXT,PRIMARY KEY(session_id,message_id));
   CREATE TABLE IF NOT EXISTS codex_native_public_events(session_id TEXT NOT NULL,sequence INTEGER NOT NULL,kind TEXT NOT NULL,message_id TEXT,payload_hash TEXT NOT NULL,PRIMARY KEY(session_id,sequence));`);
 }
 reserveFresh(sessionId:string):void{this.db.prepare("INSERT INTO codex_native_public_sources VALUES (?,?,?,NULL,'preparing',0,NULL)").run(sessionId,this.profileId,randomUUID());}
 ensureLegacy(sessionId:string,nativeThreadId:string|null):void{this.db.prepare("INSERT OR IGNORE INTO codex_native_public_sources VALUES (?,?,?,?,'bounded_legacy',0,0)").run(sessionId,this.profileId,randomUUID(),nativeThreadId);}
 bind(sessionId:string,nativeThreadId:string,fresh:boolean):void{
  this.ensureLegacy(sessionId,nativeThreadId);const source=this.source(sessionId);
  if(source.native_thread_id!==null&&source.native_thread_id!==nativeThreadId)throw new Error('native_public_source_conflict');
  const coverage=fresh&&source.coverage==='preparing'?'complete':source.coverage==='preparing'?'unknown_gap':source.coverage;
  if(source.native_thread_id!==nativeThreadId||source.coverage!==coverage){this.db.prepare('UPDATE codex_native_public_sources SET native_thread_id=?,coverage=? WHERE session_id=?').run(nativeThreadId,coverage,sessionId);this.advance(sessionId,'source_bound',null,[nativeThreadId,coverage]);}
 }
 private source(sessionId:string){const row=this.db.prepare('SELECT * FROM codex_native_public_sources WHERE session_id=? AND profile_id=?').get(sessionId,this.profileId);if(!row)throw new Error('native_public_source_unavailable');return row;}
 markGap(sessionId:string):void{
  const old=this.source(sessionId);if(old.gap_after_sequence!==null&&old.coverage!=='preparing'&&old.coverage!=='complete')return;
  this.db.prepare("UPDATE codex_native_public_sources SET coverage=CASE WHEN coverage='bounded_legacy' THEN coverage ELSE 'unknown_gap' END,gap_after_sequence=COALESCE(gap_after_sequence,committed_sequence) WHERE session_id=? AND profile_id=?").run(sessionId,this.profileId);
  this.advance(sessionId,'source_gap',null,[Number(old.committed_sequence)]);
 }
 private advance(sessionId:string,kind:string,messageId:string|null,payload:unknown):number{
  const old=this.source(sessionId),sequence=Number(old.committed_sequence)+1;
  this.db.prepare('INSERT INTO codex_native_public_events VALUES (?,?,?,?,?)').run(sessionId,sequence,kind,messageId,hash(JSON.stringify(payload)));
  if(this.db.prepare('UPDATE codex_native_public_sources SET committed_sequence=? WHERE session_id=? AND committed_sequence=?').run(sequence,sessionId,old.committed_sequence as number).changes!==1)throw new Error('native_public_source_conflict');return sequence;
 }
 user(sessionId:string,messageId:string,text:string):void{
  const sequence=this.advance(sessionId,'user',messageId,[text,'queued']);
  this.db.prepare("INSERT INTO codex_native_public_messages VALUES (?,?,?,1,'user',?,'queued',NULL)").run(sessionId,messageId,sequence,text);
 }
 assistant(sessionId:string,messageId:string,text:string,turnId:string|null,delta:boolean):void{
  if(typeof text!=='string'||!wellFormed(text)||typeof messageId!=='string'||!messageId)throw new Error('native_invalid_public_event');
  const old=this.db.prepare('SELECT role,text,revision,turn_id FROM codex_native_public_messages WHERE session_id=? AND message_id=?').get(sessionId,messageId);
  if(old&&(old.role!=='assistant'||old.turn_id!==turnId))throw new Error('native_public_source_conflict');
  const full=delta?String(old?.text??'')+text:text;
  const sequence=this.advance(sessionId,delta?'assistant_delta':'assistant_complete',messageId,[turnId,text]);
  this.db.prepare("INSERT INTO codex_native_public_messages VALUES (?,?,?,1,'assistant',?,NULL,?) ON CONFLICT(session_id,message_id) DO UPDATE SET text=excluded.text,revision=revision+1").run(sessionId,messageId,sequence,full,turnId);
 }
 turn(sessionId:string,kind:'turn_started'|'turn_completed',turnId:string,status:string|null):void{this.advance(sessionId,kind,null,[turnId,status]);}
 syncDisposition(sessionId:string):void{
  const rows=this.db.prepare("SELECT p.message_id,p.delivery_state,p.turn_id,CASE s.status WHEN 'accepted' THEN 'sent' WHEN 'transport_cancelled' THEN 'cancelled' WHEN 'send_intent' THEN 'unknown' ELSE s.status END AS next_state,r.turn_id AS accepted_turn FROM codex_native_public_messages p JOIN codex_native_sends s ON s.session_id=p.session_id AND s.message_id=p.message_id LEFT JOIN codex_native_send_receipts r ON r.id=s.message_id AND r.session_id=s.session_id WHERE p.session_id=? AND p.role='user' ORDER BY p.first_sequence").all(sessionId);
  for(const row of rows){const turn=row.accepted_turn??row.turn_id;if(row.delivery_state===row.next_state&&row.turn_id===turn)continue;
   this.advance(sessionId,'delivery_disposition',String(row.message_id),[row.next_state,turn]);
   this.db.prepare('UPDATE codex_native_public_messages SET delivery_state=?,turn_id=?,revision=revision+1 WHERE session_id=? AND message_id=?').run(row.next_state as string,turn as string|null,sessionId,String(row.message_id));
  }
 }
 read(sessionId:string){const s=this.source(sessionId);return {sourceEpoch:String(s.source_epoch),nativeThreadId:s.native_thread_id===null?null:String(s.native_thread_id),coverage:(s.coverage==='preparing'?'unknown_gap':s.coverage) as NativePublicCoverage,committedSequence:Number(s.committed_sequence),gapAfterSequence:s.gap_after_sequence===null?null:Number(s.gap_after_sequence),messages:this.db.prepare('SELECT message_id,first_sequence,revision,role,text,delivery_state,turn_id FROM codex_native_public_messages WHERE session_id=? ORDER BY first_sequence').all(sessionId).map(m=>({messageId:String(m.message_id),sequence:Number(m.first_sequence),revision:Number(m.revision),role:m.role as 'user'|'assistant',text:String(m.text),deliveryState:m.delivery_state as string|null,turnId:m.turn_id as string|null}))};}
}
