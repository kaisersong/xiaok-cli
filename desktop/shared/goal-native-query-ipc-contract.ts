import { z } from 'zod';
/** Summary of existing journal facts, never a native authorization/approval receipt. */
export const GOAL_NATIVE_QUERY_CHANNEL = 'desktop:goal:getNativeMutation' as const;
export const GOAL_NATIVE_QUERY_OUTPUT = z.object({
  id: z.string().min(1),
  kind: z.enum(['create', 'replace', 'fork']),
  status: z.enum(['reserved', 'enrolling', 'enrolled', 'binding', 'ready', 'applied', 'retired', 'stale']),
  objective: z.string(),
}).strict().nullable();
export type GoalNativeQueryDto = z.infer<typeof GOAL_NATIVE_QUERY_OUTPUT>;
