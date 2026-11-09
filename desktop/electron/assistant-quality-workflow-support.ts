import {assistantOwnedRun,assistantOwnedExec} from './assistant-owned-sqlite.js';
import {assistantOwnedGet,assistantOwnedAll} from './assistant-owned-sqlite.js';
import {assistantOwnedSavepoint,assistantOwnedSqlite} from './assistant-owned-sqlite.js';
import {readOriginalLoopMigrationLease,type LoopDatabaseLease} from './loop-database-owner.js';
import type {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';
import type {AssistantQualityDataset} from '../../src/runtime/assistant/quality-qualification.js';
import {qualityContextSchema,qualityRecordSchema,frozenQualityDigest,type QualityRecord,type QualityContext,type QualityModelReader} from '../../src/runtime/assistant/quality-authorization.js';
import {readQualityRecord,readQualityContext,readQualityGeneration} from './assistant-quality-authorization.js';
export const ASSISTANT_QUALITY_MAX_BYTES = 4000000;
export type Source = {
    requestSource: 'user' | 'agent' | 'scheduler';
};
export type AssistantQualityStatus = {
    state: 'not_evaluated' | 'review_required' | 'passed' | 'failed' | 'stale' | 'unavailable';
    populationCount: number;
    sampleCount: number;
    needsAction: number;
    seriousMisses: number;
    precision: number | null;
    recall: number | null;
    unknownRate: number | null;
    reason: 'source_unavailable' | 'insufficient_cases' | 'provider_unavailable' | 'labels_required' | 'binding_changed' | 'quality_failed' | null;
};
export type AssistantQualityPopulation = Pick<AssistantQualityDataset, 'binding' | 'population' | 'protocol'> & {
    facts: QualityRecord['facts'];
};
export interface AssistantQualityPorts {
    readCurrentModel: QualityModelReader;
    /** Main-private complete source receipt, with credential-redacted minimal facts only. */
    population(): Promise<AssistantQualityPopulation>;
    /** Main-private readonly evaluation batch; must meter shared 6/48k/6k ledger. */
    predict?(frozen: Readonly<AssistantQualityDataset> & {
        readonly facts: readonly QualityRecord['facts'][number][];
    }, expectedDigest: string): Promise<unknown>;
    /** Native save picker must confirm export consent. No renderer path/body input. */
    save(contents: string, assertCurrent: () => void): Promise<boolean>;
    /** Native open picker must bound bytes BEFORE reading (also checked here). null = cancelled. */
    open(maxBytes: number): Promise<string | null>;
    /** Native main confirmation, not an imported or renderer-supplied flag. */
    confirmHumanReview(kind: 'risk_review' | 'action_review'): Promise<false | {
        userId: string;
        text: string;
    }>;
}
export function authorizeSource(input: Source, sources: readonly Source['requestSource'][], allowed: string[] = []) {
    if (!input || Object.keys(input).some(key => !['requestSource', ...allowed].includes(key)))
        throw Error('assistant_quality_request');
    if (!sources.includes(input?.requestSource))
        throw Error('assistant_quality_source');
}
export function user(input: Source, allowed: string[] = []) { authorizeSource(input, ['user'], allowed); }
export function atomic<T>(db:DatabaseSync,original:LoopDatabaseLease,fn:()=>T):T{return assistantOwnedSavepoint(db,original,fn);}
/** LoopStore migration helper: uses the caller's existing connection only. */
export function migrateAssistantQuality(db: DatabaseSync, original: LoopDatabaseLease): void {
    assistantOwnedExec(db,original,`CREATE TABLE IF NOT EXISTS assistant_quality_context(singleton INTEGER PRIMARY KEY CHECK(singleton=1),payload_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS assistant_quality_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),generation INTEGER NOT NULL,reimport_id TEXT);
 INSERT OR IGNORE INTO assistant_quality_state VALUES(1,0,NULL);
 CREATE TABLE IF NOT EXISTS assistant_quality_assessments(assessment_id TEXT PRIMARY KEY,payload_json TEXT NOT NULL);`);
}
/** Main-only lifecycle helper. Never expose this input through renderer/agent IPC. */
export function syncAssistantQualityContext(db: DatabaseSync, original: LoopDatabaseLease, raw: QualityContext | null): void {
    atomic(db, original, () => {
        if (raw === null) {
            assistantOwnedRun(db,original,'DELETE FROM assistant_quality_context');
            assistantOwnedRun(db,original,'UPDATE assistant_quality_state SET generation=generation+1,reimport_id=NULL WHERE singleton=1');
            return;
        }
        const context = qualityContextSchema.parse(raw), prior = assistantOwnedGet(db,original,'SELECT payload_json FROM assistant_quality_context WHERE singleton=1'), payload = JSON.stringify(context);
        if (prior && prior.payload_json !== payload)
            assistantOwnedRun(db,original,'UPDATE assistant_quality_state SET generation=generation+1,reimport_id=NULL WHERE singleton=1');
        assistantOwnedRun(db,original,'INSERT INTO assistant_quality_context VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET payload_json=excluded.payload_json',payload);
    });
}
export function writeAssistantQualityRecord(db: DatabaseSync, original: LoopDatabaseLease, raw: QualityRecord): void {
    const record = qualityRecordSchema.parse(raw);
    if (frozenQualityDigest(record) !== record.digest)
        throw Error('assistant_quality_digest');
    assistantOwnedRun(db,original,'INSERT INTO assistant_quality_assessments VALUES(?,?) ON CONFLICT(assessment_id) DO UPDATE SET payload_json=excluded.payload_json',record.assessmentId,JSON.stringify(record));
}
export function revokeAssistantQuality(db: DatabaseSync, original: LoopDatabaseLease, readModel?: QualityModelReader): void {
    atomic(db, original, () => {
        let reimportId: string | null = null;
        try {
            const latest = readQualityRecord(db, original), context = readQualityContext(db, original), model = readModel?.();
            if (latest && latest.generation === readQualityGeneration(db, original) && JSON.stringify(latest.context) === JSON.stringify(context) && model?.modelEpoch === context.modelEpoch && model?.configFingerprint === context.configFingerprint)
                reimportId = latest.assessmentId;
        }
        catch { /* Revocation must succeed even if context is stale. */ }
        assistantOwnedRun(db,original,'UPDATE assistant_quality_state SET generation=generation+1,reimport_id=? WHERE singleton=1',reimportId);
    });
}
export const predictions = z.array(z.object({ id: z.string().min(1).max(256), prediction: z.enum(['needs_action', 'wait', 'unknown']) }).strict()).max(10000);
