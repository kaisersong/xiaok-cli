import { ownDataArrayIsArray, ownDataArrayPrototypeForEach, ownDataArrayPrototypeIncludes, ownDataArrayPrototypeJoin, ownDataArrayPrototypeSome, ownDataArrayPrototypeSort, ownDataBufferByteLength, ownDataCryptoCreateHash, ownDataHashPrototypeDigest, ownDataHashPrototypeUpdate, ownDataJSONParse, ownDataObjectFreeze, ownDataObjectKeys, ownDataObjectValues, ownDataStringPrototypeTrim } from './application-native-intrinsics.js';
import { parseLoopContractV1, type LoopContractV1 } from '../loop/contract.js';
import { createHash } from 'node:crypto';
import { canonicalVerificationJson as json } from './protocol.js';
import { readApplicationOwnDataField } from './application-value-data.js';
import { captureApplicationData } from './application-value-data.js';
function boundedCapture(raw: unknown): unknown { return captureApplicationData(raw, { maximumBytes: 65536, maximumNodes: 65536, invalid: 'loop_contract_shape', limit: 'loop_contract_limit' }); }
function freeze<T>(value: T): T {
    if (value && typeof value === 'object') {
        ownDataArrayPrototypeForEach(ownDataObjectValues(value), freeze);
        ownDataObjectFreeze(value);
    }
    return value;
}
/** Exact business description for native review. It grants no command, material
 * access or verification proof; legacy weak criteria stay weak. The ordinary
 * Desktop path continues to use the same underlying parser without this gate. */
export function parseStrictLoopContractV1(raw: unknown): Readonly<LoopContractV1> {
    const encoded = json(boundedCapture(raw));
    if (ownDataBufferByteLength(encoded) > 65536)
        throw Error('loop_contract_limit');
    const captured: unknown = ownDataJSONParse(encoded);
    const parsed = parseLoopContractV1(captured, { registeredCriteria: ['task_completed', 'file_exists', 'command_exit_zero'] });
    // The legacy parser normalizes optional fields and ignores some nested extras.
    // A signed contract cannot silently lose any of its reviewed fields.
    if (json(parsed) !== encoded)
        throw Error('loop_contract_noncanonical');
    return freeze(parsed);
}
export const LOOP_DIAGNOSTIC_SCANNERS = ['artifact-evidence-regression', 'kswarm-service-health'] as const;
const privateLOOP_DIAGNOSTIC_SCANNERS = ownDataObjectFreeze([...LOOP_DIAGNOSTIC_SCANNERS]);
export const LOOP_ASSISTANT_DATA_SCOPES = ['threads', 'projects', 'tasks', 'artifacts', 'automations', 'meetings'] as const;
const privateLOOP_ASSISTANT_DATA_SCOPES = ownDataObjectFreeze([...LOOP_ASSISTANT_DATA_SCOPES]);
export type LoopBusinessContract = {
    version: 1;
    kind: 'builtin-diagnostic';
    scanner: typeof LOOP_DIAGNOSTIC_SCANNERS[number];
    objective: string;
    completionCriterion: string;
} | {
    version: 1;
    kind: 'user-template';
    templateKind: 'markdown_file' | 'task_completion';
    prompt: string;
    outputDirectory: string;
    outputFileName: string;
    loopContract: Readonly<LoopContractV1>;
} | {
    version: 1;
    kind: 'assistant';
    assistantKind: 'evening' | 'morning';
    profileId: 'default-personal-assistant';
    locale: 'zh' | 'en';
    timeZone: string;
    dataScopes: readonly (typeof LOOP_ASSISTANT_DATA_SCOPES[number])[];
    objective: string;
    completionCriterion: string;
};
function shape(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || ownDataArrayIsArray(value) || ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort(ownDataObjectKeys(value)), ',') !== ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort(keys), ','))
        throw Error('loop_contract_shape');
}
function text(value: unknown, allowEmpty = false): asserts value is string {
    if (typeof value !== 'string' || (!allowEmpty && !ownDataStringPrototypeTrim(value)))
        throw Error('loop_contract_text');
}
/** Complete producer business description only. Explicit recipes, OS permissions
 * and native approval are separate authorities. This parser never invents them.
 * The final native review also checks its whole ASCII-safe envelope size. */
export function parseLoopBusinessContract(raw: unknown): Readonly<LoopBusinessContract> {
    const encoded = json(boundedCapture(raw));
    if (ownDataBufferByteLength(encoded) > 65536)
        throw Error('loop_contract_limit');
    const captured: unknown = ownDataJSONParse(encoded);
    if (!captured || typeof captured !== 'object' || ownDataArrayIsArray(captured))
        throw Error('loop_contract_shape');
    const kind = readApplicationOwnDataField(captured, 'kind', 'loop_contract_shape');
    if (kind.kind !== 'data')
        throw Error('loop_contract_shape');
    const value = captured as Record<string, unknown>;
    if (kind.value === 'builtin-diagnostic') {
        shape(value, ['version', 'kind', 'scanner', 'objective', 'completionCriterion']);
        if (!ownDataArrayPrototypeIncludes(privateLOOP_DIAGNOSTIC_SCANNERS, value.scanner as never))
            throw Error('loop_contract_scanner');
        text(value.objective);
        text(value.completionCriterion);
    }
    else if (kind.value === 'user-template') {
        shape(value, ['version', 'kind', 'templateKind', 'prompt', 'outputDirectory', 'outputFileName', 'loopContract']);
        if (value.templateKind !== 'markdown_file' && value.templateKind !== 'task_completion')
            throw Error('loop_contract_template');
        text(value.prompt);
        text(value.outputDirectory, true);
        text(value.outputFileName, true);
        value.loopContract = parseStrictLoopContractV1(value.loopContract);
    }
    else if (kind.value === 'assistant') {
        shape(value, ['version', 'kind', 'assistantKind', 'profileId', 'locale', 'timeZone', 'dataScopes', 'objective', 'completionCriterion']);
        if (!ownDataArrayPrototypeIncludes(['evening', 'morning'], value.assistantKind as string) || value.profileId !== 'default-personal-assistant'
            || !ownDataArrayPrototypeIncludes(['zh', 'en'], value.locale as string))
            throw Error('loop_contract_assistant');
        text(value.timeZone);
        text(value.objective);
        text(value.completionCriterion);
        if (!ownDataArrayIsArray(value.dataScopes) || ownDataArrayPrototypeSome(value.dataScopes, v => !ownDataArrayPrototypeIncludes(privateLOOP_ASSISTANT_DATA_SCOPES, v as never)))
            throw Error('loop_contract_data_scopes');
        // Preserve exact scope order and multiplicity from the stored profile. This
        // snapshot describes the candidate; it is not a current permission grant.
    }
    else
        throw Error('loop_contract_kind');
    if (value.version !== 1)
        throw Error('loop_contract_version');
    return freeze(value) as Readonly<LoopBusinessContract>;
}
export function loopBusinessContractHash(raw: unknown): string {
    return ownDataHashPrototypeDigest(ownDataHashPrototypeUpdate(ownDataHashPrototypeUpdate(ownDataCryptoCreateHash('sha256'), 'xiaok-loop-business-contract-v1\0'), json(parseLoopBusinessContract(raw))), 'hex');
}
