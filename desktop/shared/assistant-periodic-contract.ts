import {z} from 'zod';
const time=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const ASSISTANT_PERIODIC_STATUS_SCHEMA=z.object({revision:z.number().int().nonnegative(),enabled:z.boolean(),notificationsEnabled:z.boolean(),intervalMinutes:z.number().int().min(30).max(1440),quietHours:z.object({start:time,end:time}).strict(),available:z.boolean(),reason:z.enum(['quality_unverified','budget_unavailable','assistant_paused','background_disabled']).nullable(),notificationsAvailable:z.boolean()}).strict();
export type AssistantPeriodicStatus=z.infer<typeof ASSISTANT_PERIODIC_STATUS_SCHEMA>;
export const ASSISTANT_PERIODIC_SETTINGS_SCHEMA=z.object({enabled:z.boolean(),notificationsEnabled:z.boolean(),intervalMinutes:z.number().int().min(30).max(1440),quietHours:z.object({start:time,end:time}).strict().optional(),expectedRevision:z.number().int().nonnegative()}).strict();
export type AssistantPeriodicSettings=z.infer<typeof ASSISTANT_PERIODIC_SETTINGS_SCHEMA>;
export const ASSISTANT_PERIODIC_CHECK_SCHEMA=z.object({status:z.enum(['success','blocked','skipped','outcome_unknown']),reason:z.enum(['quality_unverified','budget_unavailable','disabled','paused','outside_working_hours','source_unavailable','attempt_already_sent','already_running','already_completed','analysis_unavailable','busy','closed']).nullable()}).strict();
export type AssistantPeriodicCheck=z.infer<typeof ASSISTANT_PERIODIC_CHECK_SCHEMA>;
