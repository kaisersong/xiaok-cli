import {canonicalVerificationJson} from '../../src/runtime/verification/protocol.js';
import type {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';
import {readOriginalLoopMigrationLease,type LoopDatabaseLease} from './loop-database-owner.js';
import {parseCapturedSourceJson} from '../../src/runtime/verification/captured-source-json.js';
import {ASSISTANT_CALENDAR_SNAPSHOT_SCHEMA,type AssistantCalendarSnapshot} from '../shared/assistant-calendar-observation-contract.js';
export interface AssistantCalendarConnection {epoch:number;enabled:boolean;binary:string;accountId:string}
const integer=z.number().nonnegative().refine(Number.isSafeInteger);
const connectionRow=z.object({id:z.literal(1),epoch:integer,enabled:z.union([z.literal(0),z.literal(1)]),binary_path:z.string(),account_hash:z.string()}).strict();
const settings=z.object({expectedEpoch:integer.refine(value=>value<Number.MAX_SAFE_INTEGER),enabled:z.boolean(),accountId:z.string().optional(),requestSource:z.literal('user')}).strict();
export function migrateAssistantCalendar(database:DatabaseSync,original:LoopDatabaseLease):void{
 const lease=readOriginalLoopMigrationLease(original,database);
 lease.execWrite(`CREATE TABLE IF NOT EXISTS assistant_calendar_connection(id INTEGER PRIMARY KEY CHECK(id=1),epoch INTEGER NOT NULL,enabled INTEGER NOT NULL,binary_path TEXT NOT NULL,account_hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS assistant_calendar_generations(id INTEGER PRIMARY KEY AUTOINCREMENT,epoch INTEGER NOT NULL,collected_at INTEGER NOT NULL,snapshot_json TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS assistant_calendar_latest ON assistant_calendar_generations(epoch,id DESC);`);
}
export function readAssistantCalendarConnection(db:DatabaseSync):AssistantCalendarConnection{
 const raw=db.prepare('SELECT * FROM assistant_calendar_connection WHERE id=1').get();
 if(!raw)return {epoch:0,enabled:false,binary:'',accountId:''};
 const row=connectionRow.parse(raw);return {epoch:row.epoch,enabled:row.enabled===1,binary:row.binary_path,accountId:row.account_hash};
}
export function setAssistantCalendarConnection(db:DatabaseSync,original:LoopDatabaseLease,raw:{enabled:boolean;expectedEpoch:number;accountId?:string;requestSource:'user'|'agent'|'scheduler'}):AssistantCalendarConnection{
 if(raw?.requestSource!=='user')throw Error('assistant_calendar_user_only');
 const input=settings.parse(raw),lease=readOriginalLoopMigrationLease(original,db),current=readAssistantCalendarConnection(db);
 if(current.epoch!==input.expectedEpoch)throw Error('assistant_calendar_settings_conflict');
 if(input.enabled&&!/^[a-f0-9]{64}$/.test(input.accountId??''))throw Error('assistant_calendar_connection_invalid');
 const next={epoch:current.epoch+1,enabled:input.enabled,binary:input.enabled?'bundled-yzj':'',accountId:input.enabled?input.accountId!:''};
 lease.runWrite('INSERT INTO assistant_calendar_connection(id,epoch,enabled,binary_path,account_hash) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch,enabled=excluded.enabled,binary_path=excluded.binary_path,account_hash=excluded.account_hash',next.epoch,next.enabled?1:0,next.binary,next.accountId);
 lease.runWrite('DELETE FROM assistant_calendar_generations WHERE epoch!=?',next.epoch);return next;
}
export function writeAssistantCalendarGeneration(db:DatabaseSync,original:LoopDatabaseLease,raw:AssistantCalendarSnapshot,requestSource:'user'|'agent'|'scheduler',guard:()=>boolean):void{
 if(!['user','scheduler'].includes(requestSource))throw Error('assistant_calendar_read_denied');
 const snapshot=ASSISTANT_CALENDAR_SNAPSHOT_SCHEMA.parse(raw),lease=readOriginalLoopMigrationLease(original,db),grant=readAssistantCalendarConnection(db);
 if(!grant.enabled||grant.binary!=='bundled-yzj'||grant.epoch!==snapshot.epoch||!guard())throw Error('assistant_calendar_grant_changed');
 lease.runWrite('INSERT INTO assistant_calendar_generations(epoch,collected_at,snapshot_json) VALUES(?,?,?)',snapshot.epoch,snapshot.collectedAt??0,canonicalVerificationJson(snapshot));
 lease.runWrite('DELETE FROM assistant_calendar_generations WHERE id NOT IN (SELECT id FROM assistant_calendar_generations ORDER BY id DESC LIMIT 30)');
 if(!guard())throw Error('assistant_calendar_grant_changed');
}
export function readAssistantCalendarGeneration(db:DatabaseSync,epoch:number):AssistantCalendarSnapshot|undefined{
 integer.parse(epoch);const row=db.prepare('SELECT epoch,collected_at,snapshot_json FROM assistant_calendar_generations WHERE epoch=? ORDER BY id DESC LIMIT 1').get(epoch);if(!row)return undefined;
 if(typeof row.snapshot_json!=='string')throw Error('assistant_calendar_generation_invalid');
 const value=ASSISTANT_CALENDAR_SNAPSHOT_SCHEMA.parse(parseCapturedSourceJson(row.snapshot_json));
 if(value.epoch!==row.epoch||value.epoch!==epoch||(value.collectedAt??0)!==row.collected_at)throw Error('assistant_calendar_generation_invalid');return value;
}
