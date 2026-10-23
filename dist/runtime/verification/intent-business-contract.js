import { createHash } from 'node:crypto';
import { captureApplicationData } from './application-value-data.js';
import { parseGoalVerificationDefinition } from '../goal/verification-definition.js';
import { canonicalVerificationJson as json } from './protocol.js';
const roles = ['collect', 'inspect_current', 'normalize', 'identify_delta', 'extract', 'compare', 'compose', 'rewrite', 'structure', 'conclude', 'validate', 'finalize'];
const intentTypes = ['generate', 'revise', 'summarize', 'analyze'];
const riskTiers = ['low', 'medium', 'high'];
export const INTENT_BUSINESS_CONTRACT_HASH_DOMAIN = 'xiaok-intent-business-contract-v1';
/** Inspect the whole tree before any parser or canonical serializer can read it. */
function capture(raw) { return captureApplicationData(raw, { maximumBytes: 65536, maximumNodes: 65536, invalid: 'intent_contract_data', limit: 'intent_contract_limit' }); }
function fields(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.split(' ').sort().join(','))
        throw Error('intent_contract_shape');
}
function identity(value) {
    if (typeof value !== 'string' || !value.length || Buffer.byteLength(value) > 160 || /[\x00-\x1f\x7f]/.test(value))
        throw Error('intent_contract_identity');
}
function text(value) { if (typeof value !== 'string')
    throw Error('intent_contract_text'); }
function texts(value) { if (!Array.isArray(value))
    throw Error('intent_contract_array'); value.forEach(text); }
function member(value, allowed) { if (typeof value !== 'string' || !allowed.includes(value))
    throw Error('intent_contract_enum'); }
function order(value, prior) { if (!Number.isSafeInteger(value) || value < 0 || value <= prior)
    throw Error('intent_contract_order'); }
function dependencies(raw, prior) {
    if (!Array.isArray(raw))
        throw Error('intent_contract_dependencies');
    const seen = new Set();
    for (const id of raw) {
        identity(id);
        if (!prior.has(id) || seen.has(id))
            throw Error('intent_contract_dependencies');
        seen.add(id);
    }
}
function freeze(value) { if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
} return value; }
function bounded(value) { if (Buffer.byteLength(json(value)) > 65536)
    throw Error('intent_contract_limit'); }
/** Pure immutable contract. No owner is enrolled and no result is verified here. */
export function parseIntentBusinessContract(raw) {
    const value = capture(raw);
    bounded(value);
    fields(value, 'version sessionId intentId rawIntent normalizedIntent providedSourcePaths intentType deliverable finalDeliverable explicitConstraints delegationBoundary riskTier intentMode segmentationConfidence templateId stages verification');
    if (value.version !== 1)
        throw Error('intent_contract_version');
    [value.sessionId, value.intentId, value.templateId].forEach(identity);
    [value.rawIntent, value.normalizedIntent, value.deliverable, value.finalDeliverable].forEach(text);
    [value.providedSourcePaths, value.explicitConstraints, value.delegationBoundary].forEach(texts);
    member(value.intentType, intentTypes);
    member(value.riskTier, riskTiers);
    member(value.intentMode, ['single_stage', 'multi_stage']);
    member(value.segmentationConfidence, riskTiers);
    if (!Array.isArray(value.stages) || !value.stages.length || (value.intentMode === 'single_stage' ? value.stages.length !== 1 : value.stages.length < 2))
        throw Error('intent_contract_stages');
    const stageIds = new Set(), globalSteps = new Set();
    let stageOrder = -1;
    for (const stage of value.stages) {
        fields(stage, 'stageId order label intentType deliverable templateId riskTier dependsOnStageIds steps verification');
        identity(stage.stageId);
        identity(stage.templateId);
        if (stageIds.has(stage.stageId))
            throw Error('intent_contract_stage_duplicate');
        order(stage.order, stageOrder);
        stageOrder = stage.order;
        text(stage.label);
        text(stage.deliverable);
        member(stage.intentType, intentTypes);
        member(stage.riskTier, riskTiers);
        dependencies(stage.dependsOnStageIds, stageIds);
        stageIds.add(stage.stageId);
        if (!Array.isArray(stage.steps) || !stage.steps.length)
            throw Error('intent_contract_steps');
        const localSteps = new Set();
        let stepOrder = -1;
        for (const step of stage.steps) {
            fields(step, 'stepId key order role skillName dependsOn riskTier');
            identity(step.stepId);
            identity(step.key);
            if (step.skillName !== null)
                identity(step.skillName);
            if (globalSteps.has(step.stepId))
                throw Error('intent_contract_step_duplicate');
            order(step.order, stepOrder);
            stepOrder = step.order;
            member(step.role, roles);
            member(step.riskTier, riskTiers);
            dependencies(step.dependsOn, localSteps);
            localSteps.add(step.stepId);
            globalSteps.add(step.stepId);
        }
        stage.verification = parseGoalVerificationDefinition(stage.verification);
    }
    value.verification = parseGoalVerificationDefinition(value.verification);
    bounded(value);
    return freeze(value);
}
export function intentBusinessContractHash(raw) {
    return createHash('sha256').update(INTENT_BUSINESS_CONTRACT_HASH_DOMAIN + '\0').update(json(parseIntentBusinessContract(raw))).digest('hex');
}
