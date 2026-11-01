import type {DatabaseSync} from 'node:sqlite';
import {ASSISTANT_CALENDAR_SNAPSHOT_SCHEMA,type AssistantCalendarSnapshot} from '../shared/assistant-calendar-contract.js';
export interface AssistantCalendarConnection {epoch:number;enabled:boolean;binary:string;accountId:string}
export function migrateAssistantCalendar(db:DatabaseSync){
 db.exec(`CREATE TABLE IF NOT EXISTS assistant_calendar_memory_settings(owner_id TEXT NOT NULL,profile_id TEXT NOT NULL,enabled INTEGER NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(owner_id,profile_id));
 CREATE TABLE IF NOT EXISTS assistant_calendar_connection(id INTEGER PRIMARY KEY CHECK(id=1),epoch INTEGER NOT NULL,enabled INTEGER NOT NULL,binary_path TEXT NOT NULL,account_hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS assistant_calendar_generations(id INTEGER PRIMARY KEY AUTOINCREMENT,epoch INTEGER NOT NULL,collected_at INTEGER NOT NULL,snapshot_json TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS assistant_calendar_latest ON assistant_calendar_generations(epoch,id DESC);`);
}
export function readAssistantCalendarConnection(db:DatabaseSync):AssistantCalendarConnection{
 const row=db.prepare('SELECT * FROM assistant_calendar_connection WHERE id=1').get();
 return row?{epoch:Number(row.epoch),enabled:row.enabled===1,binary:String(row.binary_path),accountId:String(row.account_hash)}:{epoch:0,enabled:false,binary:'',accountId:''};
}
export function setAssistantCalendarConnection(db:DatabaseSync,input:{binary:string;accountId:string;enabled:boolean;expectedEpoch:number}){
 const current=readAssistantCalendarConnection(db);if(current.epoch!==input.expectedEpoch)throw Error('assistant_calendar_settings_conflict');
 const next={epoch:current.epoch+1,enabled:input.enabled,binary:input.enabled?input.binary:'',accountId:input.enabled?input.accountId:''};
 db.prepare('INSERT INTO assistant_calendar_connection(id,epoch,enabled,binary_path,account_hash) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch,enabled=excluded.enabled,binary_path=excluded.binary_path,account_hash=excluded.account_hash').run(next.epoch,next.enabled?1:0,next.binary,next.accountId);
 // Revocation removes derived event bodies, not remote events or CLI credentials.
 db.prepare('DELETE FROM assistant_calendar_generations WHERE epoch!=?').run(next.epoch);return next;
}
export function writeAssistantCalendarGeneration(db:DatabaseSync,snapshot:AssistantCalendarSnapshot,guard:()=>boolean){
 const value=ASSISTANT_CALENDAR_SNAPSHOT_SCHEMA.parse(snapshot);
 if(!guard())throw Error('assistant_calendar_grant_changed');
 db.prepare('INSERT INTO assistant_calendar_generations(epoch,collected_at,snapshot_json) VALUES(?,?,?)').run(value.epoch,value.collectedAt??0,JSON.stringify(value));
 db.prepare('DELETE FROM assistant_calendar_generations WHERE id NOT IN (SELECT id FROM assistant_calendar_generations ORDER BY id DESC LIMIT 30)').run();
 if(!guard())throw Error('assistant_calendar_grant_changed');
}
export function readAssistantCalendarGeneration(db:DatabaseSync,epoch:number):AssistantCalendarSnapshot|undefined{
 const row=db.prepare('SELECT snapshot_json FROM assistant_calendar_generations WHERE epoch=? ORDER BY id DESC LIMIT 1').get(epoch);
 return row?ASSISTANT_CALENDAR_SNAPSHOT_SCHEMA.parse(JSON.parse(String(row.snapshot_json))):undefined;
}

export interface AssistantCalendarMemorySettings {ownerId:string;profileId:string;enabled:boolean;revision:number}
function memorySettingsKey(input:{ownerId:string;profileId:string}){
 for(const key of [input.ownerId,input.profileId])if(typeof key!=='string'||!key.trim()||key.length>256)throw Error('assistant_calendar_memory_owner_invalid');
 return [input.ownerId,input.profileId] as const;
}
export function readAssistantCalendarMemorySettings(db:DatabaseSync,input:{ownerId:string;profileId:string}):AssistantCalendarMemorySettings{
 const key=memorySettingsKey(input);
 const row=db.prepare('SELECT enabled,revision FROM assistant_calendar_memory_settings WHERE owner_id=? AND profile_id=?').get(...key);
 return {ownerId:key[0],profileId:key[1],enabled:row?.enabled===1,revision:row?Number(row.revision):0};
}
/** Wrap with the existing LoopStore transaction owner when exposed by main.
 * A separate setting: enabling calendar collection must never opt memory in. */
export function setAssistantCalendarMemorySettings(db:DatabaseSync,input:{ownerId:string;profileId:string;enabled:boolean;expectedRevision:number;requestSource:'user'|'agent'|'scheduler'}):AssistantCalendarMemorySettings{
 if(input?.requestSource!=='user')throw Error('assistant_calendar_memory_user_only');
 const key=memorySettingsKey(input);
 if(typeof input.enabled!=='boolean'||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||input.expectedRevision>=Number.MAX_SAFE_INTEGER)throw Error('assistant_calendar_memory_settings_invalid');
 const row=db.prepare(`INSERT INTO assistant_calendar_memory_settings(owner_id,profile_id,enabled,revision)
 SELECT ?,?,?,1 WHERE ?=0
 ON CONFLICT(owner_id,profile_id) DO UPDATE SET enabled=excluded.enabled,revision=assistant_calendar_memory_settings.revision+1 WHERE assistant_calendar_memory_settings.revision=?`).run(...key,input.enabled?1:0,input.expectedRevision,input.expectedRevision);
 // Existing rows with revision >0 require an UPDATE, as SELECT above is empty.
 if(row.changes===0){
  const changed=db.prepare('UPDATE assistant_calendar_memory_settings SET enabled=?,revision=revision+1 WHERE owner_id=? AND profile_id=? AND revision=?').run(input.enabled?1:0,...key,input.expectedRevision);
  if(changed.changes!==1)throw Error('assistant_calendar_memory_settings_conflict');
 }
 return readAssistantCalendarMemorySettings(db,input);
}
