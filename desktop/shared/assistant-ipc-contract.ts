import { z } from 'zod';

const text = z.string(), number = z.number().finite();
const kind = z.enum(['memory', 'knowledge', 'follow_up']);
const scope = z.enum(['global', 'project']);
const evidence = z.object({ kind: text, id: text }).strict();
export const ASSISTANT_PROFILE_SCHEMA = z.object({
  id: z.literal('default-personal-assistant'), status: z.enum(['needs_consent', 'active', 'paused']),
  locale: z.enum(['zh', 'en']), timeZone: text, eveningTime: text, morningTime: text,
  workdays: z.array(number), quietHours: z.object({ start: text, end: text }).strict(),
  dataScopes: z.array(z.enum(['threads', 'projects', 'tasks', 'artifacts', 'automations', 'meetings'])),
  createdAt: number, updatedAt: number,
}).strict();
export const ASSISTANT_CANDIDATE_SCHEMA = z.object({
  id: text, runId: text, kind, title: text, content: text, scope, projectId: text.optional(),
  confidence: number, evidenceRefs: z.array(evidence), dedupeKey: text,
  status: z.enum(['staged', 'pending', 'accepting', 'accepted', 'rejected', 'superseded', 'accept_failed']),
  targetKind: kind.optional(), targetId: text.optional(), acceptedTargetRef: text.optional(),
  createdAt: number, decidedAt: number.optional(),
}).strict();
export const ASSISTANT_PROMOTION_SCHEMA = z.object({
  id: text, runId: text, kind, status: z.enum(['pending', 'accepting', 'accepted', 'accept_failed']),
  title: text, content: text, scope, projectId: text.optional(), projectCwd: text.optional(),
  evidenceRefs: z.array(evidence), targetKind: kind.optional(), targetId: text.optional(),
  acceptedTargetRef: text.optional(), error: text.optional(),
}).strict();
export const ASSISTANT_OVERVIEW_SCHEMA = z.object({
  profile: ASSISTANT_PROFILE_SCHEMA,
  suggestions: z.array(z.object({ id: text, title: text, summary: text }).strict()),
  pendingCandidateCount: number, candidates: z.array(ASSISTANT_CANDIDATE_SCHEMA),
}).strict();
export const ASSISTANT_ACCEPT_RESULT_SCHEMA = z.union([ASSISTANT_CANDIDATE_SCHEMA, ASSISTANT_PROMOTION_SCHEMA]);
export const ASSISTANT_INPUT_SCHEMAS = Object.freeze({
  getOverview: z.tuple([]), activate: z.tuple([]), pause: z.tuple([]), resume: z.tuple([]),
  acceptCandidate: z.tuple([z.object({ candidateId: text, collectionId: text.optional() }).strict()]),
  rejectCandidate: z.tuple([z.object({ candidateId: text }).strict()]),
});
export const ASSISTANT_OUTPUT_SCHEMAS = Object.freeze({
  getOverview: ASSISTANT_OVERVIEW_SCHEMA, activate: ASSISTANT_PROFILE_SCHEMA,
  pause: ASSISTANT_PROFILE_SCHEMA, resume: ASSISTANT_PROFILE_SCHEMA,
  acceptCandidate: ASSISTANT_ACCEPT_RESULT_SCHEMA, rejectCandidate: ASSISTANT_CANDIDATE_SCHEMA,
});
export type AssistantProfileDto = z.infer<typeof ASSISTANT_PROFILE_SCHEMA>;
export type AssistantCandidateDto = z.infer<typeof ASSISTANT_CANDIDATE_SCHEMA>;
export type AssistantPromotionDto = z.infer<typeof ASSISTANT_PROMOTION_SCHEMA>;
export type AssistantOverviewDto = z.infer<typeof ASSISTANT_OVERVIEW_SCHEMA>;
export type AssistantAcceptResultDto = z.infer<typeof ASSISTANT_ACCEPT_RESULT_SCHEMA>;
