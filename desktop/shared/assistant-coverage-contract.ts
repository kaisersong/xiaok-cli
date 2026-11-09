import { z } from 'zod';
export const ASSISTANT_SOURCE_IDS = ['task_snapshots','kswarm_projects','timed_actions','meeting_metadata','knowledge_source_metadata'] as const;
export const ASSISTANT_SOURCE_COVERAGE_SCHEMA = z.object({
 sourceId:z.enum(ASSISTANT_SOURCE_IDS),
 status:z.enum(['checked','partial','unavailable','disabled','not_checked']),
 requestedWindow:z.object({from:z.number().finite(),to:z.number().finite()}).strict(),
 recordCount:z.number().int().nonnegative(), includedCount:z.number().int().nonnegative(),
 checkedAt:z.number().finite(), freshUntil:z.number().finite(),
 errorCode:z.enum(['source_unavailable','source_incomplete','completeness_unknown','snapshot_bounded']).optional(),
}).strict();
export type AssistantSourceCoverage = z.infer<typeof ASSISTANT_SOURCE_COVERAGE_SCHEMA>;
export const ASSISTANT_SOURCE_RUN_SCHEMA = z.object({
 runId:z.string().min(1),profileId:z.literal('default-personal-assistant'),kind:z.enum(['morning','evening']),
 coverage:z.array(ASSISTANT_SOURCE_COVERAGE_SCHEMA).length(5),
 analysisStatus:z.enum(['pending','complete','failed']),now:z.number().finite(),
}).strict();
export type AssistantSourceRun = z.infer<typeof ASSISTANT_SOURCE_RUN_SCHEMA>;
