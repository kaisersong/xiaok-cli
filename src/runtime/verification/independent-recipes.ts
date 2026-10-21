import {ownDataArrayIsArray,ownDataArrayPrototypeForEach,ownDataArrayPrototypeIncludes,ownDataArrayPrototypeJoin,ownDataArrayPrototypeSort,ownDataBufferByteLength,ownDataBufferFrom,ownDataBufferPrototypeToString,ownDataCryptoCreateHash,ownDataHashPrototypeDigest,ownDataHashPrototypeUpdate,ownDataJSONParse,ownDataObjectFreeze,ownDataObjectKeys,ownDataObjectValues,ownDataRegExpPrototypeTest,ownDataSetPrototypeAdd,ownDataSetPrototypeHas,ownDataSetPrototypeSizeGetter,ownDataStringPrototypeToLowerCase} from './application-native-intrinsics.js';
import { capturedArrayIterator, capturedArrayMap, createCapturedMap, createCapturedSet, createCapturedWeakMap, createCapturedWeakSet, setFromDenseArray } from './application-iteration-intrinsics.js';
import { createHash, randomUUID } from 'node:crypto';
import type { ProtectedRunScope, ProtectedRunCompletionReceipt, ProtectedRunCompletionAuthority } from './protected-run-types.js';
import { canonicalVerificationJson } from './protocol.js';
import type { PhysicalQuiescenceReceipt, QuiescenceAuthority, QuiescenceExpectation } from '../isolated-execution/physical-quiescence.js';
export interface RecipeBinding {
    attemptId: string;
    subjectId: string;
    runNonce: string;
    expected: QuiescenceExpectation;
}
interface ArtifactCheck {
    id: string;
    path: string;
    sha256: string;
    structure: 'bytes' | 'utf8' | 'json' | 'pdf-signature';
}
interface BlackboxCase {
    id: string;
    inputBase64: string;
    expectedOutputBase64: string;
    sideEffects: readonly {
        path: string;
        sha256: string;
    }[];
}
export interface DiagnosticCoverageSource {
    checkId: string;
    sourceRunId: string;
    runNonce: string;
    archiveHash: string;
    diagnosisPath: string;
    sourceScope?: ProtectedRunScope;
}
export type IndependentRecipeSpec = {
    kind: 'artifact-content';
    checks: readonly ArtifactCheck[];
} | {
    kind: 'blackbox';
    cases: readonly BlackboxCase[];
} | ({
    kind: 'diagnostic-coverage';
} & DiagnosticCoverageSource) | {
    kind: 'diagnostic-coverage';
    sources: readonly DiagnosticCoverageSource[];
};
export interface RecipeEvaluation {
    readonly verifierHash: string;
    readonly checks: readonly Readonly<{
        id: string;
        passed: boolean;
    }>[];
}
export interface VerifiedRecipeArtifacts {
    readonly definitionHash: string;
    readonly binding: RecipeBinding;
    readonly evaluation: RecipeEvaluation;
    readonly artifacts: readonly {
        path: string;
        bytes: Buffer;
    }[];
}
export interface IndependentRecipePlan {
    readonly definitionHash: string;
    readonly requiredCheckIds: readonly string[];
}
export interface BlackboxObservation {
    binding: RecipeBinding;
    caseId: string;
    inputHash: string;
    expected: QuiescenceExpectation;
    receipt: PhysicalQuiescenceReceipt;
    exitCode: number | null;
    outputTruncated: boolean;
    stdout: Buffer;
    sideEffects: Readonly<Record<string, Buffer>>;
}
export type FailedRunObservation = {
    bytes: Buffer;
    exitCode: number | null;
    expected: QuiescenceExpectation;
    receipt: PhysicalQuiescenceReceipt;
    sourceRunId: string;
    runNonce: string;
} | {
    scope: ProtectedRunScope;
    bytes: Buffer;
    exitCode: number | null;
    receipt: ProtectedRunCompletionReceipt;
    sourceRunId: string;
    runNonce: string;
};
const hash = (bytes: Buffer | string) => ownDataHashPrototypeDigest(ownDataHashPrototypeUpdate(ownDataCryptoCreateHash('sha256'), bytes), 'hex');
function freeze<T>(raw: T): T { const json = canonicalVerificationJson(raw); if (ownDataBufferByteLength(json) > 1024 ** 2)
    throw Error('recipe_definition_limit'); const value = ownDataJSONParse(json); const visit = (x: any) => { if (x && typeof x === 'object') {
    ownDataArrayPrototypeForEach(ownDataObjectValues(x), visit);
    ownDataObjectFreeze(x);
} }; visit(value); return value; }
function id(x: unknown): asserts x is string { if (typeof x !== 'string' || !x.length || ownDataBufferByteLength(x) > 160 || ownDataRegExpPrototypeTest(/[\x00-\x1f\x7f]/, x))
    throw Error('recipe_identifier'); }
