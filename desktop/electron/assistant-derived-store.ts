import type {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';
import {readOriginalLoopMigrationLease,type LoopDatabaseLease} from './loop-database-owner.js';
import {ASSISTANT_DERIVED_LINEAGE_SCHEMA,type AssistantDerivedLineage} from './assistant-derived-lineage.js';
import {assistantDerivedHash,captureAssistantDerivedValue} from './assistant-derived-data.js';
import {canonicalVerificationJson} from '../../src/runtime/verification/protocol.js';
import {parseCapturedSourceJson} from '../../src/runtime/verification/captured-source-json.js';
const integer=z.number().nonnegative().refine(Number.isSafeInteger),id=z.string().min(1).max(512);
const keySchema=z.object({ownerId:id,profileId:z.literal('default-personal-assistant')}).strict();
const settingsSchema=keySchema.extend({enabled:z.boolean(),expectedRevision:integer.refine(n=>n<Number.MAX_SAFE_INTEGER),requestSource:z.literal('user')}).strict();
export function migrateAssistantDerived(db:DatabaseSync,original:LoopDatabaseLease){
 readOriginalLoopMigrationLease(original,db).execWrite(`CREATE TABLE IF NOT EXISTS assistant_calendar_memory_settings(owner_id TEXT NOT NULL,profile_id TEXT NOT NULL,enabled INTEGER NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(owner_id,profile_id));
 CREATE TABLE IF NOT EXISTS assistant_derived_run_markers(run_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS assistant_derived_lineage(run_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,lineage_json TEXT NOT NULL);`);
}
export function readAssistantCalendarMemorySettings(db:DatabaseSync,raw:{ownerId:string;profileId:string}){
 const key=keySchema.parse(captureAssistantDerivedValue(raw)),row=db.prepare('SELECT enabled,revision FROM assistant_calendar_memory_settings WHERE owner_id=? AND profile_id=?').get(key.ownerId,key.profileId);
 if(!row)return {...key,enabled:false,revision:0};
 const value=z.object({enabled:z.union([z.literal(0),z.literal(1)]),revision:integer}).strict().parse(row);return {...key,enabled:value.enabled===1,revision:value.revision};
}
export function setAssistantCalendarMemorySettings(db:DatabaseSync,original:LoopDatabaseLease,raw:{ownerId:string;profileId:string;enabled:boolean;expectedRevision:number;requestSource:'user'|'agent'|'scheduler'}){
 const input=captureAssistantDerivedValue(raw);if(input.requestSource!=='user')throw Error('assistant_calendar_memory_user_only');const value=settingsSchema.parse(input),key={ownerId:value.ownerId,profileId:value.profileId},current=readAssistantCalendarMemorySettings(db,key);
 if(current.revision!==value.expectedRevision)throw Error('assistant_calendar_memory_conflict');
 readOriginalLoopMigrationLease(original,db).runWrite('INSERT INTO assistant_calendar_memory_settings(owner_id,profile_id,enabled,revision) VALUES(?,?,?,?) ON CONFLICT(owner_id,profile_id) DO UPDATE SET enabled=excluded.enabled,revision=excluded.revision',value.ownerId,value.profileId,value.enabled?1:0,current.revision+1);return {...key,enabled:value.enabled,revision:current.revision+1};
}
export function readAssistantDerivedLineage(db:DatabaseSync,runId:string):AssistantDerivedLineage|undefined{
 id.parse(runId);const row=db.prepare('SELECT profile_id,lineage_json FROM assistant_derived_lineage WHERE run_id=?').get(runId);if(!row)return undefined;
 if(typeof row.lineage_json!=='string')throw Error('assistant_derived_lineage_invalid');const lineage=ASSISTANT_DERIVED_LINEAGE_SCHEMA.parse(parseCapturedSourceJson(row.lineage_json));if(lineage.profileId!==row.profile_id)throw Error('assistant_derived_lineage_invalid');return lineage;
}
export function isAssistantDerivedRunTracked(db:DatabaseSync,runId:string):boolean{return !!db.prepare('SELECT 1 FROM assistant_derived_run_markers WHERE run_id=?').get(id.parse(runId));}
/** The enclosing original LoopStore owns this transaction. Marker is retained
 * independently so lost/corrupt lineage can never become unrestricted legacy. */
export function recordAssistantDerivedLineage(db:DatabaseSync,original:LoopDatabaseLease,runId:string,raw:AssistantDerivedLineage,current:()=>boolean):void{
 id.parse(runId);const lineage=ASSISTANT_DERIVED_LINEAGE_SCHEMA.parse(captureAssistantDerivedValue(raw)),lease=readOriginalLoopMigrationLease(original,db);
 const run=db.prepare('SELECT loop_id,status FROM loop_runs WHERE id=?').get(runId);if(!run||run.status!=='running'||!['personal-assistant-morning-briefing','personal-assistant-evening-reflection'].includes(String(run.loop_id))||lineage.profileId!=='default-personal-assistant'||!current())throw Error('assistant_derived_stale');
 const prior=readAssistantDerivedLineage(db,runId);if(prior&&assistantDerivedHash(prior)!==assistantDerivedHash(lineage)||!prior&&isAssistantDerivedRunTracked(db,runId))throw Error('assistant_derived_conflict');
 lease.runWrite('INSERT INTO assistant_derived_run_markers(run_id,profile_id) VALUES(?,?) ON CONFLICT(run_id) DO NOTHING',runId,lineage.profileId);
 if(!prior)lease.runWrite('INSERT INTO assistant_derived_lineage(run_id,profile_id,lineage_json) VALUES(?,?,?)',runId,lineage.profileId,canonicalVerificationJson(lineage));
 if(!current())throw Error('assistant_derived_stale');
}
