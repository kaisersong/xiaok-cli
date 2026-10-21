import { z } from 'zod';

/** Historical user data only. No key inside this tree is execution authority. */
export type HistoricalJsonData = string | number | boolean | null | HistoricalJsonData[]
  | { [key: string]: HistoricalJsonData };
export type HistoricalLoopTrigger = { kind: string; [key: string]: HistoricalJsonData };
const jsonData: z.ZodType<HistoricalJsonData> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(jsonData), z.record(z.string(), jsonData),
]));
const trigger = z.record(z.string(), jsonData).refine(value => typeof value.kind === 'string')
  .transform(value => value as HistoricalLoopTrigger);
const text = z.string(), number = z.number().finite();
const runStatus = z.enum(['running', 'success', 'failed', 'blocked']);
const businessStatus = z.enum(['running', 'success', 'failed', 'blocked', 'publication_pending']);
const historyStatus = z.enum(['success', 'failed', 'blocked', 'skipped', 'running', 'publication_pending']);
const observation = z.object({ state: z.enum(['verified_at_read', 'needs_revalidation']), checkedAt: number }).strict();

export const LOOP_RUN_OBSERVATION_SCHEMA = z.object({
  id: text, loopId: text, status: runStatus, trigger, logicalRunKey: text.optional(), evidenceIds: z.array(text),
  startedAt: number, finishedAt: number.optional(), updatedAt: number, failureKind: text.optional(),
  message: text.optional(), summary: text.optional(), nextActionKind: text.optional(), nextActionSummary: text.optional(),
  businessState: businessStatus, completionObservation: observation.optional(),
}).strict();
export const AUTOMATION_RUN_HISTORY_SCHEMA = z.object({
  historyStatus: historyStatus.optional(), completionObservation: observation.optional(), id: text,
  automationKind: z.enum(['loop', 'notify', 'agent_task']), scheduleRunId: text.optional(), loopRunId: text.optional(),
  actionId: text.optional(), loopId: text.optional(), title: text, startedAt: number, finishedAt: number.optional(),
  status: historyStatus, schedulerStatus: text.optional(), loopStatus: businessStatus.optional(),
  failureKind: text.optional(), message: text.optional(), outputPreviewAvailable: z.boolean().optional(),
}).strict();
export const LOOP_CURRENT_VIEW_SCHEMAS = Object.freeze({
  listRuns: z.array(LOOP_RUN_OBSERVATION_SCHEMA),
  getRunHistory: z.array(AUTOMATION_RUN_HISTORY_SCHEMA),
});
export type LoopRunObservationDto = z.infer<typeof LOOP_RUN_OBSERVATION_SCHEMA>;
export type AutomationRunHistoryDto = z.infer<typeof AUTOMATION_RUN_HISTORY_SCHEMA>;
