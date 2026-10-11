import {ownDataArrayIsArray,ownDataArrayPrototypeEvery,ownDataArrayPrototypeForEach,ownDataArrayPrototypeIncludes,ownDataArrayPrototypeJoin,ownDataArrayPrototypeSort,ownDataBufferByteLength,ownDataNumberIsSafeInteger,ownDataObjectFreeze,ownDataObjectKeys,ownDataObjectValues,ownDataRegExpPrototypeTest,ownDataStringPrototypeSplit} from '../verification/application-native-intrinsics.js';
import { captureIntentData } from './data.js';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
export interface IntentProducerOrigin {
    kind: 'model-report';
    providerInvocationId: string;
    toolInvocationId: string;
}
export type IntentProducerAction = {
    kind: 'step-report';
    stepId: string;
    status: 'running' | 'blocked' | 'completed' | 'failed';
    breadcrumb: string;
    receiptNote: string | null;
    blockedReason: string | null;
    origin: IntentProducerOrigin;
} | {
    kind: 'artifact-report';
    stageId: string;
    kindOfArtifact: 'markdown' | 'report' | 'slides' | 'summary' | 'analysis' | 'document' | 'unknown';
    storage: 'inline' | 'file_ref';
    label: string;
    path: string | null;
    inlineValue: string | null;
    summary: string | null;
    reportedStructuralValidation: 'pending' | 'passed' | 'failed';
    reportedSemanticValidation: 'pending' | 'passed' | 'failed';
    origin: IntentProducerOrigin;
};
export interface IntentProducerReport {
    protectionMode: 'ordinary' | 'protected';
    action: IntentProducerAction;
    requestSource: 'user' | 'agent' | 'scheduler';
    now: number;
    artifactId: string | null;
}
const id = (v: unknown) => typeof v === 'string' && v.length > 0 && ownDataBufferByteLength(v) <= 160 && !ownDataRegExpPrototypeTest(/[\x00-\x1f\x7f]/, v);
function shape(v: unknown, keys: string): asserts v is Record<string, any> { if (!v || typeof v !== 'object' || ownDataArrayIsArray(v) || ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort(ownDataObjectKeys(v)), ',') !== ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort(ownDataStringPrototypeSplit(keys, ' ')), ','))
    throw Error('intent_producer_shape'); }
function freeze<T>(v: T): T { if (v && typeof v === 'object') {
    ownDataArrayPrototypeForEach(ownDataObjectValues(v), freeze);
    ownDataObjectFreeze(v);
} return v; }
export function parseIntentProducerAction(raw: unknown): Readonly<IntentProducerAction> {
    const value = captureIntentData(raw) as IntentProducerAction;
    json(raw);
    const a = value;
    shape(a, a?.kind === 'step-report' ? 'kind stepId status breadcrumb receiptNote blockedReason origin' : 'kind stageId kindOfArtifact storage label path inlineValue summary reportedStructuralValidation reportedSemanticValidation origin');
    shape(a.origin, 'kind providerInvocationId toolInvocationId');
    if (a.origin.kind !== 'model-report' || !id(a.origin.providerInvocationId) || !id(a.origin.toolInvocationId))
        throw Error('intent_producer_origin');
    if (a.kind === 'step-report') {
        if (!id(a.stepId) || !ownDataArrayPrototypeIncludes(['running', 'blocked', 'completed', 'failed'], a.status) || typeof a.breadcrumb !== 'string' || !ownDataArrayPrototypeEvery([a.receiptNote, a.blockedReason], v => v === null || typeof v === 'string'))
            throw Error('intent_producer_step');
    }
    else if (a.kind === 'artifact-report') {
        if (!id(a.stageId) || !ownDataArrayPrototypeIncludes(['markdown', 'report', 'slides', 'summary', 'analysis', 'document', 'unknown'], a.kindOfArtifact) || !ownDataArrayPrototypeIncludes(['inline', 'file_ref'], a.storage) || typeof a.label !== 'string' || !ownDataArrayPrototypeEvery([a.path, a.inlineValue, a.summary], v => v === null || typeof v === 'string') || !ownDataArrayPrototypeEvery([a.reportedStructuralValidation, a.reportedSemanticValidation], v => ownDataArrayPrototypeIncludes(['pending', 'passed', 'failed'], v)) || (a.storage === 'inline' ? (a.inlineValue === null || a.path !== null) : (a.path === null || a.inlineValue !== null)))
            throw Error('intent_producer_artifact');
    }
    else
        throw Error('intent_producer_action');
    return freeze(value);
}
export function parseIntentProducerReport(raw: unknown): Readonly<IntentProducerReport> {
    const value = captureIntentData(raw) as IntentProducerReport;
    json(raw);
    shape(value, 'protectionMode action requestSource now artifactId');
    if (!ownDataArrayPrototypeIncludes(['ordinary', 'protected'], value.protectionMode) || !ownDataArrayPrototypeIncludes(['user', 'agent', 'scheduler'], value.requestSource) || !ownDataNumberIsSafeInteger(value.now) || value.now < 0)
        throw Error('intent_producer_report');
    value.action = parseIntentProducerAction(value.action);
    if (value.action.kind === 'step-report' ? value.artifactId !== null : !id(value.artifactId))
        throw Error('intent_producer_report_artifact');
    return freeze(value);
}
