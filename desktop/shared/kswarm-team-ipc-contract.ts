import { z } from 'zod';

const text = z.string();
export const PROJECT_TEAM_ITEM_SCHEMA = z.object({
  desiredAgentId: text, action: z.enum(['keep', 'reuse', 'create']), role: text,
  agentName: text.optional(), capabilityLabels: z.array(text), reasonCode: text,
}).strict();
export const PROJECT_TEAM_PLAN_SCHEMA = z.object({
  planId: text, projectId: text, projectRevision: z.number().finite(),
  outcome: z.enum(['proposal', 'no_change', 'needs_manual_scope']), summary: text,
  items: z.array(PROJECT_TEAM_ITEM_SCHEMA),
}).strict();
export const PROJECT_TEAM_OPERATION_SCHEMA = z.object({
  operationId: text, status: z.enum(['pending', 'running', 'completed', 'failed']), message: text.optional(),
}).strict();
export const KSWARM_TEAM_INPUT_SCHEMAS = Object.freeze({
  plan: z.tuple([z.object({ projectId: text }).strict()]),
  apply: z.tuple([z.object({ projectId: text, planId: text, projectRevision: z.number().int().nonnegative().safe() }).strict()]),
  getOperation: z.tuple([z.object({ projectId: text }).strict()]),
});
export const KSWARM_TEAM_OUTPUT_SCHEMAS = Object.freeze({
  plan: PROJECT_TEAM_PLAN_SCHEMA, apply: PROJECT_TEAM_OPERATION_SCHEMA,
  getOperation: PROJECT_TEAM_OPERATION_SCHEMA.nullable(),
});
export type ProjectTeamPlanItemDto = z.infer<typeof PROJECT_TEAM_ITEM_SCHEMA>;
export type ProjectTeamPlanDto = z.infer<typeof PROJECT_TEAM_PLAN_SCHEMA>;
export type ProjectTeamOperationDto = z.infer<typeof PROJECT_TEAM_OPERATION_SCHEMA>;
