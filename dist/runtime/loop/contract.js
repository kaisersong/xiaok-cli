import { ownDataCapturedDiagnosticString, ownDataArrayIsArray, ownDataArrayPrototypeEvery, ownDataArrayPrototypeFilter, ownDataArrayPrototypeForEach, ownDataArrayPrototypeIncludes, ownDataArrayPrototypeMap, ownDataNumber, ownDataNumberIsFinite, ownDataObjectEntries, ownDataObjectFromEntries, ownDataObjectKeys, ownDataRegExpPrototypeTest, ownDataSetPrototypeHas, ownDataStringPrototypeTrim } from '../verification/application-native-intrinsics.js';
import { capturedArrayIterator, setFromDenseArray } from '../verification/application-iteration-intrinsics.js';
const LOOP_CONTRACT_FIELDS = setFromDenseArray([
    'schemaVersion',
    'objective',
    'triggerPolicy',
    'successCriteria',
    'stopPolicy',
    'permissionPolicy',
    'concurrencyPolicy',
    'legacyPolicy',
]);
const UNSAFE_COMMAND_ARG_PATTERN = /[\0\r\n;&|<>`$"'\\]/;
export function parseLoopContractV1(raw, options) {
    const record = asRecord(raw, 'LoopContract');
    for (const key of capturedArrayIterator(ownDataObjectKeys(record))) {
        if (!ownDataSetPrototypeHas(LOOP_CONTRACT_FIELDS, key))
            throw new Error(`Unknown LoopContract field: ${key}`);
    }
    if (record.schemaVersion !== 'loop_contract_v1') {
        throw new Error(`Unsupported LoopContract schemaVersion: ${ownDataCapturedDiagnosticString(record.schemaVersion)}`);
    }
    const objective = readNonEmptyString(record.objective, 'LoopContract objective');
    const triggerPolicy = parseTriggerPolicy(record.triggerPolicy);
    const successCriteria = parseSuccessCriteria(record.successCriteria, options);
    const stopPolicy = parseStopPolicy(record.stopPolicy);
    const permissionPolicy = parsePermissionPolicy(record.permissionPolicy);
    const concurrencyPolicy = parseConcurrencyPolicy(record.concurrencyPolicy);
    const legacyPolicy = record.legacyPolicy === undefined
        ? undefined
        : parseLegacyPolicy(record.legacyPolicy);
    const parsed = {
        schemaVersion: 'loop_contract_v1',
        objective,
        triggerPolicy,
        successCriteria,
        stopPolicy,
        permissionPolicy,
        concurrencyPolicy,
    };
    if (legacyPolicy)
        parsed.legacyPolicy = legacyPolicy;
    return parsed;
}
export function isWeakOnlyBackgroundContract(contract) {
    if (!contract)
        return false;
    const hasStrongCriterion = contract.successCriteria.some(criterion => criterion.kind !== 'task_completed' || criterion.strength === 'strong');
    return !hasStrongCriterion && contract.legacyPolicy?.requiresHumanApprovalBeforeBackgroundSuccess === true;
}
function parseTriggerPolicy(raw) {
    const record = asRecord(raw, 'LoopContract triggerPolicy');
    if (record.kind !== 'manual')
        throw new Error(`Unsupported LoopContract triggerPolicy kind: ${ownDataCapturedDiagnosticString(record.kind)}`);
    return { kind: 'manual' };
}
function parseSuccessCriteria(raw, options) {
    if (!ownDataArrayIsArray(raw))
        throw new Error('LoopContract successCriteria must be an array.');
    if (raw.length === 0)
        throw new Error('LoopContract successCriteria must not be empty.');
    const registered = setFromDenseArray(options.registeredCriteria);
    return ownDataArrayPrototypeMap(raw, (criterion, index) => {
        const record = asRecord(criterion, `LoopContract successCriteria[${index}]`);
        const kind = readNonEmptyString(record.kind, `LoopContract successCriteria[${index}].kind`);
        if (!ownDataSetPrototypeHas(registered, kind))
            throw new Error(`Unsupported LoopContract success criterion: ${kind}`);
        if (kind === 'task_completed') {
            if (record.strength !== 'weak' && record.strength !== 'strong') {
                throw new Error(`LoopContract task_completed strength is unsupported: ${ownDataCapturedDiagnosticString(record.strength)}`);
            }
            return { kind, strength: record.strength };
        }
        if (kind === 'file_exists') {
            const parsed = {
                kind,
                pathTemplate: readNonEmptyString(record.pathTemplate, 'LoopContract file_exists pathTemplate'),
            };
            if (record.minBytes !== undefined)
                parsed.minBytes = readNonNegativeNumber(record.minBytes, 'LoopContract file_exists minBytes');
            if (record.expectedMime !== undefined)
                parsed.expectedMime = readNonEmptyString(record.expectedMime, 'LoopContract file_exists expectedMime');
            return parsed;
        }
        if (kind === 'command_exit_zero') {
            const args = readStringArray(record.args, 'LoopContract command_exit_zero args');
            ownDataArrayPrototypeForEach(args, (arg, argIndex) => {
                if (ownDataRegExpPrototypeTest(UNSAFE_COMMAND_ARG_PATTERN, arg)) {
                    throw new Error(`LoopContract command_exit_zero arg ${argIndex} is unsafe.`);
                }
            });
            if (record.cwdPolicy !== 'workspace' && record.cwdPolicy !== 'output_dir') {
                throw new Error(`LoopContract command_exit_zero cwdPolicy is unsupported: ${ownDataCapturedDiagnosticString(record.cwdPolicy)}`);
            }
            return {
                kind,
                commandId: readNonEmptyString(record.commandId, 'LoopContract command_exit_zero commandId'),
                args,
                cwdPolicy: record.cwdPolicy,
            };
        }
        throw new Error(`Unsupported LoopContract success criterion: ${kind}`);
    });
}
function parseStopPolicy(raw) {
    const record = asRecord(raw, 'LoopContract stopPolicy');
    const parsed = {};
    if (record.maxConsecutiveFailures !== undefined) {
        parsed.maxConsecutiveFailures = readNonNegativeNumber(record.maxConsecutiveFailures, 'LoopContract stopPolicy maxConsecutiveFailures');
    }
    return parsed;
}
function parsePermissionPolicy(raw) {
    const record = asRecord(raw, 'LoopContract permissionPolicy');
    if (typeof record.mode !== 'string' || !ownDataArrayPrototypeIncludes(['read_only', 'workspace_write', 'project_mutation', 'external_side_effect'], record.mode)) {
        throw new Error(`Unsupported LoopContract permission mode: ${ownDataCapturedDiagnosticString(record.mode)}`);
    }
    if (typeof record.autoRunApproved !== 'boolean')
        throw new Error('LoopContract permissionPolicy autoRunApproved must be boolean.');
    return stripUndefined({
        mode: record.mode,
        autoRunApproved: record.autoRunApproved,
        allowedToolCategories: readStringArray(record.allowedToolCategories, 'LoopContract permissionPolicy allowedToolCategories'),
        approvedTargetRefs: record.approvedTargetRefs === undefined
            ? undefined
            : readStringArray(record.approvedTargetRefs, 'LoopContract permissionPolicy approvedTargetRefs'),
    });
}
function parseConcurrencyPolicy(raw) {
    const record = asRecord(raw, 'LoopContract concurrencyPolicy');
    if (typeof record.perLoop !== 'string' || !ownDataArrayPrototypeIncludes(['skip_if_running', 'queue_latest', 'cancel_previous', 'parallel'], record.perLoop)) {
        throw new Error(`Unsupported LoopContract concurrency perLoop: ${ownDataCapturedDiagnosticString(record.perLoop)}`);
    }
    if (typeof record.coalesceMissedRuns !== 'boolean')
        throw new Error('LoopContract concurrencyPolicy coalesceMissedRuns must be boolean.');
    return {
        perLoop: record.perLoop,
        coalesceMissedRuns: record.coalesceMissedRuns,
    };
}
function parseLegacyPolicy(raw) {
    const record = asRecord(raw, 'LoopContract legacyPolicy');
    return stripUndefined({
        requiresHumanApprovalBeforeBackgroundSuccess: record.requiresHumanApprovalBeforeBackgroundSuccess === undefined
            ? undefined
            : readBoolean(record.requiresHumanApprovalBeforeBackgroundSuccess, 'LoopContract legacyPolicy requiresHumanApprovalBeforeBackgroundSuccess'),
        legacyWeakModeAuditRef: record.legacyWeakModeAuditRef === undefined
            ? undefined
            : readNonEmptyString(record.legacyWeakModeAuditRef, 'LoopContract legacyPolicy legacyWeakModeAuditRef'),
        grandfatheredOutputTargetRefs: record.grandfatheredOutputTargetRefs === undefined
            ? undefined
            : readStringArray(record.grandfatheredOutputTargetRefs, 'LoopContract legacyPolicy grandfatheredOutputTargetRefs'),
    });
}
function asRecord(raw, label) {
    if (!raw || typeof raw !== 'object' || ownDataArrayIsArray(raw))
        throw new Error(`${label} must be an object.`);
    return raw;
}
function readNonEmptyString(value, label) {
    if (typeof value !== 'string' || ownDataStringPrototypeTrim(value) === '')
        throw new Error(`${label} must be a non-empty string.`);
    return value;
}
function readStringArray(value, label) {
    if (!ownDataArrayIsArray(value) || !ownDataArrayPrototypeEvery(value, item => typeof item === 'string')) {
        throw new Error(`${label} must be a string array.`);
    }
    return [...value];
}
function readNonNegativeNumber(value, label) {
    if (!ownDataNumberIsFinite(value) || ownDataNumber(value) < 0)
        throw new Error(`${label} must be a non-negative number.`);
    return ownDataNumber(value);
}
function readBoolean(value, label) {
    if (typeof value !== 'boolean')
        throw new Error(`${label} must be boolean.`);
    return value;
}
function stripUndefined(record) {
    return ownDataObjectFromEntries(ownDataArrayPrototypeFilter(ownDataObjectEntries(record), ([, value]) => value !== undefined));
}
