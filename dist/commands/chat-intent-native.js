import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { captureIntentData } from '../runtime/intent-delegation/intent-commit-boundary.js';
import { parseGoalVerificationDefinition } from '../runtime/goal/verification-definition.js';
import { intentNativeLedgerHash } from '../runtime/intent-delegation/native-contract-journal.js';
/** Explicit original definitions, not a recipe generator or authority. */
export function readIntentVerificationFile(path) {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > 65536)
            throw Error('intent_verification_file_limit');
        const bytes = Buffer.alloc(65537);
        let size = 0, count;
        do {
            count = readSync(fd, bytes, size, bytes.length - size, null);
            size += count;
        } while (count && size < bytes.length);
        if (size > 65536)
            throw Error('intent_verification_file_limit');
        const raw = captureIntentData(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size))));
        const exact = (v, keys) => { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== keys.split(' ').sort().join(','))
            throw Error('intent_verification_definition'); return v; };
        exact(raw, 'verification stages');
        if (!Array.isArray(raw.stages) || !raw.stages.length)
            throw Error('intent_verification_definition');
        let previous = -1;
        const stages = raw.stages.map(value => { const row = exact(value, 'order templateId verification'); if (!Number.isSafeInteger(row.order) || row.order <= previous || typeof row.templateId !== 'string' || !row.templateId || /[\x00-\x1f\x7f]/.test(row.templateId))
            throw Error('intent_verification_definition'); previous = row.order; return { order: previous, templateId: row.templateId, verification: parseGoalVerificationDefinition(row.verification) }; });
        const result = { verification: parseGoalVerificationDefinition(raw.verification), stages };
        const freeze = (value) => { if (value && typeof value === 'object') {
            Object.values(value).forEach(freeze);
            Object.freeze(value);
        } };
        freeze(result);
        return result;
    }
    finally {
        closeSync(fd);
    }
}
export function parseIntentNativeCommand(input) {
    const words = input.trim().split(/\s+/);
    if (words[0] !== '/intent' || words[1] !== 'native')
        return null;
    if (words.length === 3 && ['status', 'continue', 'recover'].includes(words[2]))
        return { kind: words[2] };
    if (words.length === 4 && words[2] === 'retry' && words[3] && !/[\x00-\x1f\x7f]/.test(words[3]) && Buffer.byteLength(words[3]) <= 160)
        return { kind: 'retry', stageId: words[3] === 'parent' ? null : words[3] };
    throw Error('intent_native_command');
}
/** Pure lexical selection for the fixed CLI. This is not an execution grant. */
export function prepareIntentNativeContinuation(ledger, input, hasAttachments) {
    if (!ledger || hasAttachments || !/^(继续|继续执行|continue|resume)$/iu.test(input.trim()))
        return null;
    const actual = captureIntentData(ledger), native = actual.nativeContracts?.find(row => row.intentId === actual.activeIntentId), record = actual.intents.find(row => row.intentId === actual.activeIntentId);
    if (!native || !record || native.subjects.some(subject => subject.attempts.at(-1)?.phase !== 'enrolled') || !['drafting_plan', 'executing', 'recovering'].includes(record.overallStatus))
        return null;
    const stage = record.stages.find(row => row.stageId === record.activeStageId), step = stage?.steps.find(row => row.stepId === record.activeStepId);
    if (!stage || !step || stage.status === 'publication_pending' || stage.status === 'completed' || record.executionTerminals?.some(row => row.kind === 'step' && row.identity === record.activeStepId))
        return null;
    const { instanceId, intentId, sessionId, rawIntent, normalizedIntent, providedSourcePaths, intentType, deliverable, finalDeliverable, explicitConstraints, delegationBoundary, riskTier, intentMode, segmentationConfidence, templateId, stages, steps } = record;
    return { basis: intentNativeLedgerHash(actual), plan: { instanceId, intentId, sessionId, rawIntent, normalizedIntent, ...(providedSourcePaths ? { providedSourcePaths } : {}), intentType, deliverable, finalDeliverable, explicitConstraints, delegationBoundary, riskTier, intentMode, segmentationConfidence, templateId, stages, steps, continuationMode: 'continue_active' }, text: `继续执行已登记的原始任务，保持原合同、材料、全部义务和边界不变。\n原始任务：${native.originalDraft.rawIntent}\n原意图：${record.intentId}\n当前阶段：${record.activeStageId}\n当前步骤：${record.activeStepId}\n任务执行结束只报告实际执行与产物，不声明独立验证或业务发布已完成。` };
}
