import {assistantOwnedGet,assistantOwnedAll} from './assistant-owned-sqlite.js';
import {assessCurrentAssistantQuality} from '../../src/runtime/assistant/quality-assessment-observation.js';
import {z} from 'zod';
import type {DatabaseSync} from 'node:sqlite';
import type {LoopDatabaseLease} from './loop-database-owner.js';
import {assistantOwnedSavepoint,assistantOwnedSqlite} from './assistant-owned-sqlite.js';
import {parseCapturedSourceJson} from '../../src/runtime/verification/captured-source-json.js';
import {qualityContextSchema,qualityRecordSchema,frozenQualityDigest,type QualityRecord,applyHumanQualityReview,hasFrozenRiskCoverage,qualityDigest,type QualityModelReader,type QualityAssessmentIdentity} from '../../src/runtime/assistant/quality-authorization.js';
import {evaluateAssistantQuality,issueAssistantQualityQualification} from '../../src/runtime/assistant/quality-qualification.js';
export function readQualityContext(db: DatabaseSync, original: LoopDatabaseLease) {
    const row = assistantOwnedGet(db,original,'SELECT payload_json FROM assistant_quality_context WHERE singleton=1');
    if (!row)
        throw Error('assistant_quality_context_missing');
    const context = qualityContextSchema.parse(parseCapturedSourceJson(String(row.payload_json)));
    const profile = assistantOwnedGet(db,original,'SELECT status,data_scopes_json,updated_at FROM assistant_profiles WHERE id=?',context.binding.profileId);
    if (!profile || profile.status !== 'active' || !Number.isSafeInteger(profile.updated_at) || profile.updated_at !== context.binding.grantEpoch)
        throw Error('assistant_quality_profile');
    const scopes = z.array(z.string()).parse(parseCapturedSourceJson(String(profile.data_scopes_json)));
    if (new Set(scopes).size !== scopes.length || JSON.stringify([...scopes].sort()) !== JSON.stringify([...context.scopes].sort()))
        throw Error('assistant_quality_scopes_changed');
    return context;
}
export function readQualityGeneration(db: DatabaseSync, original: LoopDatabaseLease): number { const row = assistantOwnedGet(db,original,'SELECT generation FROM assistant_quality_state WHERE singleton=1'); return z.number().int().nonnegative().parse(row?.generation); }
export function readQualityRecord(db: DatabaseSync, original: LoopDatabaseLease, id?: string): QualityRecord | undefined {
    const row = id ? assistantOwnedGet(db,original,'SELECT assessment_id,payload_json FROM assistant_quality_assessments WHERE assessment_id=?',id) : assistantOwnedGet(db,original,'SELECT assessment_id,payload_json FROM assistant_quality_assessments ORDER BY rowid DESC LIMIT 1');
    if (!row)
        return undefined;
    const record = qualityRecordSchema.parse(parseCapturedSourceJson(String(row.payload_json)));
    if (row.assessment_id !== record.assessmentId || record.digest !== frozenQualityDigest(record))
        throw Error('assistant_quality_corrupt');
    return record;
}
export function readCurrentAssistantQualityAssessment(db: DatabaseSync, original: LoopDatabaseLease, readModel?: QualityModelReader, expected?: QualityAssessmentIdentity) {
    try {
        if (!readModel)
            return undefined;
        return assistantOwnedSavepoint(db,original,()=>{
            const model = readModel(), context = readQualityContext(db, original), generation = readQualityGeneration(db, original), record = readQualityRecord(db, original);
            return assessCurrentAssistantQuality({context,generation,record,model,finalModel:readModel(),expected});
        });
    }
    catch {
        return undefined;
    }
}
export function readAssistantQualityAuthorization(db: DatabaseSync, original: LoopDatabaseLease, readModel?: QualityModelReader, expected?: QualityAssessmentIdentity) {
    const assessment = readCurrentAssistantQualityAssessment(db, original, readModel, expected);
    if (!assessment)
        return undefined;
    const { input, report, ...identity } = assessment;
    return { ...identity, qualityQualification: issueAssistantQualityQualification(input, () => readCurrentAssistantQualityAssessment(db, original, readModel, identity)?.reportDigest === identity.reportDigest) };
}
