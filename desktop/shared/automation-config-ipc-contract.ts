import { z } from 'zod';
const number = z.number().finite();
export const AUTOMATION_CONFIG_SCHEMA = z.object({ globalBackgroundAutoRunEnabled: z.boolean() }).passthrough();
export const AUTOMATION_CONFIG_SET_SCHEMA = z.object({ enabled: z.boolean() }).passthrough();
export const AUTOMATION_OVERVIEW_SCHEMA = z.object({
  generatedAt: number,
  sourceVersions: z.object({ loopStore: number, timedActionStore: number }).passthrough(),
  globalBackgroundAutoRunEnabled: z.boolean(),
  totals: z.object({ loops: number, userLoops: number, schedules: number, activeSchedules: number, diagnostics: number, recentFailures: number }).passthrough(),
  recentFailures: z.array(z.object({
    id: z.string(), source: z.enum(['loop_run', 'timed_action_run']), ownerId: z.string(), title: z.string(), status: z.string(),
    message: z.string().optional(), occurredAt: number, loopId: z.string().optional(), loopOrigin: z.enum(['built_in', 'user_template']).optional(),
    actionId: z.string().optional(), actionAvailableInSchedules: z.boolean().optional(),
  }).passthrough()),
}).passthrough();
export const AUTOMATION_CONFIG_INPUT_SCHEMAS = { getConfig: z.tuple([]), getOverviewSnapshot: z.tuple([]), setGlobalBackgroundAutoRun: z.tuple([AUTOMATION_CONFIG_SET_SCHEMA]) };
export const AUTOMATION_CONFIG_OUTPUT_SCHEMAS = { getConfig: AUTOMATION_CONFIG_SCHEMA, getOverviewSnapshot: AUTOMATION_OVERVIEW_SCHEMA, setGlobalBackgroundAutoRun: AUTOMATION_CONFIG_SCHEMA };
export type AutomationConfigMethod = keyof typeof AUTOMATION_CONFIG_INPUT_SCHEMAS;
export type AutomationConfigDto = z.infer<typeof AUTOMATION_CONFIG_SCHEMA>;
export type AutomationOverviewDto = z.infer<typeof AUTOMATION_OVERVIEW_SCHEMA>;
