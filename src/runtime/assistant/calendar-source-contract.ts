import {z} from 'zod';
const integer=z.number().nonnegative().refine(Number.isSafeInteger),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const ASSISTANT_CALENDAR_OBSERVATION_EVENT_SCHEMA=z.object({id:digest,title:z.string().min(1).max(160),start:integer,end:integer,timeZone:z.string().max(100).nullable(),allDay:z.literal('unknown'),cancelled:z.literal('unknown'),observationRevision:digest.optional()}).strict().refine(value=>value.end>=value.start&&Number.isFinite(new Date(value.start).getTime())&&Number.isFinite(new Date(value.end).getTime()));
export const ASSISTANT_CALENDAR_SNAPSHOT_SCHEMA=z.object({
 status:z.enum(['disabled','partial','unavailable']),epoch:integer,collectedAt:integer.nullable(),from:integer.nullable(),to:integer.nullable(),errorCode:z.enum(['completeness_unknown','event_semantics_unknown','source_unavailable','grant_changed']).nullable(),
 observation:z.object({identity:z.literal('provider_record'),window:z.object({from:integer,to:integer}).strict(),observedAt:integer,records:z.array(z.object({id:digest,observationRevision:digest}).strict()).max(200),enumeration:z.enum(['complete','partial','unknown']),added:z.array(digest).max(200),changed:z.array(digest).max(200),missingUnconfirmed:z.array(digest).max(200)}).strict().optional(),
 recordCount:integer.refine(value=>value<=200).optional(),events:z.array(ASSISTANT_CALENDAR_OBSERVATION_EVENT_SCHEMA).max(200),
}).strict();
export const ASSISTANT_CALENDAR_STATUS_SCHEMA=z.object({enabled:z.boolean(),epoch:integer,lastCompleteWatermark:z.null(),snapshot:ASSISTANT_CALENDAR_SNAPSHOT_SCHEMA}).strict();
export type AssistantCalendarSnapshot=z.infer<typeof ASSISTANT_CALENDAR_SNAPSHOT_SCHEMA>;
export type AssistantCalendarStatus=z.infer<typeof ASSISTANT_CALENDAR_STATUS_SCHEMA>;
