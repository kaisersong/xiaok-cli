import { z } from 'zod';
import {TASK_METADATA_PLANNING_INPUT,TASK_METADATA_PLANNING_OUTPUT} from './task-composite-planning-contract.js';
const LEGACY_PROJECT_PLANNING_INPUT = z.object({
  projectId: z.string(), projectName: z.string(), goal: z.string(), requirements: z.string(),
  planningGuidance: z.string(), poAgent: z.string(), members: z.array(z.string()),
  startPolicy: z.enum(['plan_only', 'auto_activate_after_plan', 'activate_and_dispatch_after_plan']).optional(),
}).strict();
export const PROJECT_PLANNING_INPUT=z.union([LEGACY_PROJECT_PLANNING_INPUT,TASK_METADATA_PLANNING_INPUT]);
export const PROJECT_PLANNING_OUTPUT = z.union([
  TASK_METADATA_PLANNING_OUTPUT,
  z.object({ ok: z.literal(true), status: z.enum(['queued','running','succeeded','launch_unknown']) }).strict(),
  z.object({ ok: z.literal(false), error: z.string() }).strict(),
]);
export type ProjectPlanningInput = z.infer<typeof PROJECT_PLANNING_INPUT>;
export type ProjectPlanningOutput = z.infer<typeof PROJECT_PLANNING_OUTPUT>;
