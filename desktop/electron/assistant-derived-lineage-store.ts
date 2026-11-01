import {ASSISTANT_MORNING_LOOP_ID,ASSISTANT_EVENING_LOOP_ID} from './assistant-types.js';
import type {DatabaseSync} from 'node:sqlite';
import type {AssistantSourceRun} from '../shared/assistant-coverage-contract.js';
import {recordAssistantSourceRun} from './assistant-source-store.js';
import {ASSISTANT_DERIVED_LINEAGE_SCHEMA,type AssistantDerivedLineage} from './assistant-derived-lineage.js';
export function migrateAssistantDerivedLineage(db:DatabaseSync):void{
 db.exec('CREATE TABLE IF NOT EXISTS assistant_derived_run_markers(run_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS assistant_derived_lineage(run_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,lineage_json TEXT NOT NULL);');
}
/** Main's LoopStore wrapper MUST own the transaction and use this instead of a
 * separate recordAssistantSourceRun call. No second DB or hidden writer. */
export function recordAssistantDerivedSourceRun(db:DatabaseSync,input:{sourceRun:Omit<AssistantSourceRun,'analysisStatus'>;lineage:AssistantDerivedLineage},isCurrent:()=>boolean):void{
 if(!db.isTransaction)throw Error('assistant_derived_transaction_required');
 if(!isCurrent())throw Error('assistant_derived_stale');
 const lineage=ASSISTANT_DERIVED_LINEAGE_SCHEMA.parse(input.lineage);
 if(lineage.profileId!==input.sourceRun.profileId)throw Error('assistant_derived_profile');
 const payload=JSON.stringify(lineage),prior=db.prepare('SELECT lineage_json FROM assistant_derived_lineage WHERE run_id=?').get(input.sourceRun.runId);
 if(prior&&prior.lineage_json!==payload)throw Error('assistant_derived_conflict');
 const owner=db.prepare('SELECT loop_id,status FROM loop_runs WHERE id=?').get(input.sourceRun.runId);
 if(!owner||owner.loop_id!==(input.sourceRun.kind==='morning'?ASSISTANT_MORNING_LOOP_ID:ASSISTANT_EVENING_LOOP_ID)||!prior&&owner.status!=='running')throw Error('assistant_derived_owner_required');
 if(!prior&&isAssistantDerivedRunTracked(db,input.sourceRun.runId))throw Error('assistant_derived_lineage_missing');
 recordAssistantSourceRun(db,input.sourceRun);
 db.prepare('INSERT INTO assistant_derived_run_markers(run_id,profile_id) VALUES(?,?) ON CONFLICT(run_id) DO NOTHING').run(input.sourceRun.runId,lineage.profileId);
 if(!prior)db.prepare('INSERT INTO assistant_derived_lineage(run_id,profile_id,lineage_json) VALUES(?,?,?)').run(input.sourceRun.runId,lineage.profileId,payload);
 if(!isCurrent())throw Error('assistant_derived_stale');
}
export function readAssistantDerivedLineage(db:DatabaseSync,runId:string):AssistantDerivedLineage|undefined{
 const row=db.prepare('SELECT lineage_json FROM assistant_derived_lineage WHERE run_id=?').get(runId);
 return row?ASSISTANT_DERIVED_LINEAGE_SCHEMA.parse(JSON.parse(String(row.lineage_json))):undefined;
}

/** Owner marker is retained with the run; deleting lineage alone must not turn
 * sensitive assistant output into an untracked legacy/business run. */
export function isAssistantDerivedRunTracked(db:DatabaseSync,runId:string):boolean{return !!db.prepare('SELECT 1 FROM assistant_derived_run_markers WHERE run_id=?').get(runId);}
