import {ownDataArrayIsArray,ownDataArrayPrototypeIncludes,ownDataArrayPrototypeJoin,ownDataArrayPrototypeSort,ownDataBufferByteLength,ownDataFixedAsciiEscape,ownDataJSONParse,ownDataObjectFreeze,ownDataObjectKeys,ownDataRegExpPrototypeTest,ownDataSetPrototypeAdd,ownDataSetPrototypeHas,ownDataStringPrototypeTrim} from '../verification/application-native-intrinsics.js';
import { capturedArrayIterator, capturedArrayMap, createCapturedSet } from '../verification/application-iteration-intrinsics.js';
import { parseIndependentRecipeDefinition, type IndependentRecipeSpec } from '../verification/independent-recipes.js';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
import type { OwnerEnrollmentReview } from '../verification/owner-enrollment-review.js';
export interface GoalVerificationDefinition {
    readonly version: 1;
    readonly obligations: readonly Readonly<{
        obligationId: string;
        predicateId: string;
        predicateVersion: string;
        semantics: 'current-subject' | 'specific-run' | 'cumulative';
        recipe: IndependentRecipeSpec;
    }>[];
}
function fields(value: unknown, keys: readonly string[]): asserts value is Record<string, any> {
    if (!value || typeof value !== 'object' || ownDataArrayIsArray(value)
        || ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort(ownDataObjectKeys(value)), ',') !== ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort([...capturedArrayIterator(keys)]), ','))
        throw Error('goal_verification_definition_shape');
}
function identifier(value: unknown): void {
    if (typeof value !== 'string' || !ownDataStringPrototypeTrim(value) || ownDataStringPrototypeTrim(value) !== value || ownDataBufferByteLength(value) > 160
        || ownDataRegExpPrototypeTest(/[\x00-\x1f\x7f]/, value))
        throw Error('goal_verification_definition_identifier');
}
function registration(value: GoalVerificationDefinition): OwnerEnrollmentReview['registration'] {
    return ownDataObjectFreeze({ migrationEpoch: 1, source: ownDataObjectFreeze({ kind: 'new-owner' as const }),
        obligations: ownDataObjectFreeze(capturedArrayMap(value.obligations, entry => {
            const definition = parseIndependentRecipeDefinition(entry.recipe);
            return ownDataObjectFreeze({ recipe: definition.spec, obligation: ownDataObjectFreeze({ obligationId: entry.obligationId,
                    predicateId: entry.predicateId, predicateVersion: entry.predicateVersion, semantics: entry.semantics,
                    definitionHash: definition.definitionHash, requiredCheckIds: definition.requiredCheckIds }) });
        })) });
}
/** Explicit user criteria only. Parsing neither approves an owner nor proves a
 * result. The assembled native review still applies its own full byte limit. */
export function parseGoalVerificationDefinition(raw: unknown): Readonly<GoalVerificationDefinition> {
    const encoded = json(raw);
    if (ownDataBufferByteLength(encoded) > 65536)
        throw Error('goal_verification_definition_limit');
    const value = ownDataJSONParse(encoded);
    fields(value, ['version', 'obligations']);
    if (value.version !== 1 || !ownDataArrayIsArray(value.obligations) || !value.obligations.length
        || value.obligations.length > 256)
        throw Error('goal_verification_definition_obligations');
    const seen = createCapturedSet<string>();
    const obligations = capturedArrayMap(value.obligations, (entry: unknown) => {
        fields(entry, ['obligationId', 'predicateId', 'predicateVersion', 'semantics', 'recipe']);
        for (const field of capturedArrayIterator([entry.obligationId, entry.predicateId, entry.predicateVersion]))
            identifier(field);
        if (ownDataSetPrototypeHas(seen, entry.obligationId) || !ownDataArrayPrototypeIncludes(['current-subject', 'specific-run', 'cumulative'], entry.semantics)) {
            throw Error('goal_verification_definition_obligations');
        }
        ownDataSetPrototypeAdd(seen, entry.obligationId);
        return ownDataObjectFreeze({ ...entry, recipe: parseIndependentRecipeDefinition(entry.recipe).spec });
    });
    const result = ownDataObjectFreeze({ version: 1 as const, obligations: ownDataObjectFreeze(obligations) }) as Readonly<GoalVerificationDefinition>;
    // Reserve room for actual authority/principal/challenge/session identities.
    // The real native parser is still the final authority over the complete review.
    const reviewBytes = ownDataFixedAsciiEscape(json(registration(result)));
    if (ownDataBufferByteLength(reviewBytes) > 48 * 1024)
        throw Error('goal_verification_definition_limit');
    return result;
}
export function goalVerificationRegistration(raw: unknown): OwnerEnrollmentReview['registration'] {
    return registration(parseGoalVerificationDefinition(raw));
}
/** Replacing the business target cannot weaken or reorder original obligations. */
export function assertGoalVerificationExtension(original: unknown, next: unknown): void {
    const before = parseGoalVerificationDefinition(original), after = parseGoalVerificationDefinition(next);
    if (after.obligations.length < before.obligations.length
        || json(after.obligations.slice(0, before.obligations.length)) !== json(before.obligations))
        throw Error('goal_verification_definition_immutable');
}
