import {assistantOwnedRun,assistantOwnedExec} from './assistant-owned-sqlite.js';
import {assistantOwnedGet,assistantOwnedAll} from './assistant-owned-sqlite.js';
import {assistantOwnedSqlite} from './assistant-owned-sqlite.js';
import {readOriginalLoopMigrationLease,type LoopDatabaseLease} from './loop-database-owner.js';
import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {dataSchema,evaluateAssistantQuality,sampleAssistantQuality} from '../../src/runtime/assistant/quality-qualification.js';
import {ASSISTANT_QUALITY_REVIEW_INSTRUCTIONS,humanRiskReviewSchema,applyHumanRiskReview,exportedRiskFacts,hasFrozenRiskCoverage,exportedQualityFacts,humanQualityReviewSchema,qualityRecordSchema,qualityDigest,frozenQualityDigest,applyHumanQualityReview,type QualityRecord} from '../../src/runtime/assistant/quality-authorization.js';
import {readQualityContext,readQualityGeneration,readQualityRecord,readAssistantQualityAuthorization} from './assistant-quality-authorization.js';
import {ASSISTANT_QUALITY_MAX_BYTES,authorizeSource,user,atomic,writeAssistantQualityRecord,revokeAssistantQuality,predictions,type Source,type AssistantQualityPorts,type AssistantQualityStatus} from './assistant-quality-workflow-support.js';
export {ASSISTANT_QUALITY_MAX_BYTES,migrateAssistantQuality,syncAssistantQualityContext,writeAssistantQualityRecord,revokeAssistantQuality} from './assistant-quality-workflow-support.js';
export type {AssistantQualityStatus,AssistantQualityPopulation,AssistantQualityPorts} from './assistant-quality-workflow-support.js';
/** Main service. Public methods accept semantic requests only; all data/file ports are private. */
export class AssistantQualityWorkflow {
    constructor(private readonly db: DatabaseSync, private readonly original: LoopDatabaseLease, private readonly ports: AssistantQualityPorts) { readOriginalLoopMigrationLease(original,db); }
    private current(record: QualityRecord) {
        const model = this.ports.readCurrentModel();
        if (model.modelEpoch !== record.context.modelEpoch || model.configFingerprint !== record.context.configFingerprint || record.generation !== readQualityGeneration(this.db, this.original) || JSON.stringify(record.context) !== JSON.stringify(readQualityContext(this.db, this.original)))
            throw Error('assistant_quality_binding_changed');
    }
    private importable(record: QualityRecord) {
        const model = this.ports.readCurrentModel();
        if (model.modelEpoch !== record.context.modelEpoch || model.configFingerprint !== record.context.configFingerprint)
            throw Error('assistant_quality_model_changed');
        const generation = readQualityGeneration(this.db, this.original), state = assistantOwnedGet(this.db,this.original,'SELECT reimport_id FROM assistant_quality_state WHERE singleton=1');
        if (readQualityRecord(this.db, this.original)?.assessmentId !== record.assessmentId || JSON.stringify(record.context) !== JSON.stringify(readQualityContext(this.db, this.original)))
            throw Error('assistant_quality_binding_changed');
        if (record.generation === generation && record.phase === 'exported')
            return;
        if (record.generation < generation && state?.reimport_id === record.assessmentId && ['exported', 'assessed'].includes(record.phase))
            return;
        throw Error('assistant_quality_import_state');
    }
    async freeze(input: Source) {
        user(input);
        const context = readQualityContext(this.db, this.original), model = this.ports.readCurrentModel();
        if (model.modelEpoch !== context.modelEpoch || model.configFingerprint !== context.configFingerprint)
            throw Error('assistant_quality_model_changed');
        const generation = readQualityGeneration(this.db, this.original), raw = await this.ports.population();
        const basis = dataSchema.parse({ binding: raw.binding, population: raw.population, protocol: raw.protocol, cases: [] });
        return atomic(this.db, this.original, () => {
            const currentModel = this.ports.readCurrentModel();
            if (currentModel.modelEpoch !== model.modelEpoch || currentModel.configFingerprint !== model.configFingerprint || JSON.stringify(context) !== JSON.stringify(readQualityContext(this.db, this.original)) || generation !== readQualityGeneration(this.db, this.original))
                throw Error('assistant_quality_binding_changed');
            if (JSON.stringify(basis.binding) !== JSON.stringify(context.binding) || basis.protocol.analysisContract !== context.analysisContract)
                throw Error('assistant_quality_binding_changed');
            if (!basis.population.complete || new Set(basis.population.ids).size !== basis.population.ids.length || basis.binding.window.to <= basis.binding.window.from || basis.protocol.firstAnnotator === basis.protocol.secondAnnotator)
                throw Error('assistant_quality_population');
            const ids = sampleAssistantQuality(basis);
            basis.cases = ids.map(id => ({ id, prediction: 'unknown', firstLabel: 'unknown', secondLabel: 'unknown', severe: false }));
            const selected = new Set(ids), facts = raw.facts.filter(f => selected.has(f.id));
            if (new Set(facts.map(f => f.id)).size !== facts.length || facts.length !== ids.length)
                throw Error('assistant_quality_facts');
            const factById = new Map(facts.map(fact => [fact.id, fact]));
            basis.cases = basis.cases.map(row => ({ ...row, severe: factById.get(row.id)?.severe === true }));
            const partial = { reviewInstructions:structuredClone(ASSISTANT_QUALITY_REVIEW_INSTRUCTIONS),assessmentId: randomUUID(), generation, dataset: basis, facts, context };
            const record = qualityRecordSchema.parse({ ...partial, phase: 'frozen', digest: frozenQualityDigest(partial), attestation: null, review: null, reportDigest: null });
            writeAssistantQualityRecord(this.db, this.original, record);
            return { assessmentId: record.assessmentId, digest: record.digest };
        });
    }
    async recordPredictions(input: Source & {
        assessmentId: string;
        expectedDigest: string;
    }) {
        user(input, ['assessmentId', 'expectedDigest']);
        const record = readQualityRecord(this.db, this.original, input.assessmentId);
        if (!record || record.phase !== 'frozen' || record.digest !== input.expectedDigest)
            throw Error('assistant_quality_prediction_locked');
        this.current(record);
        if (!hasFrozenRiskCoverage(record))
            throw Error('assistant_quality_risk_review_required');
        if (!this.ports.predict)
            throw Error('assistant_quality_provider_unavailable');
        const output = predictions.parse(await this.ports.predict({ ...structuredClone(record.dataset), facts: structuredClone(record.facts) }, record.digest)), byId = new Map(output.map(row => [row.id, row]));
        if (byId.size !== output.length || output.length !== record.dataset.cases.length || record.dataset.cases.some(row => !byId.has(row.id)))
            throw Error('assistant_quality_prediction_cases');
        return atomic(this.db, this.original, () => {
            const current = readQualityRecord(this.db, this.original, record.assessmentId);
            if (!current || current.phase !== 'frozen' || current.digest !== record.digest)
                throw Error('assistant_quality_prediction_locked');
            this.current(current);
            current.dataset.cases = current.dataset.cases.map(row => ({ ...row, ...byId.get(row.id)! }));
            current.phase = 'predicted';
            current.digest = frozenQualityDigest(current);
            writeAssistantQualityRecord(this.db, this.original, current);
            return { assessmentId: current.assessmentId, digest: current.digest };
        });
    }
    async export(input: Source & {
        assessmentId: string;
    }) {
        user(input, ['assessmentId']);
        const record = atomic(this.db, this.original, () => {
            const row = readQualityRecord(this.db, this.original, input.assessmentId);
            if (!row || row.phase === 'assessed')
                throw Error('assistant_quality_export_state');
            this.current(row);
            if (!hasFrozenRiskCoverage(row)) {
                if (!['frozen', 'risk_exported'].includes(row.phase))
                    throw Error('assistant_quality_risk_locked');
                row.phase = 'risk_exported';
            }
            else {
                if (!['predicted', 'exported'].includes(row.phase))
                    throw Error('assistant_quality_predictions_required');
                row.phase = 'exported';
            }
            writeAssistantQualityRecord(this.db, this.original, row);
            return row;
        });
        const contents = JSON.stringify(record.phase === 'risk_exported' ? { version: 1, type: 'risk_review', assessmentId: record.assessmentId, digest: record.digest, frozen: exportedRiskFacts(record), riskLabels: record.dataset.cases.map(({ id }) => ({ id, severe: null })) } : { version: 1, type: 'action_review', assessmentId: record.assessmentId, digest: record.digest, frozen: exportedQualityFacts(record), labels: record.dataset.cases.map(({ id }) => ({ id, firstLabel: 'unknown', secondLabel: 'unknown' })) }, null, 2);
        if (Buffer.byteLength(contents) > ASSISTANT_QUALITY_MAX_BYTES)
            throw Error('assistant_quality_export_size');
        const saved = await this.ports.save(contents, () => this.current(record));
        return { cancelled: !saved, status: this.status({ requestSource: input.requestSource }) };
    }
    async import(input: Source) {
        user(input);
        const contents = await this.ports.open(ASSISTANT_QUALITY_MAX_BYTES);
        if (contents === null)
            return { cancelled: true, status: this.status({ requestSource: input.requestSource }) };
        if (typeof contents !== 'string' || Buffer.byteLength(contents) > ASSISTANT_QUALITY_MAX_BYTES)
            throw Error('assistant_quality_import_size');
        const raw: unknown = JSON.parse(contents);
        if (raw && typeof raw === 'object' && 'type' in raw && raw.type === 'risk_review')
            return this.importRisk(contents, input);
        // Parse and validate before asking native confirmation; repeat against current DB after await.
        const parsed = humanQualityReviewSchema.parse(raw);
        const before = readQualityRecord(this.db, this.original, parsed.assessmentId);
        if (!before)
            throw Error('assistant_quality_import_state');
        this.importable(before);
        applyHumanQualityReview(before, parsed);
        const confirmationGeneration = readQualityGeneration(this.db, this.original);
        const attestation = await this.ports.confirmHumanReview('action_review');
        if (!attestation)
            throw Error('assistant_quality_human_confirmation_required');
        atomic(this.db, this.original, () => {
            if (readQualityGeneration(this.db, this.original) !== confirmationGeneration)
                throw Error('assistant_quality_confirmation_stale');
            const record = readQualityRecord(this.db, this.original, parsed.assessmentId);
            if (!record)
                throw Error('assistant_quality_import_state');
            this.importable(record);
            record.generation = readQualityGeneration(this.db, this.original);
            const dataset = applyHumanQualityReview(record, parsed), report = evaluateAssistantQuality(dataset);
            record.attestation = { provenance: 'user-attested', independentlyVerified: false, userId: attestation.userId, text: attestation.text, at: Date.now() };
            record.review = contents;
            record.reportDigest = qualityDigest({ input: dataset, report });
            record.phase = 'assessed';
            writeAssistantQualityRecord(this.db, this.original, record);
            assistantOwnedRun(this.db,this.original,'UPDATE assistant_quality_state SET reimport_id=NULL WHERE singleton=1');
        });
        return { cancelled: false, status: this.status({ requestSource: input.requestSource }) };
    }
    private async importRisk(contents: string, input: Source) {
        const parsed = humanRiskReviewSchema.parse(JSON.parse(contents));
        const before = readQualityRecord(this.db, this.original, parsed.assessmentId);
        if (!before || !['frozen', 'risk_exported'].includes(before.phase) || before.riskReview !== null || hasFrozenRiskCoverage(before))
            throw Error('assistant_quality_risk_locked');
        this.current(before);
        applyHumanRiskReview(before, parsed);
        const generation = readQualityGeneration(this.db, this.original);
        const attestation = await this.ports.confirmHumanReview('risk_review');
        if (!attestation)
            throw Error('assistant_quality_human_confirmation_required');
        atomic(this.db, this.original, () => {
            const record = readQualityRecord(this.db, this.original, parsed.assessmentId);
            if (!record || readQualityRecord(this.db, this.original)?.assessmentId !== record.assessmentId || generation !== readQualityGeneration(this.db, this.original) || !['frozen', 'risk_exported'].includes(record.phase) || record.riskReview !== null)
                throw Error('assistant_quality_risk_locked');
            this.current(record);
            const labels = applyHumanRiskReview(record, parsed);
            record.facts = record.facts.map(row => ({ ...row, severe: labels.get(row.id)! }));
            record.dataset.cases = record.dataset.cases.map(row => ({ ...row, severe: labels.get(row.id)! }));
            record.riskReview = contents;
            record.riskAttestation = { provenance: 'user-attested', independentlyVerified: false, userId: attestation.userId, text: attestation.text, at: Date.now() };
            record.phase = 'frozen';
            record.digest = frozenQualityDigest(record);
            writeAssistantQualityRecord(this.db, this.original, record);
        });
        return { cancelled: false, status: this.status(input) };
    }
    revoke(input: Source): AssistantQualityStatus { user(input); revokeAssistantQuality(this.db, this.original, this.ports.readCurrentModel); return this.status(input); }
    status(input: Source): AssistantQualityStatus {
        user(input);
        const base: AssistantQualityStatus = { state: 'not_evaluated', populationCount: 0, sampleCount: 0, needsAction: 0, seriousMisses: 0, precision: null, recall: null, unknownRate: null, reason: null };
        try {
            const record = readQualityRecord(this.db, this.original);
            if (!record)
                return base;
            base.populationCount = record.dataset.population.ids.length;
            base.sampleCount = record.dataset.cases.length;
            try {
                this.current(record);
            }
            catch {
                return { ...base, state: 'stale', reason: 'binding_changed' };
            }
            if (record.phase !== 'assessed')
                return { ...base, state: 'review_required', reason: base.sampleCount < 100 ? 'insufficient_cases' : 'labels_required' };
            if (!record.review || !record.attestation)
                throw Error('assistant_quality_review_missing');
            const dataset = applyHumanQualityReview(record, JSON.parse(record.review)), report = evaluateAssistantQuality(dataset);
            if (record.reportDigest !== qualityDigest({ input: dataset, report }))
                throw Error('assistant_quality_report_corrupt');
            const passed = report.passed && hasFrozenRiskCoverage(record);
            return { ...base, state: passed ? 'passed' : 'failed', needsAction: report.needsAction, seriousMisses: report.seriousMisses, precision: report.precision.value, recall: report.recall.value, unknownRate: report.unknown.value, reason: passed ? null : 'quality_failed' };
        }
        catch {
            return { ...base, state: 'unavailable', reason: 'source_unavailable' };
        }
    }
    /** User-only report extraction; recomputes from frozen predictions, never includes source text. */
    report(input:Source){user(input);const record=readQualityRecord(this.db, this.original);if(!record||record.phase!=='assessed'||!record.review||!record.attestation)throw Error('assistant_quality_report_unavailable');this.current(record);
      const dataset=applyHumanQualityReview(record,JSON.parse(record.review)),report=evaluateAssistantQuality(dataset);if(record.reportDigest!==qualityDigest({input:dataset,report}))throw Error('assistant_quality_report_corrupt');
      return {assessmentId:record.assessmentId,generation:record.generation,digest:record.digest,analysisContract:record.context.analysisContract,humanProvenance:'user-attested' as const,independentlyVerified:false as const,attestation:structuredClone(record.attestation),riskAttestation:structuredClone(record.riskAttestation),report:{...report,passed:report.passed&&hasFrozenRiskCoverage(record),riskCoverageComplete:hasFrozenRiskCoverage(record)}};
    }
    /** Main integration target only; no raw source or qualification claim. */
    currentReview(input: Source) {
        user(input);
        const record = readQualityRecord(this.db, this.original);
        if (!record)
            return undefined;
        this.current(record);
        return { assessmentId: record.assessmentId, digest: record.digest, generation: record.generation, phase: record.phase, riskCoverageComplete: hasFrozenRiskCoverage(record) };
    }
    readiness(input: Source) { authorizeSource(input, ['user', 'scheduler']); const authorization = readAssistantQualityAuthorization(this.db, this.original, this.ports.readCurrentModel); return authorization ? { qualityQualification: authorization.qualityQualification, currentBinding: authorization.currentBinding, assessmentId: authorization.assessmentId, generation: authorization.generation, digest: authorization.digest } : {}; }
}
