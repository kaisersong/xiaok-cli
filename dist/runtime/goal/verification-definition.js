import { parseIndependentRecipeDefinition } from '../verification/independent-recipes.js';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
function fields(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
        throw Error('goal_verification_definition_shape');
}
function identifier(value) {
    if (typeof value !== 'string' || !value.trim() || value.trim() !== value || Buffer.byteLength(value) > 160
        || /[\x00-\x1f\x7f]/.test(value))
        throw Error('goal_verification_definition_identifier');
}
function registration(value) {
    return Object.freeze({ migrationEpoch: 1, source: Object.freeze({ kind: 'new-owner' }),
        obligations: Object.freeze(value.obligations.map(entry => {
            const definition = parseIndependentRecipeDefinition(entry.recipe);
            return Object.freeze({ recipe: definition.spec, obligation: Object.freeze({ obligationId: entry.obligationId,
                    predicateId: entry.predicateId, predicateVersion: entry.predicateVersion, semantics: entry.semantics,
                    definitionHash: definition.definitionHash, requiredCheckIds: definition.requiredCheckIds }) });
        })) });
}
/** Explicit user criteria only. Parsing neither approves an owner nor proves a
 * result. The assembled native review still applies its own full byte limit. */
export function parseGoalVerificationDefinition(raw) {
    const encoded = json(raw);
    if (Buffer.byteLength(encoded) > 65536)
        throw Error('goal_verification_definition_limit');
    const value = JSON.parse(encoded);
    fields(value, ['version', 'obligations']);
    if (value.version !== 1 || !Array.isArray(value.obligations) || !value.obligations.length
        || value.obligations.length > 256)
        throw Error('goal_verification_definition_obligations');
    const seen = new Set();
    const obligations = value.obligations.map((entry) => {
        fields(entry, ['obligationId', 'predicateId', 'predicateVersion', 'semantics', 'recipe']);
        [entry.obligationId, entry.predicateId, entry.predicateVersion].forEach(identifier);
        if (seen.has(entry.obligationId) || !['current-subject', 'specific-run', 'cumulative'].includes(entry.semantics)) {
            throw Error('goal_verification_definition_obligations');
        }
        seen.add(entry.obligationId);
        return Object.freeze({ ...entry, recipe: parseIndependentRecipeDefinition(entry.recipe).spec });
    });
    const result = Object.freeze({ version: 1, obligations: Object.freeze(obligations) });
    // Reserve room for actual authority/principal/challenge/session identities.
    // The real native parser is still the final authority over the complete review.
    const reviewBytes = json(registration(result)).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    if (Buffer.byteLength(reviewBytes) > 48 * 1024)
        throw Error('goal_verification_definition_limit');
    return result;
}
export function goalVerificationRegistration(raw) {
    return registration(parseGoalVerificationDefinition(raw));
}
/** Replacing the business target cannot weaken or reorder original obligations. */
export function assertGoalVerificationExtension(original, next) {
    const before = parseGoalVerificationDefinition(original), after = parseGoalVerificationDefinition(next);
    if (after.obligations.length < before.obligations.length
        || json(after.obligations.slice(0, before.obligations.length)) !== json(before.obligations))
        throw Error('goal_verification_definition_immutable');
}
