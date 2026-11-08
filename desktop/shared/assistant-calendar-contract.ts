import {z} from 'zod';
const timestamp=z.string().datetime({offset:true});
export const ASSISTANT_CALENDAR_EVENT_SCHEMA=z.object({
 title:z.string().trim().min(1).max(100),startAt:timestamp,endAt:timestamp,description:z.string().max(4000).default(''),
}).strict().superRefine((v,c)=>{if(Date.parse(v.endAt)<=Date.parse(v.startAt))c.addIssue({code:'custom',message:'calendar_end_before_start'});}).transform(v=>({...v,startAt:new Date(v.startAt).toISOString(),endAt:new Date(v.endAt).toISOString()}));
export type AssistantCalendarEvent=z.output<typeof ASSISTANT_CALENDAR_EVENT_SCHEMA>;
export function normalizeAssistantCalendarEvent(input:unknown):AssistantCalendarEvent{return ASSISTANT_CALENDAR_EVENT_SCHEMA.parse(input);}
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
export const ASSISTANT_CALENDAR_RANGE_SCHEMA=z.object({startDate:date,endDate:date}).strict().refine(v=>Date.parse(v.endDate)>=Date.parse(v.startDate)&&Date.parse(v.endDate)-Date.parse(v.startDate)<=30*86400000);
