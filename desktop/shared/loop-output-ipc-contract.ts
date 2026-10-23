import { z } from 'zod';

const text = z.string(), number = z.number().finite();
const owner = z.object({ profileId: text, ownerKind: z.enum(['task', 'intent', 'goal', 'loop', 'project']), ownerId: text }).strict();
const selection = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local'), obligationId: text, path: text }).strict(),
  z.object({ kind: z.literal('inherited'), obligationId: text, path: text,
    originOwner: owner, originalObligationId: text }).strict(),
]);
const identity = z.object({ runId: text, candidateId: text, candidateRevision: number, payloadHash: text }).strict();
const origin = z.enum(['verified_publication', 'workspace_navigation']);
const base = { loopId: text };
const previewFields = { runId: text.optional(), pathLabel: text.optional(), content: text.optional(),
  sizeBytes: number.optional(), limitBytes: number.optional(), truncated: z.boolean().optional(),
  origin: origin.optional(), checkedAt: number.optional(), message: text.optional() };
const taskFields = { runId: text.optional(), taskId: text.optional(), content: text.optional(),
  origin: origin.optional(), checkedAt: number.optional(), message: text.optional() };
const openFields = { pathLabel: text.optional(), origin: origin.optional(), message: text.optional() };

/** Full observations only; page identities and selectors confer no authority. */
export const LOOP_OUTPUT_SCHEMAS = Object.freeze({
  listPublishedArtifacts: z.object({ identity, offset: number, total: number, nextOffset: number.nullable(),
    items: z.array(z.object({ selection, path: text, sha256: text, size: number }).strict()),
    loopId: text, checkedAt: number }).strict(),
  readOutputPreview: z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), ...base, ...previewFields,
      pathLabel: text, content: text, sizeBytes: number, truncated: z.boolean() }).strict(),
    z.object({ ok: z.literal(false), ...base, ...previewFields, error: text }).strict(),
  ]),
  readTaskResult: z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), ...base, ...taskFields, runId: text, content: text }).strict(),
    z.object({ ok: z.literal(false), ...base, ...taskFields, error: text }).strict(),
  ]),
  openOutputDirectory: z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), ...base, ...openFields, pathLabel: text }).strict(),
    z.object({ ok: z.literal(false), ...base, ...openFields, error: text }).strict(),
  ]),
});
export type LoopOutputMethod = keyof typeof LOOP_OUTPUT_SCHEMAS;

export type LoopOutputActionResultView = z.infer<typeof LOOP_OUTPUT_SCHEMAS.openOutputDirectory>;
export type LoopOutputPreviewView = z.infer<typeof LOOP_OUTPUT_SCHEMAS.readOutputPreview>;
export type LoopTaskResultView = z.infer<typeof LOOP_OUTPUT_SCHEMAS.readTaskResult>;
export type LoopPublishedArtifactsView = z.infer<typeof LOOP_OUTPUT_SCHEMAS.listPublishedArtifacts>;
