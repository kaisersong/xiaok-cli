import { createHash, Hash } from 'node:crypto';
import { captureDispatchBusinessData } from '../conversation-activity/dispatch-business-data.js';
import { canonicalVerificationJson } from '../verification/protocol.js';
import { instantMs, parseA2Snapshot, parseEvidenceManifest, parseMandateProjection, parseSemanticAssessment, } from './parse.js';
import type { A2SnapshotV1, A2TimeStateV1, DeadlineState } from './types.js';
const apply = Reflect.apply;
const nativeCreateHash = createHash;
const update = Hash.prototype.update;
const digest = Hash.prototype.digest;
const parse = JSON.parse;
const own = Object.hasOwn;
const define = Object.defineProperty;
const min = Math.min;
/** A data digest is an integrity value, never an authority or a producer proof. */
export function hashA2Data(value: unknown): string {
    const data = captureDispatchBusinessData(value);
    const hash = nativeCreateHash('sha256');
    apply(update, hash, [canonicalVerificationJson(data)]);
    return apply(digest, hash, ['hex']) as string;
}
export function hashEvidenceManifest(value: unknown): string {
    const manifest = parseEvidenceManifest(value);
    return hashA2Data(['a2.evidence.v1', {
            schemaVersion: manifest.schemaVersion,
            thread: manifest.thread,
            entries: manifest.entries,
        }]);
}
export function hashMandateProjection(value: unknown): string | null {
    const mandate = parseMandateProjection(value);
    if (mandate.workProfile.state !== 'known') {
        return null;
    }
    return hashA2Data(['a2.mandate.v1', {
            document: mandate.document,
            assessmentProfile: mandate.assessmentProfile,
            workProfile: mandate.workProfile.value,
        }]);
}
export function hashSemanticAssessment(value: unknown): string {
    const assessment = parseSemanticAssessment(value);
    const core = parse(canonicalVerificationJson(assessment));
    delete core.assessmentId;
    delete core.assessmentHash;
    return hashA2Data(['a2.assessment.v1', core]);
}
export function timeStates(snapshot: A2SnapshotV1): A2TimeStateV1 {
    const clock = snapshot.clock;
    const deadline = (value: number | null, applicable = true): DeadlineState => {
        if (!applicable) {
            return 'not_applicable';
        }
        if (clock.state !== 'verified' || value === null) {
            return 'unconfirmed';
        }
        return clock.nowMs >= value ? 'closed' : 'open';
    };
    const mandate = snapshot.mandate.state === 'known' ? snapshot.mandate.value.document : null;
    const mandateEnd = mandate ? instantMs(mandate.validUntil) : null;
    const assessmentEnd = snapshot.assessment ? instantMs(snapshot.assessment.validUntil) : null;
    let workEnd = mandate ? instantMs(mandate.limits.executionDeadline) : null;
    if (snapshot.binding.state === 'known' && snapshot.binding.value.kind === 'bound') {
        const original = instantMs(snapshot.binding.value.binding.transport.workExecutionDeadline);
        workEnd = workEnd === null ? null : min(workEnd, original);
    }
    const futureWork = snapshot.clock.state === 'verified' && snapshot.binding.state === 'known' && snapshot.binding.value.kind === 'bound' && instantMs(snapshot.binding.value.binding.transport.workCreatedAt) > snapshot.clock.nowMs;
    let window: A2TimeStateV1['window'] = 'unproven';
    if (snapshot.freshness.state === 'known') {
        const fact = snapshot.freshness.value;
        window = fact.state;
        if (instantMs(fact.eventOccurredAt) < instantMs(fact.window.effectiveAt)) {
            window = 'backlog';
        }
        if (clock.state === 'verified' && instantMs(fact.eventOccurredAt) > clock.nowMs) {
            window = 'unproven';
        }
    }
    return {
        clock: clock.state,
        mandate: deadline(mandateEnd),
        assessment: deadline(assessmentEnd, snapshot.assessment !== null),
        authority: deadline(mandateEnd === null || assessmentEnd === null ? null : min(mandateEnd, assessmentEnd), snapshot.assessment !== null),
        work: futureWork ? 'unconfirmed' : deadline(workEnd),
        observation: deadline(mandate ? instantMs(mandate.followup.observationEndsAt) : null),
        window,
    };
}
export function coreSnapshot(value: unknown): unknown {
    const snapshot = parseA2Snapshot(value);
    // The input has already passed the own-data parser. This copy is internal only.
    const core = parse(canonicalVerificationJson(snapshot));
    delete core.input.envelope.receivedAt;
    delete core.input.envelope.authorizationCheckedAt;
    if (core.input.evidence.state === 'known') {
        delete core.input.evidence.value.sourceSnapshotAt;
    }
    if (snapshot.mandate.state === 'known') {
        const mandate = snapshot.mandate.value;
        if (own(mandate.document.selection, 'issueIds')) {
            core.labels = null;
        }
        if (mandate.contentHash !== null && mandate.contentHash === hashMandateProjection(mandate)) {
            core.mandate.value = {
                contentHash: mandate.contentHash,
                revision: mandate.document.revision,
                authorizationEpoch: mandate.document.authorizationEpoch,
                status: mandate.document.status,
            };
        }
    }
    const assessmentValid = snapshot.assessment !== null && snapshot.assessment.assessmentHash === hashSemanticAssessment(snapshot.assessment);
    let selectedRelationValid = false;
    if (assessmentValid && snapshot.assessment && snapshot.selection.state === 'known' && snapshot.selection.value.kind === 'selected' && snapshot.mandate.state === 'known') {
        const selected = snapshot.selection.value.value, assessment = snapshot.assessment, mandate = snapshot.mandate.value.document;
        selectedRelationValid = selected.inputId === snapshot.input.envelope.inputId && selected.mandateId === mandate.mandateId && selected.mandateRevision === mandate.revision && selected.assessmentVersion === assessment.assessmentVersion && selected.assessmentId === assessment.assessmentId && selected.assessmentHash === assessment.assessmentHash;
    }
    const selectionNotSelected = snapshot.selection.state === 'known' && snapshot.selection.value.kind === 'none';
    if (assessmentValid && snapshot.assessment && (selectedRelationValid || selectionNotSelected)) {
        const assessment = snapshot.assessment;
        core.assessment = {
            assessmentHash: assessment.assessmentHash,
            assessmentVersion: assessment.assessmentVersion,
            purpose: assessment.purpose,
            decisive: assessment.decisive,
            modelId: assessment.modelId,
            promptVersion: assessment.promptVersion,
        };
    }
    if (selectedRelationValid) {
        delete core.selection.value.value.assessmentId;
    }
    if (core.consumption.state === 'known' && core.consumption.value.kind === 'consumed') {
        delete core.consumption.value.receiptRef;
    }
    delete core.clock.nowMs;
    define(core, 'timeStates', {
        __proto__: null, value: timeStates(snapshot), enumerable: true
    } as PropertyDescriptor);
    return captureDispatchBusinessData(core);
}
export function hashPreflightSnapshot(value: unknown): string {
    return hashA2Data(['a2.preflight.v1', coreSnapshot(value)]);
}
export function hashEvaluationSnapshot(value: unknown): string {
    return hashA2Data(['a2.post.v1', coreSnapshot(value)]);
}