function digest(x: unknown): asserts x is string { if (typeof x !== 'string' || !ownDataRegExpPrototypeTest(/^[a-f0-9]{64}$/, x))
    throw Error('recipe_hash'); }
function path(x: unknown): asserts x is string { if (typeof x !== 'string' || x.length > 4096)
    throw Error('recipe_path'); let segmentLength = 0, segmentStart = 0; for (let index = 0; index <= x.length; index++) {
    const character = index === x.length ? '/' : x[index]!;
    if (character === '\\' || ownDataRegExpPrototypeTest(/[:\x00-\x1f]/, character))
        throw Error('recipe_path');
    if (character === '/') {
        if (segmentLength === 0 || segmentLength === 1 && x[segmentStart] === '.' || segmentLength === 2 && x[segmentStart] === '.' && x[segmentStart + 1] === '.')
            throw Error('recipe_path');
        segmentLength = 0;
        segmentStart = index + 1;
    }
    else
        segmentLength++;
} }
function keys(value: object, expected: readonly string[]) { if (!value || typeof value !== 'object' || ownDataArrayIsArray(value) || ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort(ownDataObjectKeys(value)), ',') !== ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort([...capturedArrayIterator(expected)]), ','))
    throw Error('recipe_fields'); }
function base64(x: unknown): Buffer { if (typeof x !== 'string' || x.length > 2 * 1024 ** 2)
    throw Error('recipe_input'); const bytes = ownDataBufferFrom(x, 'base64'); if (ownDataBufferPrototypeToString(bytes, 'base64') !== x)
    throw Error('recipe_input'); return bytes; }
function sync(result: unknown) { if (result !== undefined) {
    void Promise.resolve(result).catch(() => { });
    throw Error('recipe_sync_authority');
} }
function bytes(raw: Buffer): Buffer { if (!Buffer.isBuffer(raw) || raw.length > 16 * 1024 ** 2)
    throw Error('recipe_output_limit'); return Buffer.from(raw); }
function dataRecord<T extends object>(raw: T, expected: readonly string[]): T { keys(raw, expected); for (const d of Object.values(Object.getOwnPropertyDescriptors(raw)))
    if (!('value' in d))
        throw Error('recipe_accessor'); return raw; }
