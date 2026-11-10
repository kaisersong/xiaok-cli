import {assistantOwnedRun,assistantOwnedExec} from './assistant-owned-sqlite.js';
import {assistantOwnedGet,assistantOwnedAll} from './assistant-owned-sqlite.js';
import {assistantOwnedSqlite} from './assistant-owned-sqlite.js';
import {readOriginalLoopMigrationLease,type LoopDatabaseLease} from './loop-database-owner.js';
import type { DatabaseSync } from 'node:sqlite';
import { ASSISTANT_SOURCE_RUN_SCHEMA, type AssistantSourceRun } from '../shared/assistant-coverage-contract.js';

/** Uses only LoopStore's existing connection and transaction boundary. No owner,
 * connection, scheduler, credential or publication body is introduced here. */
export function migrateAssistantSourceRuns(db: DatabaseSync, original: LoopDatabaseLease): void {
 assistantOwnedExec(db,original,`CREATE TABLE IF NOT EXISTS assistant_source_runs (
 run_id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, collected_at INTEGER NOT NULL,
 analysis_status TEXT NOT NULL CHECK(analysis_status IN ('pending','complete','failed')),
 payload_json TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS assistant_source_runs_latest ON assistant_source_runs(profile_id,collected_at DESC);`);
}
export function recordAssistantSourceRun(db: DatabaseSync, original: LoopDatabaseLease, raw: Omit<AssistantSourceRun,'analysisStatus'>): void {
 const input=ASSISTANT_SOURCE_RUN_SCHEMA.parse({...raw,analysisStatus:'pending'});
 if(new Set(input.coverage.map(row=>row.sourceId)).size!==5)throw Error('assistant_coverage_sources');
 const payload=JSON.stringify(input);
 const prior=assistantOwnedGet(db,original,'SELECT payload_json FROM assistant_source_runs WHERE run_id=?',input.runId);
 if(prior){if(prior.payload_json!==payload)throw Error('assistant_source_run_conflict');return;}
 assistantOwnedRun(db,original,'INSERT INTO assistant_source_runs(run_id,profile_id,collected_at,analysis_status,payload_json) VALUES(?,?,?,?,?)',input.runId,input.profileId,input.now,'pending',payload);
 // Preserve pending/unknown records. Completed diagnostic metadata has 30-day retention.
 assistantOwnedRun(db,original,"DELETE FROM assistant_source_runs WHERE collected_at<? AND analysis_status!='pending'",input.now-30*86400_000);
}
export function finishAssistantSourceAnalysis(db: DatabaseSync, original: LoopDatabaseLease, runId: string, status:'complete'|'failed'):void {
 if(status!=='complete'&&status!=='failed')throw Error('assistant_analysis_status');
 const row=assistantOwnedGet(db,original,'SELECT analysis_status FROM assistant_source_runs WHERE run_id=?',runId);
 if(!row)return; // Legacy collectors did not produce coverage.
 if(row.analysis_status===status)return;
 if(row.analysis_status!=='pending')throw Error('assistant_analysis_terminal');
 assistantOwnedRun(db,original,"UPDATE assistant_source_runs SET analysis_status=? WHERE run_id=? AND analysis_status='pending'",status,runId);
}
export function latestAssistantSourceRun(db:DatabaseSync, original: LoopDatabaseLease,profileId:string):AssistantSourceRun|undefined {
 const row=assistantOwnedGet(db,original,'SELECT payload_json,analysis_status FROM assistant_source_runs WHERE profile_id=? ORDER BY collected_at DESC,rowid DESC LIMIT 1',profileId);
 if(!row)return undefined;
 return ASSISTANT_SOURCE_RUN_SCHEMA.parse({...JSON.parse(String(row.payload_json)),analysisStatus:row.analysis_status});
}
