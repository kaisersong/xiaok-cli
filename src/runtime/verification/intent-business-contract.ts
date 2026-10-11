import {ownDataArrayIsArray,ownDataArrayPrototypeForEach,ownDataArrayPrototypeIncludes,ownDataArrayPrototypeJoin,ownDataArrayPrototypeSort,ownDataBufferByteLength,ownDataNumberIsSafeInteger,ownDataObjectFreeze,ownDataObjectKeys,ownDataObjectValues,ownDataRegExpPrototypeTest,ownDataSetPrototypeAdd,ownDataSetPrototypeHas,ownDataStringPrototypeSplit} from './application-native-intrinsics.js';
import { capturedArrayIterator, createCapturedSet } from './application-iteration-intrinsics.js';
import { createHash } from 'node:crypto';
import { captureApplicationData } from './application-value-data.js';
import type { IntentType, RiskTier, IntentMode, SegmentationConfidence, StepRole } from '../../ai/intent-delegation/types.js';
import { parseGoalVerificationDefinition, type GoalVerificationDefinition } from '../goal/verification-definition.js';
import { canonicalVerificationJson as json } from './protocol.js';
export interface IntentContractStep {
    readonly stepId: string;
    readonly key: string;
    readonly order: number;
    readonly role: StepRole;
    readonly skillName: string | null;
    readonly dependsOn: readonly string[];
    readonly riskTier: RiskTier;
}
export interface IntentContractStage {
    readonly stageId: string;
    readonly order: number;
    readonly label: string;
    readonly intentType: IntentType;
    readonly deliverable: string;
    readonly templateId: string;
    readonly riskTier: RiskTier;
    readonly dependsOnStageIds: readonly string[];
    readonly steps: readonly Readonly<IntentContractStep>[];
    readonly verification: Readonly<GoalVerificationDefinition>;
}
export interface IntentBusinessContract {
    readonly version: 1;
    readonly sessionId: string;
    readonly intentId: string;
    readonly rawIntent: string;
    readonly normalizedIntent: string;
    readonly providedSourcePaths: readonly string[];
    readonly intentType: IntentType;
    readonly deliverable: string;
    readonly finalDeliverable: string;
    readonly explicitConstraints: readonly string[];
    readonly delegationBoundary: readonly string[];
    readonly riskTier: RiskTier;
    readonly intentMode: IntentMode;
    readonly segmentationConfidence: SegmentationConfidence;
    readonly templateId: string;
    readonly stages: readonly Readonly<IntentContractStage>[];
    readonly verification: Readonly<GoalVerificationDefinition>;
}
const roles = ['collect', 'inspect_current', 'normalize', 'identify_delta', 'extract', 'compare', 'compose', 'rewrite', 'structure', 'conclude', 'validate', 'finalize'] as const;
const intentTypes = ['generate', 'revise', 'summarize', 'analyze'] as const;
const riskTiers = ['low', 'medium', 'high'] as const;
export const INTENT_BUSINESS_CONTRACT_HASH_DOMAIN = 'xiaok-intent-business-contract-v1';
/** Inspect the whole tree before any parser or canonical serializer can read it. */
function capture(raw: unknown): any { return captureApplicationData(raw, { maximumBytes: 65536, maximumNodes: 65536, invalid: 'intent_contract_data', limit: 'intent_contract_limit' }); }
function fields(value: unknown, keys: string): asserts value is Record<string, any> {
    if (!value || typeof value !== 'object' || ownDataArrayIsArray(value) || ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort(ownDataObjectKeys(value)), ',') !== ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort(ownDataStringPrototypeSplit(keys, ' ')), ','))
        throw Error('intent_contract_shape');
}
function identity(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value.length || ownDataBufferByteLength(value) > 160 || ownDataRegExpPrototypeTest(/[\x00-\x1f\x7f]/, value))
        throw Error('intent_contract_identity');
}
function text(value: unknown): void { if (typeof value !== 'string')
    throw Error('intent_contract_text'); }
function texts(value: unknown): asserts value is string[] { if (!ownDataArrayIsArray(value))
    throw Error('intent_contract_array'); ownDataArrayPrototypeForEach(value, text); }
function member(value: unknown, allowed: readonly string[]): void { if (typeof value !== 'string' || !ownDataArrayPrototypeIncludes(allowed, value))
    throw Error('intent_contract_enum'); }
function order(value: unknown, prior: number): asserts value is number { if (!ownDataNumberIsSafeInteger(value) || (value as number) < 0 || (value as number) <= prior)
    throw Error('intent_contract_order'); }
