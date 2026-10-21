import { z } from 'zod';

const text = z.string(), number = z.number().finite();
const scope = z.enum(['protected-execution-run', 'whole-task']);
const diagnosticSource = { checkId: text, sourceRunId: text, runNonce: text, archiveHash: text,
  diagnosisPath: text, sourceScope: scope.optional() };
const recipe = z.union([
  z.object({ kind: z.literal('artifact-content'), checks: z.array(z.object({ id: text, path: text,
    sha256: text, structure: z.enum(['bytes', 'utf8', 'json', 'pdf-signature']) }).strict()) }).strict(),
  z.object({ kind: z.literal('blackbox'), cases: z.array(z.object({ id: text, inputBase64: text,
    expectedOutputBase64: text, sideEffects: z.array(z.object({ path: text, sha256: text }).strict()) }).strict()) }).strict(),
  z.object({ kind: z.literal('diagnostic-coverage'), ...diagnosticSource }).strict(),
  z.object({ kind: z.literal('diagnostic-coverage'), sources: z.array(z.object(diagnosticSource).strict()) }).strict(),
]);
const definition = z.object({ version: z.literal(1), obligations: z.array(z.object({
  obligationId: text, predicateId: text, predicateVersion: text,
  semantics: z.enum(['current-subject', 'specific-run', 'cumulative']), recipe,
}).strict()) }).strict();
/** Shape only. Existing native/config parsers retain all business byte limits. */
export const LOOP_PUBLICATION_CONFIGURATION_SCHEMA = z.union([
  z.object({ version: z.literal(1), contract: z.object({ kind: z.literal('builtin-diagnostic'),
    scanner: z.enum(['artifact-evidence-regression', 'kswarm-service-health']), objective: text, completionCriterion: text }).strict(),
    verificationDefinitions: z.object({ run: definition, stages: z.object({ scan: definition }).strict() }).strict() }).strict(),
  z.object({ version: z.literal(1), contract: z.object({ kind: z.literal('assistant'), assistantKind: z.enum(['evening', 'morning']),
    objective: text, completionCriterion: text }).strict(),
    verificationDefinitions: z.object({ run: definition, stages: z.object({}).strict() }).strict() }).strict(),
  z.object({ version: z.literal(1), contract: z.object({ kind: z.literal('user-template') }).strict(),
    verificationDefinitions: z.object({ run: definition, stages: z.object({ execute: definition, verify: definition }).strict() }).strict() }).strict(),
]);
const command = z.object({ argv: z.array(text), cwdRelative: text }).strict();
export const LOOP_PUBLICATION_ACTION_SCHEMA = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('saveConfiguration'), loopId: text, expectedRevision: number.nullable(), configuration: LOOP_PUBLICATION_CONFIGURATION_SCHEMA }).strict(),
  z.object({ kind: z.literal('reserveNative'), candidateId: text, expectedLatestAttemptId: text.nullable() }).strict(),
  z.object({ kind: z.literal('reauthorizeNative'), attemptId: text, expectedRevision: number }).strict(),
  z.object({ kind: z.literal('advanceNative'), attemptId: text }).strict(),
  z.object({ kind: z.literal('recoverNative'), attemptId: text }).strict(),
  z.object({ kind: z.literal('prepareSession'), nativeAttemptId: text, obligationId: text }).strict(),
  z.object({ kind: z.literal('recoverSession'), id: text }).strict(),
  z.object({ kind: z.literal('enrollSession'), id: text }).strict(),
  z.object({ kind: z.literal('recoverEnrollment'), id: text }).strict(),
  z.object({ kind: z.literal('verify'), id: text, exactCommand: command, expiresAt: number }).strict(),
  z.object({ kind: z.literal('recoverVerification'), id: text }).strict(),
  z.object({ kind: z.literal('publish'), nativeAttemptId: text, expectedLatestAttemptId: text.nullable() }).strict(),
  z.object({ kind: z.literal('recoverPublication'), attemptId: text }).strict(),
  z.object({ kind: z.literal('project'), runId: text }).strict(),
  z.object({ kind: z.literal('inspect'), runId: text }).strict(),
]);
const kind = z.enum(['saveConfiguration', 'reserveNative', 'reauthorizeNative', 'advanceNative', 'recoverNative',
  'prepareSession', 'recoverSession', 'enrollSession', 'recoverEnrollment', 'verify', 'recoverVerification', 'publish',
  'recoverPublication', 'project', 'inspect']);
export const LOOP_PUBLICATION_ACTION_RESULT_SCHEMA = z.object({ kind, recordId: text.optional(), phase: text.optional(),
  generation: number.optional(), inspection: z.object({ runId: text, checkedAt: number }).strict().optional(),
}).strict().refine(value => value.kind !== 'inspect' || value.inspection !== undefined);
export const STORED_LOOP_PUBLICATION_CONFIGURATION_SCHEMA = z.object({ loopId: text, revision: number,
  configuration: LOOP_PUBLICATION_CONFIGURATION_SCHEMA, createdAt: number, updatedAt: number }).strict();
export const LOOP_PUBLICATION_STATE_SCHEMA = z.object({ historyOnly: z.literal(true), runId: text, loopId: text,
  businessState: text, workspaceRoot: text, projection: z.object({ generation: number, generationHash: text }).strict().nullable(),
  candidates: z.array(z.object({ candidateId: text, stageKind: text.nullable(), definition,
    natives: z.array(z.object({ id: text, kind: z.enum(['enrollment-and-application', 'application-reauthorization']),
      revision: number, phase: text, sessions: z.array(z.object({ id: text, obligationId: text, phase: text,
        executions: z.array(z.object({ id: text, phase: text, exactCommand: command, expiresAt: number }).strict()),
      }).strict()),
    }).strict()),
    publications: z.array(z.object({ id: text, nativeAttemptId: text, status: text }).strict()),
  }).strict()),
}).strict();
/** Public criteria/state stay immutable like the original stored native definitions. */
type ImmutableDto<T> = T extends readonly (infer E)[] ? readonly ImmutableDto<E>[]
  : T extends object ? { readonly [K in keyof T]: ImmutableDto<T[K]> } : T;
export type LoopPublicationActionDto = ImmutableDto<z.infer<typeof LOOP_PUBLICATION_ACTION_SCHEMA>>;
export type LoopPublicationActionResultDto = ImmutableDto<z.infer<typeof LOOP_PUBLICATION_ACTION_RESULT_SCHEMA>>;
export type LoopPublicationStateDto = ImmutableDto<z.infer<typeof LOOP_PUBLICATION_STATE_SCHEMA>>;
export type StoredLoopPublicationConfigurationDto = ImmutableDto<z.infer<typeof STORED_LOOP_PUBLICATION_CONFIGURATION_SCHEMA>>;
