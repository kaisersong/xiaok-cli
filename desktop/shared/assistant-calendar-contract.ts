import {z} from 'zod';
export const ASSISTANT_CALENDAR_EVENT_SCHEMA=z.object({
 id:z.string().regex(/^[a-f0-9]{64}$/),title:z.string().min(1).max(160),start:z.number().int(),end:z.number().int(),
 observationRevision:z.string().regex(/^[a-f0-9]{64}$/).optional(),
 timeZone:z.string().max(100).nullable(),allDay:z.literal('unknown'),cancelled:z.literal('unknown'),
}).strict();
export const ASSISTANT_CALENDAR_SNAPSHOT_SCHEMA=z.object({
 status:z.enum(['disabled','partial','unavailable']),epoch:z.number().int().nonnegative(),
 collectedAt:z.number().finite().nullable(),from:z.number().finite().nullable(),to:z.number().finite().nullable(),
 errorCode:z.enum(['completeness_unknown','event_semantics_unknown','source_unavailable','grant_changed']).nullable(),
 observation:z.object({identity:z.literal('provider_record'),window:z.object({from:z.number().int(),to:z.number().int()}).strict(),observedAt:z.number().int(),records:z.array(z.object({id:z.string().regex(/^[a-f0-9]{64}$/),observationRevision:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).max(200),enumeration:z.enum(['complete','partial','unknown']),added:z.array(z.string()).max(200),changed:z.array(z.string()).max(200),missingUnconfirmed:z.array(z.string()).max(200)}).strict().optional(),
 recordCount:z.number().int().min(0).max(200).optional(),events:z.array(ASSISTANT_CALENDAR_EVENT_SCHEMA).max(200),
}).strict();
export type AssistantCalendarSnapshot=z.infer<typeof ASSISTANT_CALENDAR_SNAPSHOT_SCHEMA>;
export const ASSISTANT_CALENDAR_STATUS_SCHEMA=z.object({enabled:z.boolean(),epoch:z.number().int().nonnegative(),lastCompleteWatermark:z.number().finite().nullable(),snapshot:ASSISTANT_CALENDAR_SNAPSHOT_SCHEMA}).strict();
export type AssistantCalendarStatus=z.infer<typeof ASSISTANT_CALENDAR_STATUS_SCHEMA>;