function blackboxSnapshot(raw: BlackboxObservation): BlackboxObservation {
    const v = dataRecord(raw, ['binding', 'caseId', 'inputHash', 'expected', 'receipt', 'exitCode', 'outputTruncated', 'stdout', 'sideEffects']);
    const metadata = freeze({ binding: v.binding, caseId: v.caseId, inputHash: v.inputHash, expected: v.expected, exitCode: v.exitCode, outputTruncated: v.outputTruncated });
    const stdout = bytes(v.stdout), receipt = v.receipt, sideEffects: Record<string, Buffer> = Object.create(null);
    if (!v.sideEffects || typeof v.sideEffects !== 'object' || Array.isArray(v.sideEffects))
        throw Error('recipe_side_effects');
    const descriptors = Object.getOwnPropertyDescriptors(v.sideEffects);
    if (Object.keys(descriptors).length > 4096)
        throw Error('recipe_side_effects');
    let total = stdout.length;
    for (const [name, d] of Object.entries(descriptors)) {
        path(name);
        if (!('value' in d))
            throw Error('recipe_accessor');
        const copy = bytes(d.value);
        if ((total += copy.length) > 256 * 1024 ** 2)
            throw Error('recipe_total_limit');
        sideEffects[name] = copy;
    }
    return { ...metadata, receipt, stdout, sideEffects };
}
function failedRunSnapshot(raw: FailedRunObservation): FailedRunObservation {
    if ('scope' in raw) {
        const v = dataRecord(raw, ['scope', 'bytes', 'exitCode', 'receipt', 'sourceRunId', 'runNonce']);
        if (!['protected-execution-run', 'whole-task'].includes(v.scope))
            throw Error('recipe_source_scope');
        return { ...freeze({ scope: v.scope, exitCode: v.exitCode, sourceRunId: v.sourceRunId, runNonce: v.runNonce }), bytes: bytes(v.bytes), receipt: v.receipt };
    }
    const v = dataRecord(raw, ['bytes', 'exitCode', 'expected', 'receipt', 'sourceRunId', 'runNonce']);
    return { ...freeze({ exitCode: v.exitCode, expected: v.expected, sourceRunId: v.sourceRunId, runNonce: v.runNonce }), bytes: bytes(v.bytes), receipt: v.receipt };
}
function structure(kind: ArtifactCheck['structure'], data: Buffer): boolean { try {
    if (kind === 'bytes')
        return true;
    if (kind === 'pdf-signature')
        return data.subarray(0, 5).equals(Buffer.from('%PDF-'));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    if (kind === 'json')
        JSON.parse(text);
    return true;
}
catch {
    return false;
} }
export function parseIndependentRecipeDefinition(raw: IndependentRecipeSpec) {
    const spec = freeze(raw);
    let ids: readonly string[];
    if (spec.kind === 'artifact-content') {
        keys(spec, ['kind', 'checks']);
        if (!ownDataArrayIsArray(spec.checks) || !spec.checks.length || spec.checks.length > 4096)
            throw Error('recipe_checks');
        for (const c of capturedArrayIterator(spec.checks)) {
            keys(c, ['id', 'path', 'sha256', 'structure']);
            id(c.id);
            path(c.path);
            digest(c.sha256);
            if (!ownDataArrayPrototypeIncludes(['bytes', 'utf8', 'json', 'pdf-signature'], c.structure))
                throw Error('recipe_structure');
        }
        ids = capturedArrayMap(spec.checks, x => x.id);
    }
    else if (spec.kind === 'blackbox') {
        keys(spec, ['kind', 'cases']);
        if (!ownDataArrayIsArray(spec.cases) || !spec.cases.length || spec.cases.length > 4096)
            throw Error('recipe_checks');
        for (const c of capturedArrayIterator<BlackboxCase>(spec.cases)) {
            keys(c, ['id', 'inputBase64', 'expectedOutputBase64', 'sideEffects']);
            id(c.id);
            base64(c.inputBase64);
            base64(c.expectedOutputBase64);
            if (!ownDataArrayIsArray(c.sideEffects) || c.sideEffects.length > 4096)
                throw Error('recipe_side_effects');
            const names = createCapturedSet<string>();
            for (const effect of capturedArrayIterator<BlackboxCase["sideEffects"][number]>(c.sideEffects)) {
                keys(effect, ['path', 'sha256']);
                path(effect.path);
                digest(effect.sha256);
                if (ownDataSetPrototypeHas(names, ownDataStringPrototypeToLowerCase(effect.path)))
                    throw Error('recipe_duplicate_path');
                ownDataSetPrototypeAdd(names, ownDataStringPrototypeToLowerCase(effect.path));
            }
        }
        ids = capturedArrayMap(spec.cases, x => x.id);
    }
    else if (spec.kind === 'diagnostic-coverage') {
        const multi = 'sources' in spec;
        keys(spec, multi ? ['kind', 'sources'] : ['kind', 'checkId', 'sourceRunId', 'runNonce', 'archiveHash', 'diagnosisPath', ...('sourceScope' in spec ? ['sourceScope'] : [])]);
        if (multi && (!ownDataArrayIsArray(spec.sources) || spec.sources.length < 2 || spec.sources.length > 4096))
            throw Error('recipe_sources');
        const sources = multi ? spec.sources : [spec], runs = createCapturedSet<string>(), paths = createCapturedSet<string>();
        for (const source of capturedArrayIterator(sources)) {
            if (multi)
                keys(source, ['checkId', 'sourceRunId', 'runNonce', 'archiveHash', 'diagnosisPath', ...('sourceScope' in source ? ['sourceScope'] : [])]);
            if ('sourceScope' in source && !ownDataArrayPrototypeIncludes(['protected-execution-run', 'whole-task'], source.sourceScope!))
                throw Error('recipe_source_scope');
            id(source.checkId);
            id(source.sourceRunId);
            id(source.runNonce);
            digest(source.archiveHash);
            path(source.diagnosisPath);
            const run = canonicalVerificationJson([source.sourceRunId, source.runNonce]), name = ownDataStringPrototypeToLowerCase(source.diagnosisPath);
            if (ownDataSetPrototypeHas(runs, run) || ownDataSetPrototypeHas(paths, name))
                throw Error('recipe_duplicate_source');
            ownDataSetPrototypeAdd(runs, run);
            ownDataSetPrototypeAdd(paths, name);
        }
        ids = capturedArrayMap(sources, source => source.checkId);
    }
    else
        throw Error('recipe_kind');
    if (ownDataSetPrototypeSizeGetter(setFromDenseArray(ids)) !== ids.length)
        throw Error('recipe_duplicate_check');
    return ownDataObjectFreeze({ spec, definitionHash: hash(canonicalVerificationJson(spec)), requiredCheckIds: ownDataObjectFreeze([...capturedArrayIterator(ids)]) });
}
/** Fixed controller-side comparisons, not engine qualification. Its ports must be the
 * protected artifact exporter, fresh-case isolated runner, and original-run archive store.
 * Expected answers/specs are never passed to the target's execution port.
 */