function dependencies(raw: unknown, prior: ReadonlySet<string>): void {
    if (!ownDataArrayIsArray(raw))
        throw Error('intent_contract_dependencies');
    const seen = createCapturedSet<string>();
    for (const id of capturedArrayIterator(raw)) {
        identity(id);
        if (!ownDataSetPrototypeHas(prior, id) || ownDataSetPrototypeHas(seen, id))
            throw Error('intent_contract_dependencies');
        ownDataSetPrototypeAdd(seen, id);
    }
}
function freeze<T>(value: T): Readonly<T> { if (value && typeof value === 'object') {
    ownDataArrayPrototypeForEach(ownDataObjectValues(value), freeze);
    ownDataObjectFreeze(value);
} return value; }
function bounded(value: unknown): void { if (ownDataBufferByteLength(json(value)) > 65536)
    throw Error('intent_contract_limit'); }
/** Pure immutable contract. No owner is enrolled and no result is verified here. */
export function parseIntentBusinessContract(raw: unknown): Readonly<IntentBusinessContract> {
    const value = capture(raw);
    bounded(value);
    fields(value, 'version sessionId intentId rawIntent normalizedIntent providedSourcePaths intentType deliverable finalDeliverable explicitConstraints delegationBoundary riskTier intentMode segmentationConfidence templateId stages verification');
    if (value.version !== 1)
        throw Error('intent_contract_version');
    ownDataArrayPrototypeForEach([value.sessionId, value.intentId, value.templateId], identity);
    ownDataArrayPrototypeForEach([value.rawIntent, value.normalizedIntent, value.deliverable, value.finalDeliverable], text);
    ownDataArrayPrototypeForEach([value.providedSourcePaths, value.explicitConstraints, value.delegationBoundary], texts);
    member(value.intentType, intentTypes);
    member(value.riskTier, riskTiers);
    member(value.intentMode, ['single_stage', 'multi_stage']);
    member(value.segmentationConfidence, riskTiers);
    if (!ownDataArrayIsArray(value.stages) || !value.stages.length || (value.intentMode === 'single_stage' ? value.stages.length !== 1 : value.stages.length < 2))
        throw Error('intent_contract_stages');
    const stageIds = createCapturedSet<string>(), globalSteps = createCapturedSet<string>();
    let stageOrder = -1;
    for (const stage of capturedArrayIterator(value.stages)) {
        fields(stage, 'stageId order label intentType deliverable templateId riskTier dependsOnStageIds steps verification');
        identity(stage.stageId);
        identity(stage.templateId);
        if (ownDataSetPrototypeHas(stageIds, stage.stageId))
            throw Error('intent_contract_stage_duplicate');
        order(stage.order, stageOrder);
        stageOrder = stage.order;
        text(stage.label);
        text(stage.deliverable);
        member(stage.intentType, intentTypes);
        member(stage.riskTier, riskTiers);
        dependencies(stage.dependsOnStageIds, stageIds);
        ownDataSetPrototypeAdd(stageIds, stage.stageId);
        if (!ownDataArrayIsArray(stage.steps) || !stage.steps.length)
            throw Error('intent_contract_steps');
        const localSteps = createCapturedSet<string>();
        let stepOrder = -1;
        for (const step of capturedArrayIterator(stage.steps)) {
            fields(step, 'stepId key order role skillName dependsOn riskTier');
            identity(step.stepId);
            identity(step.key);
            if (step.skillName !== null)
                identity(step.skillName);
            if (ownDataSetPrototypeHas(globalSteps, step.stepId))
                throw Error('intent_contract_step_duplicate');
            order(step.order, stepOrder);
            stepOrder = step.order;
            member(step.role, roles);
            member(step.riskTier, riskTiers);
            dependencies(step.dependsOn, localSteps);
            ownDataSetPrototypeAdd(localSteps, step.stepId);
            ownDataSetPrototypeAdd(globalSteps, step.stepId);
        }
        stage.verification = parseGoalVerificationDefinition(stage.verification);
    }
    value.verification = parseGoalVerificationDefinition(value.verification);
    bounded(value);
    return freeze(value) as Readonly<IntentBusinessContract>;
}
export function intentBusinessContractHash(raw: unknown): string {
    return createHash('sha256').update(INTENT_BUSINESS_CONTRACT_HASH_DOMAIN + '\0').update(json(parseIntentBusinessContract(raw))).digest('hex');
}
