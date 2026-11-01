import type {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';
import type {AssistantQualityDataset} from '../../src/runtime/assistant/quality-qualification.js';
import {qualityContextSchema,qualityRecordSchema,frozenQualityDigest,readQualityRecord,readQualityContext,readQualityGeneration,type QualityRecord,type QualityContext,type QualityModelReader} from '../../src/runtime/assistant/quality-authorization.js';
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
export function atomic<T>(db: DatabaseSync, fn: () => T): T {
    db.exec('SAVEPOINT assistant_quality_write');
    try {
        const result = fn();
        db.exec('RELEASE assistant_quality_write');
        return result;
    }
    catch (error) {
        db.exec('ROLLBACK TO assistant_quality_write');
        db.exec('RELEASE assistant_quality_write');
        throw error;
    }
}
/** LoopStore migration helper: uses the caller's existing connection only. */
export function migrateAssistantQuality(db: DatabaseSync): void {
    db.exec(`CREATE TABLE IF NOT EXISTS assistant_quality_context(singleton INTEGER PRIMARY KEY CHECK(singleton=1),payload_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS assistant_quality_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),generation INTEGER NOT NULL,reimport_id TEXT);
 INSERT OR IGNORE INTO assistant_quality_state VALUES(1,0,NULL);
 CREATE TABLE IF NOT EXISTS assistant_quality_assessments(assessment_id TEXT PRIMARY KEY,payload_json TEXT NOT NULL);`);
}
/** Main-only lifecycle helper. Never expose this input through renderer/agent IPC. */
export function syncAssistantQualityContext(db: DatabaseSync, raw: QualityContext | null): void {
    atomic(db, () => {
        if (raw === null) {
            db.prepare('DELETE FROM assistant_quality_context').run();
            db.prepare('UPDATE assistant_quality_state SET generation=generation+1,reimport_id=NULL WHERE singleton=1').run();
            return;
        }
        const context = qualityContextSchema.parse(raw), prior = db.prepare('SELECT payload_json FROM assistant_quality_context WHERE singleton=1').get(), payload = JSON.stringify(context);
        if (prior && prior.payload_json !== payload)
            db.prepare('UPDATE assistant_quality_state SET generation=generation+1,reimport_id=NULL WHERE singleton=1').run();
        db.prepare('INSERT INTO assistant_quality_context VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET payload_json=excluded.payload_json').run(payload);
    });
}
export function writeAssistantQualityRecord(db: DatabaseSync, raw: QualityRecord): void {
    const record = qualityRecordSchema.parse(raw);
    if (frozenQualityDigest(record) !== record.digest)
        throw Error('assistant_quality_digest');
    db.prepare('INSERT INTO assistant_quality_assessments VALUES(?,?) ON CONFLICT(assessment_id) DO UPDATE SET payload_json=excluded.payload_json').run(record.assessmentId, JSON.stringify(record));
}
export function revokeAssistantQuality(db: DatabaseSync, readModel?: QualityModelReader): void {
    atomic(db, () => {
        let reimportId: string | null = null;
        try {
            const latest = readQualityRecord(db), context = readQualityContext(db), model = readModel?.();
            if (latest && latest.generation === readQualityGeneration(db) && JSON.stringify(latest.context) === JSON.stringify(context) && model?.modelEpoch === context.modelEpoch && model?.configFingerprint === context.configFingerprint)
                reimportId = latest.assessmentId;
        }
        catch { /* Revocation must succeed even if context is stale. */ }
        db.prepare('UPDATE assistant_quality_state SET generation=generation+1,reimport_id=? WHERE singleton=1').run(reimportId);
    });
}
export const predictions = z.array(z.object({ id: z.string().min(1).max(256), prediction: z.enum(['needs_action', 'wait', 'unknown']) }).strict()).max(10000);