export function createIndependentVerifierRecipes(input: {
    verifierHash: string;
    assertCurrent(binding: RecipeBinding): void;
    quiescence: Pick<QuiescenceAuthority, 'assertQuiescent'>;
    readArtifact(binding: RecipeBinding, path: string, limits?: Readonly<{
        maxBytes: number;
    }>): Promise<Buffer>;
    runBlackbox(request: {
        binding: RecipeBinding;
        caseId: string;
        caseInvocationId: string;
        input: Buffer;
    }): Promise<BlackboxObservation>;
    assertFailedRunComplete: ProtectedRunCompletionAuthority['assertComplete'];
    readFailedRun(request: {
        binding: RecipeBinding;
        sourceRunId: string;
        runNonce: string;
        archiveHash: string;
        sourceScope?: ProtectedRunScope;
        maxBytes?: number;
    }): Promise<FailedRunObservation>;
}) {
    const { verifierHash, assertCurrent, readArtifact, runBlackbox, readFailedRun } = input;
    digest(verifierHash);
    const assertFailedRunComplete = input.assertFailedRunComplete.bind(input);
    const assertQuiescent = input.quiescence.assertQuiescent.bind(input.quiescence), plans = createCapturedWeakMap<object, IndependentRecipeSpec>(), evaluations = createCapturedWeakMap<object, VerifiedRecipeArtifacts>();
    function live(binding: RecipeBinding) { sync(assertCurrent(binding)); }
    function physical(receipt: PhysicalQuiescenceReceipt, expected: QuiescenceExpectation) { sync(assertQuiescent(receipt, expected)); }
    return Object.freeze({
        compile(raw: IndependentRecipeSpec): IndependentRecipePlan {
            const definition = parseIndependentRecipeDefinition(raw), plan = Object.freeze({ definitionHash: definition.definitionHash, requiredCheckIds: definition.requiredCheckIds });
            plans.set(plan, definition.spec);
            return plan;
        },
        async evaluate(plan: IndependentRecipePlan, rawBinding: RecipeBinding): Promise<RecipeEvaluation> {
            const spec = plans.get(plan);
            if (!spec)
                throw Error('recipe_identity');
            const binding = freeze(rawBinding);
            keys(binding, ['attemptId', 'subjectId', 'runNonce', 'expected']);
            [binding.attemptId, binding.subjectId, binding.runNonce].forEach(id);
            keys(binding.expected, ['sessionIdentity', 'compoundOperationId', 'validationInvocationId', 'executionIdentity', 'scopeDigest']);
            Object.values(binding.expected).forEach(id);
            digest(binding.expected.scopeDigest);
            live(binding);
            const checks: {
                id: string;
                passed: boolean;
            }[] = [], artifacts: {
                path: string;
                bytes: Buffer;
            }[] = [];
            if (spec.kind === 'artifact-content') {
                let total = 0;
                for (const check of spec.checks) {
                    live(binding);
                    const data = bytes(await readArtifact(binding, check.path));
                    live(binding);
                    if ((total += data.length) > 256 * 1024 ** 2)
                        throw Error('recipe_total_limit');
                    checks.push({ id: check.id, passed: hash(data) === check.sha256 && structure(check.structure, data) });
                    artifacts.push({ path: check.path, bytes: data });
                }
            }
            else if (spec.kind === 'blackbox') {
                const executions = createCapturedSet<string>(), receipts = createCapturedWeakSet<object>();
                for (const test of spec.cases) {
                    live(binding);
                    const caseInvocationId = randomUUID(), caseInput = base64(test.inputBase64), inputHash = hash(caseInput);
                    const result = blackboxSnapshot(await runBlackbox(Object.freeze({ binding, caseId: test.id, caseInvocationId, input: caseInput })));
                    live(binding);
                    if (result.caseId !== test.id || result.inputHash !== inputHash || result.expected?.sessionIdentity !== binding.expected.sessionIdentity || result.expected?.compoundOperationId !== binding.expected.compoundOperationId || result.expected?.validationInvocationId !== caseInvocationId || canonicalVerificationJson(result.binding) !== canonicalVerificationJson(binding) || !result.expected || !result.receipt || receipts.has(result.receipt) || executions.has(result.expected.executionIdentity))
                        throw Error('recipe_case_binding');
                    physical(result.receipt, result.expected);
                    receipts.add(result.receipt);
                    executions.add(result.expected.executionIdentity);
                    const output = bytes(result.stdout);
                    let passed = result.exitCode === 0 && result.outputTruncated === false && output.equals(base64(test.expectedOutputBase64));
                    if (!result.sideEffects || typeof result.sideEffects !== 'object' || Array.isArray(result.sideEffects))
                        throw Error('recipe_side_effects');
                    if (Object.keys(result.sideEffects).sort().join('\n') !== test.sideEffects.map(x => x.path).sort().join('\n'))
                        passed = false;
                    for (const effect of test.sideEffects) {
                        const data = result.sideEffects[effect.path];
                        if (!Buffer.isBuffer(data) || hash(bytes(data)) !== effect.sha256)
                            passed = false;
                    }
                    live(binding);
                    checks.push({ id: test.id, passed });
                }
            }
            else {
                let total = 0;
                const remaining = () => { const n = Math.min(16 * 1024 ** 2, 256 * 1024 ** 2 - total); if (n <= 0)
                    throw Error('recipe_total_limit'); return n; };
                for (const source of ('sources' in spec ? spec.sources : [spec])) {
                    live(binding);
                    const archiveLimit = remaining();
                    const rawOriginal = await readFailedRun(Object.freeze({ binding, sourceRunId: source.sourceRunId, runNonce: source.runNonce, archiveHash: source.archiveHash, ...(source.sourceScope ? { sourceScope: source.sourceScope } : {}), maxBytes: archiveLimit }));
                    live(binding);
                    if (!Buffer.isBuffer(rawOriginal.bytes) || rawOriginal.bytes.length > archiveLimit)
                        throw Error('recipe_total_limit');
                    const original = failedRunSnapshot(rawOriginal);
                    total += original.bytes.length;
                    const complete = () => { if ('scope' in original) {
                        if (original.scope !== source.sourceScope)
                            throw Error('recipe_source_scope');
                        sync(assertFailedRunComplete(original.receipt, Object.freeze({ sourceRunId: source.sourceRunId, runNonce: source.runNonce, archiveHash: source.archiveHash, scope: source.sourceScope })));
                    }
                    else {
                        if (source.sourceScope)
                            throw Error('recipe_source_scope');
                        physical(original.receipt, original.expected);
                    } };
                    complete();
                    const diagnosisLimit = remaining(), rawDiagnosis = await readArtifact(binding, source.diagnosisPath, Object.freeze({ maxBytes: diagnosisLimit }));
                    live(binding);
                    if (!Buffer.isBuffer(rawDiagnosis) || rawDiagnosis.length > diagnosisLimit)
                        throw Error('recipe_total_limit');
                    const diagnosis = bytes(rawDiagnosis);
                    total += diagnosis.length;
                    const archive = bytes(original.bytes);
                    let passed = original.sourceRunId === source.sourceRunId && original.runNonce === source.runNonce && Number.isSafeInteger(original.exitCode) && original.exitCode !== 0 && hash(archive) === source.archiveHash;
                    if (passed) {
                        try {
                            const text = new TextDecoder('utf-8', { fatal: true }).decode(archive);
                            if (!text.endsWith('\n'))
                                throw Error('truncated');
                            const lines = text.slice(0, -1).split('\n');
                            if (lines.length < 3 || lines.length > 65538)
                                throw Error('records');
                            const parsed = lines.map(x => { const value = JSON.parse(x); if (JSON.stringify(value) !== x)
                                throw Error('noncanonical_record'); return value; });
                            const header = parsed[0], footer = parsed.at(-1);
                            keys(header, ['kind', 'version', 'runId', 'runNonce', 'recordCount']);
                            keys(footer, ['kind', 'recordCount']);
                            if (header.kind !== 'header' || header.version !== 1 || header.runId !== source.sourceRunId || header.runNonce !== source.runNonce || header.recordCount !== parsed.length - 2 || footer.kind !== 'footer' || footer.recordCount !== header.recordCount)
                                throw Error('binding');
                            const errors = createCapturedMap<string, string>();
                            for (let index = 0; index < header.recordCount; index++) {
                                const record = parsed[index + 1];
                                if (record.kind === 'error') {
                                    keys(record, ['kind', 'index', 'errorId', 'message']);
                                    id(record.errorId);
                                    if (errors.has(record.errorId))
                                        throw Error('duplicate');
                                    errors.set(record.errorId, hash(canonicalVerificationJson(record)));
                                }
                                else if (record.kind === 'info') {
                                    keys(record, ['kind', 'index', 'message']);
                                }
                                else
                                    throw Error('record');
                                if (record.index !== index || typeof record.message !== 'string')
                                    throw Error('index');
                            }
                            const candidate = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(diagnosis));
                            keys(candidate, ['diagnosedErrors']);
                            if (!Array.isArray(candidate.diagnosedErrors) || candidate.diagnosedErrors.length > 4096)
                                throw Error('diagnosis');
                            for (const error of candidate.diagnosedErrors) {
                                keys(error, ['errorId', 'recordHash']);
                                id(error.errorId);
                                digest(error.recordHash);
                            }
                            if (setFromDenseArray(candidate.diagnosedErrors.map((e: {
                                errorId: string;
                            }) => e.errorId)).size !== candidate.diagnosedErrors.length)
                                throw Error('duplicate_diagnosis');
                            passed = errors.size > 0 && errors.size === candidate.diagnosedErrors.length && candidate.diagnosedErrors.every((e: {
                                errorId: string;
                                recordHash: string;
                            }) => errors.get(e.errorId) === e.recordHash);
                        }
                        catch {
                            passed = false;
                        }
                    }
                    live(binding);
                    complete();
                    checks.push({ id: source.checkId, passed });
                    artifacts.push({ path: source.diagnosisPath, bytes: diagnosis });
                }
            }
            const result = freeze({ verifierHash, checks });
            if (spec.kind === 'blackbox')
                artifacts.push({ path: 'verification-report.json', bytes: Buffer.from(canonicalVerificationJson({ version: 1, kind: 'blackbox', definitionHash: plan.definitionHash, binding, evaluation: result })) });
            live(binding);
            evaluations.set(result, { definitionHash: plan.definitionHash, binding, evaluation: result, artifacts });
            return result;
        },
        /** Private host port. A serialized verdict never authorizes publication. */
        exportVerifiedArtifacts(evaluation: RecipeEvaluation): VerifiedRecipeArtifacts {
            const record = evaluations.get(evaluation);
            if (!record)
                throw Error('recipe_evaluation_identity');
            if (!record.evaluation.checks.length || record.evaluation.checks.some(c => !c.passed))
                throw Error('recipe_evaluation_failed');
            live(record.binding);
            return Object.freeze({ ...record, artifacts: Object.freeze(record.artifacts.map(a => Object.freeze({ path: a.path, bytes: Buffer.from(a.bytes) }))) });
        },
    });
}
