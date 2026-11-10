import { z } from 'zod';
import {ASSISTANT_CALENDAR_EVENT_SCHEMA} from './assistant-calendar-contract.js';
import {KIM_JUDGMENT_SCHEMA} from './kim-decision-ipc-contract.js';
export const ASSISTANT_MESSAGE_SCHEMA=z.object({id:z.string().min(1).max(256),kind:z.enum(['morning','test']),createdAt:z.number().finite().nonnegative(),title:z.string().min(1).max(200),text:z.string().min(1).max(10000)}).strict();
export type AssistantMessage=z.infer<typeof ASSISTANT_MESSAGE_SCHEMA>;
export const ASSISTANT_CHAT_THREAD = 'a0c11111-1111-4111-8111-111111111111';
export const isAssistantThread = (id: unknown): id is string => typeof id === 'string' && (id === ASSISTANT_CHAT_THREAD || /^a0c22222-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id));
export type AssistantSource = 'mail'|'yzj_message'|'yzj_calendar'|'ai_news'|'internal';
export type AssistantActor = 'user'|'agent'|'scheduler';
export const SOURCE_SCHEMA=z.enum(['mail','yzj_message','yzj_calendar','ai_news','internal']);
const short=z.string().max(1000),id=z.string().min(1).max(256),time=z.number().finite().nonnegative();
export const ATTENTION_RECORD_SCHEMA=z.object({source:SOURCE_SCHEMA,accountKey:id,sourceId:id,title:z.string().min(1).max(200),summary:short,kimJudgment:KIM_JUDGMENT_SCHEMA.optional(),reason:short,nextStep:short,priority:z.enum(['now','later']),observedAt:time,deadline:time.optional(),url:z.string().url().max(2048).optional(),locator:z.record(z.string(),z.string().max(512)).optional()}).strict();
export type AttentionRecord=z.infer<typeof ATTENTION_RECORD_SCHEMA>;
export const ATTENTION_ITEM_SCHEMA=ATTENTION_RECORD_SCHEMA.extend({id:z.string().regex(/^[a-f0-9]{64}$/),revision:z.number().int().positive(),status:z.enum(['suggested','working','needs_input','ready','failed','resolved','hidden','unknown']),workStatus:z.enum(['working','needs_input','ready','failed']).optional(),snoozedUntil:time.optional(),attemptId:z.string().uuid().optional(),threadId:z.string().uuid().optional(),taskId:id.optional(),taskCreatedAt:time.optional(),reminderId:id.optional(),outcome:z.string().max(3000).optional(),updatedAt:time}).strict();
export type AttentionItem=z.infer<typeof ATTENTION_ITEM_SCHEMA>;
export const ASSISTANT_COVERAGE_SCHEMA=z.object({key:id,source:SOURCE_SCHEMA,state:z.enum(['ok','partial','unavailable','failed','stale']),checkedAt:time,code:z.enum(['not_connected','read_failed','triage_failed','account_changed','limited','disabled']).optional()}).strict();
export type AssistantCoverage=z.infer<typeof ASSISTANT_COVERAGE_SCHEMA>;
export const ASSISTANT_BRIEF_SCHEMA=z.object({id:z.string(),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),timeZone:z.string().max(128),createdAt:time,needsYou:z.array(ATTENTION_ITEM_SCHEMA).max(20),canWait:z.array(ATTENTION_ITEM_SCHEMA).max(20),calendar:z.array(ATTENTION_ITEM_SCHEMA).max(20),coverage:z.array(ASSISTANT_COVERAGE_SCHEMA).max(64)}).strict();
export type AssistantBrief=z.infer<typeof ASSISTANT_BRIEF_SCHEMA>;
export const ASSISTANT_INBOX_SNAPSHOT_SCHEMA=z.object({items:z.array(ATTENTION_ITEM_SCHEMA).max(200),briefs:z.array(ASSISTANT_BRIEF_SCHEMA).max(7),coverage:z.array(ASSISTANT_COVERAGE_SCHEMA).max(64)}).strict();
export type AssistantInboxSnapshot=z.infer<typeof ASSISTANT_INBOX_SNAPSHOT_SCHEMA>;
export const ATTENTION_ACTION_SCHEMA=z.object({id,expectedRevision:z.number().int().positive(),action:z.enum(['hide','resolve','snooze','restore']),until:time.optional()}).strict();
export type AttentionAction=z.infer<typeof ATTENTION_ACTION_SCHEMA>;
export const ATTENTION_START_SCHEMA=z.object({id,expectedRevision:z.number().int().positive(),requestId:z.string().uuid()}).strict();
export type AttentionStart=z.infer<typeof ATTENTION_START_SCHEMA>;
export function assistantUser(source:AssistantActor|undefined):void {if(source!=='user')throw Error('assistant_user_only');}
export function assistantSource(source:AssistantActor|undefined):void {if(!['user','scheduler'].includes(source??''))throw Error('assistant_source_denied');}
export function assistantLocalDate(now:number,timeZone:string):string {const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);return ['year','month','day'].map(k=>parts.find(p=>p.type===k)!.value).join('-');}
export const OUTBOX_STATUS_SCHEMA=z.enum(['draft','submitting','accepted','refused','failed','unknown']);
export const OUTBOX_DRAFT_SCHEMA=z.object({id:z.string().uuid(),revision:z.number().int().positive(),channel:z.enum(['mail','yzj','calendar']),taskId:id.optional(),recipient:z.string().max(1000),to:z.array(z.string().email()).max(20).optional(),subject:z.string().max(200).optional(),text:z.string().min(1).max(30000),status:OUTBOX_STATUS_SCHEMA,createdAt:time,errorCode:z.string().max(80).optional(),calendar:ASSISTANT_CALENDAR_EVENT_SCHEMA.optional(),calendarEventId:z.string().min(1).max(256).optional()}).strict().superRefine((v,c)=>{if(v.channel==='calendar'){if(!v.calendar||v.to||v.subject||v.status==='accepted'&&!v.calendarEventId)c.addIssue({code:'custom',message:'calendar_draft_invalid'});}else if(v.calendar||v.calendarEventId)c.addIssue({code:'custom',message:'calendar_draft_invalid'});});
export type OutboxDraft=z.infer<typeof OUTBOX_DRAFT_SCHEMA>;
export const OUTBOX_APPROVE_SCHEMA=z.object({id:z.string().uuid(),expectedRevision:z.number().int().positive(),text:z.string().min(1).max(30000),to:z.array(z.string().email()).min(1).max(20).optional(),subject:z.string().min(1).max(200).regex(/^[^\r\n]+$/).optional()}).strict();
export type OutboxApproval=z.infer<typeof OUTBOX_APPROVE_SCHEMA>;
export const OUTBOX_DECISION_SCHEMA=z.object({id:z.string().uuid(),expectedRevision:z.number().int().positive()}).strict();
export const ASSISTANT_STATE_SCHEMA=ASSISTANT_INBOX_SNAPSHOT_SCHEMA.extend({outbox:z.array(OUTBOX_DRAFT_SCHEMA).max(100),testMessages:z.array(ASSISTANT_MESSAGE_SCHEMA).max(50).default([]),active:z.boolean(),scanning:z.boolean()}).strict();
export type AssistantState=z.infer<typeof ASSISTANT_STATE_SCHEMA>;
