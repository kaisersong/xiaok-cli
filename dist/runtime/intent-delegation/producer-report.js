import { captureIntentData } from './data.js';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
const id = (v) => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v) <= 160 && !/[\x00-\x1f\x7f]/.test(v);
function shape(v, keys) { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== keys.split(' ').sort().join(','))
    throw Error('intent_producer_shape'); }
function freeze(v) { if (v && typeof v === 'object') {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
} return v; }
export function parseIntentProducerAction(raw) {
    const value = captureIntentData(raw);
    json(raw);
    const a = value;
    shape(a, a?.kind === 'step-report' ? 'kind stepId status breadcrumb receiptNote blockedReason origin' : 'kind stageId kindOfArtifact storage label path inlineValue summary reportedStructuralValidation reportedSemanticValidation origin');
    shape(a.origin, 'kind providerInvocationId toolInvocationId');
    if (a.origin.kind !== 'model-report' || !id(a.origin.providerInvocationId) || !id(a.origin.toolInvocationId))
        throw Error('intent_producer_origin');
    if (a.kind === 'step-report') {
        if (!id(a.stepId) || !['running', 'blocked', 'completed', 'failed'].includes(a.status) || typeof a.breadcrumb !== 'string' || ![a.receiptNote, a.blockedReason].every(v => v === null || typeof v === 'string'))
            throw Error('intent_producer_step');
    }
    else if (a.kind === 'artifact-report') {
        if (!id(a.stageId) || !['markdown', 'report', 'slides', 'summary', 'analysis', 'document', 'unknown'].includes(a.kindOfArtifact) || !['inline', 'file_ref'].includes(a.storage) || typeof a.label !== 'string' || ![a.path, a.inlineValue, a.summary].every(v => v === null || typeof v === 'string') || ![a.reportedStructuralValidation, a.reportedSemanticValidation].every(v => ['pending', 'passed', 'failed'].includes(v)) || (a.storage === 'inline' ? (a.inlineValue === null || a.path !== null) : (a.path === null || a.inlineValue !== null)))
            throw Error('intent_producer_artifact');
    }
    else
        throw Error('intent_producer_action');
    return freeze(value);
}
export function parseIntentProducerReport(raw) {
    const value = captureIntentData(raw);
    json(raw);
    shape(value, 'protectionMode action requestSource now artifactId');
    if (!['ordinary', 'protected'].includes(value.protectionMode) || !['user', 'agent', 'scheduler'].includes(value.requestSource) || !Number.isSafeInteger(value.now) || value.now < 0)
        throw Error('intent_producer_report');
    value.action = parseIntentProducerAction(value.action);
    if (value.action.kind === 'step-report' ? value.artifactId !== null : !id(value.artifactId))
        throw Error('intent_producer_report_artifact');
    return freeze(value);
}
