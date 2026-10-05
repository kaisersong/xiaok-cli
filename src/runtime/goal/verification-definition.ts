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
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw Error('goal_verification_definition_shape');
}
function identifier(value: unknown): void {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value || Buffer.byteLength(value) > 160
    || /[\x00-\x1f\x7f]/.test(value)) throw Error('goal_verification_definition_identifier');
}
function registration(value: GoalVerificationDefinition): OwnerEnrollmentReview['registration'] {
  return Object.freeze({ migrationEpoch: 1, source: Object.freeze({ kind: 'new-owner' as const }),
    obligations: Object.freeze(value.obligations.map(entry => {
      const definition = parseIndependentRecipeDefinition(entry.recipe);
      return Object.freeze({ recipe: definition.spec, obligation: Object.freeze({ obligationId: entry.obligationId,
        predicateId: entry.predicateId, predicateVersion: entry.predicateVersion, semantics: entry.semantics,
        definitionHash: definition.definitionHash, requiredCheckIds: definition.requiredCheckIds }) });
    })) });
}

/** Explicit user criteria only. Parsing neither approves an owner nor proves a
 * result. The assembled native review still applies its own full byte limit. */
export function parseGoalVerificationDefinition(raw: unknown): Readonly<GoalVerificationDefinition> {
  const encoded = json(raw);
  if (Buffer.byteLength(encoded) > 65536) throw Error('goal_verification_definition_limit');
  const value = JSON.parse(encoded);
  fields(value, ['version', 'obligations']);
  if (value.version !== 1 || !Array.isArray(value.obligations) || !value.obligations.length
    || value.obligations.length > 256) throw Error('goal_verification_definition_obligations');
  const seen = new Set<string>();
  const obligations = value.obligations.map((entry: unknown) => {
    fields(entry, ['obligationId', 'predicateId', 'predicateVersion', 'semantics', 'recipe']);
    [entry.obligationId, entry.predicateId, entry.predicateVersion].forEach(identifier);
    if (seen.has(entry.obligationId) || !['current-subject', 'specific-run', 'cumulative'].includes(entry.semantics)) {
      throw Error('goal_verification_definition_obligations');
    }
    seen.add(entry.obligationId);
    return Object.freeze({ ...entry, recipe: parseIndependentRecipeDefinition(entry.recipe).spec });
  });
  const result = Object.freeze({ version: 1 as const, obligations: Object.freeze(obligations) }) as Readonly<GoalVerificationDefinition>;
  // Reserve room for actual authority/principal/challenge/session identities.
  // The real native parser is still the final authority over the complete review.
  const reviewBytes = json(registration(result)).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  if (Buffer.byteLength(reviewBytes) > 48 * 1024) throw Error('goal_verification_definition_limit');
  return result;
}

export function goalVerificationRegistration(raw: unknown): OwnerEnrollmentReview['registration'] {
  return registration(parseGoalVerificationDefinition(raw));
}

/** Replacing the business target cannot weaken or reorder original obligations. */
export function assertGoalVerificationExtension(original: unknown, next: unknown): void {
  const before = parseGoalVerificationDefinition(original), after = parseGoalVerificationDefinition(next);
  if (after.obligations.length < before.obligations.length
    || json(after.obligations.slice(0, before.obligations.length)) !== json(before.obligations)) throw Error('goal_verification_definition_immutable');
}
