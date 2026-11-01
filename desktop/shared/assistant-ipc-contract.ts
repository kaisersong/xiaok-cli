import {ASSISTANT_CALENDAR_MEMORY_SCHEMA,ASSISTANT_CALENDAR_MEMORY_INPUT_SCHEMA} from './assistant-calendar-memory-contract.js';
import {ASSISTANT_ANALYSIS_STATUS_SCHEMA,ASSISTANT_ANALYSIS_SETTINGS_SCHEMA} from './assistant-analysis-settings-contract.js';
import {ASSISTANT_THREAD_TARGET_PAGE_SCHEMA} from './assistant-launch-contract.js';
import {ASSISTANT_QUALITY_STATUS_SCHEMA,ASSISTANT_QUALITY_RESULT_SCHEMA,ASSISTANT_QUALITY_IMPORT_SCHEMA} from './assistant-quality-contract.js';
import {ASSISTANT_PERIODIC_STATUS_SCHEMA,ASSISTANT_PERIODIC_SETTINGS_SCHEMA,ASSISTANT_PERIODIC_CHECK_SCHEMA} from './assistant-periodic-contract.js';
import {ASSISTANT_LAUNCH_DRAFT_SCHEMA,ASSISTANT_LAUNCH_OPERATION_SCHEMA,ASSISTANT_LAUNCH_LOOKUP_SCHEMA,ASSISTANT_LAUNCH_SUMMARY_SCHEMA} from './assistant-launch-contract.js';
import {ASSISTANT_CALENDAR_STATUS_SCHEMA} from './assistant-calendar-contract.js';
import {ASSISTANT_ACTION_PROPOSAL_SCHEMA,ASSISTANT_ACTION_DECISION_RESULT_SCHEMA} from './assistant-action-contract.js';
import { ASSISTANT_SOURCE_COVERAGE_SCHEMA } from './assistant-coverage-contract.js';
import { z } from 'zod';

const text = z.string(), number = z.number().finite();
const kind = z.enum(['memory', 'knowledge', 'follow_up']);
const scope = z.enum(['global', 'project']);
const evidence = z.object({ kind: text, id: text }).strict();
export const ASSISTANT_PROFILE_SCHEMA = z.object({
  id: z.literal('default-personal-assistant'), status: z.enum(['needs_consent', 'active', 'paused']),
  locale: z.enum(['zh', 'en']), timeZone: text, eveningTime: text, morningTime: text,
  workdays: z.array(number), quietHours: z.object({ start: text, end: text }).strict(),
  dataScopes: z.array(z.enum(['threads', 'projects', 'tasks', 'artifacts', 'automations', 'meetings'])),
  createdAt: number, updatedAt: number,
}).strict();
export const ASSISTANT_CANDIDATE_SCHEMA = z.object({
  id: text, runId: text, kind, title: text, content: text, scope, projectId: text.optional(),
  confidence: number, evidenceRefs: z.array(evidence), dedupeKey: text,
  status: z.enum(['staged', 'pending', 'accepting', 'accepted', 'rejected', 'superseded', 'accept_failed']),
  targetKind: kind.optional(), targetId: text.optional(), acceptedTargetRef: text.optional(),
  createdAt: number, decidedAt: number.optional(),
}).strict();
export const ASSISTANT_PROMOTION_SCHEMA = z.object({
  id: text, runId: text, kind, status: z.enum(['pending', 'accepting', 'accepted', 'accept_failed']),
  title: text, content: text, scope, projectId: text.optional(), projectCwd: text.optional(),
  evidenceRefs: z.array(evidence), targetKind: kind.optional(), targetId: text.optional(),
  acceptedTargetRef: text.optional(), error: text.optional(),
}).strict();
export const ASSISTANT_OVERVIEW_SCHEMA = z.object({
  profile: ASSISTANT_PROFILE_SCHEMA,
  suggestions: z.array(z.object({ id: text, title: text, summary: text }).strict()),
  pendingCandidateCount: number, candidates: z.array(ASSISTANT_CANDIDATE_SCHEMA),
}).strict();
export const ASSISTANT_CANDIDATE_PAGE_SCHEMA=z.object({candidates:z.array(ASSISTANT_CANDIDATE_SCHEMA).max(50),nextCursor:text.max(160).nullable()}).strict();
export type AssistantCandidatePageDto=z.infer<typeof ASSISTANT_CANDIDATE_PAGE_SCHEMA>;
export const ASSISTANT_ACTION_OVERVIEW_SCHEMA = ASSISTANT_OVERVIEW_SCHEMA.extend({
  candidates:z.array(ASSISTANT_CANDIDATE_SCHEMA).max(50),nextCandidateCursor:text.max(160).nullable(),
  calendarMemory:ASSISTANT_CALENDAR_MEMORY_SCHEMA.optional(),analysisProvider:ASSISTANT_ANALYSIS_STATUS_SCHEMA.optional(),quality:ASSISTANT_QUALITY_STATUS_SCHEMA.optional(),periodic:ASSISTANT_PERIODIC_STATUS_SCHEMA.optional(),launches:z.array(ASSISTANT_LAUNCH_SUMMARY_SCHEMA).max(10).optional(),calendar:ASSISTANT_CALENDAR_STATUS_SCHEMA.optional(),schemaVersion:z.literal(2),proposals:z.array(ASSISTANT_ACTION_PROPOSAL_SCHEMA).max(3),coverageState:z.enum(['known','unknown']),
  coverage:z.array(ASSISTANT_SOURCE_COVERAGE_SCHEMA).max(5),
  analysisStatus:z.enum(['pending','complete','failed']).nullable(),
  collectedAt:z.number().finite().nullable(),
}).strict().refine(value=>new TextEncoder().encode(JSON.stringify(value)).byteLength<=256*1024,'assistant_v2_size');
export type AssistantActionOverviewDto = z.infer<typeof ASSISTANT_ACTION_OVERVIEW_SCHEMA>;
export const ASSISTANT_ACCEPT_RESULT_SCHEMA = z.union([ASSISTANT_CANDIDATE_SCHEMA, ASSISTANT_PROMOTION_SCHEMA]);
export const ASSISTANT_INPUT_SCHEMAS = Object.freeze({
  getCalendarMemorySettings:z.tuple([]),configureCalendarMemory:z.tuple([ASSISTANT_CALENDAR_MEMORY_INPUT_SCHEMA]),
  getAnalysisProvider:z.tuple([]),configureAnalysisProvider:z.tuple([ASSISTANT_ANALYSIS_SETTINGS_SCHEMA]),listLaunchTargets:z.tuple([z.object({cursor:text.min(1).max(4096).optional()}).strict()]),
  getQualityStatus:z.tuple([]),exportQualityReview:z.tuple([]),importQualityReview:z.tuple([ASSISTANT_QUALITY_IMPORT_SCHEMA]),revokeQualityReview:z.tuple([]),
  getPeriodicStatus:z.tuple([]),configurePeriodic:z.tuple([ASSISTANT_PERIODIC_SETTINGS_SCHEMA]),checkPeriodic:z.tuple([]),
  cancelLaunch:z.tuple([z.object({draftId:text.uuid()}).strict()]),
  prepareReconfirmation:z.tuple([z.object({draftId:text.uuid(),existingThreadId:text.min(1).max(160).optional()}).strict()]),
  prepareFollowUpLaunch:z.tuple([z.object({candidateId:text.min(1).max(160),existingThreadId:text.min(1).max(160).optional()}).strict()]),
  prepareLaunch:z.tuple([z.object({proposalId:text.min(1).max(160),expectedRevision:number.int().positive(),existingThreadId:text.min(1).max(160).optional()}).strict()]),
  confirmLaunch:z.tuple([z.object({draftId:text.uuid(),instruction:text.min(1).max(4000),goalConsentChecked:z.boolean().optional()}).strict()]),
  getActionLaunch:z.tuple([z.object({draftId:text.uuid()}).strict()]),
  resolveActionLaunch:z.tuple([z.object({draftId:text.uuid(),expectedResultDigest:text.regex(/^[a-f0-9]{64}$/)}).strict()]),
  getCalendarStatus:z.tuple([]),connectCalendar:z.tuple([]),disconnectCalendar:z.tuple([]),
  getActionCandidatesPage:z.tuple([z.object({cursor:text.min(1).max(160)}).strict()]),
  dismissAction:z.tuple([z.object({proposalId:text.min(1).max(160),expectedRevision:number.int().positive()}).strict()]),
  snoozeAction:z.tuple([z.object({proposalId:text.min(1).max(160),expectedRevision:number.int().positive(),snoozeUntil:number}).strict()]),
  getActionOverview: z.tuple([]), getOverview: z.tuple([]), activate: z.tuple([]), pause: z.tuple([]), resume: z.tuple([]),
  acceptCandidate: z.tuple([z.object({ candidateId: text, collectionId: text.optional() }).strict()]),
  rejectCandidate: z.tuple([z.object({ candidateId: text }).strict()]),
});
export const ASSISTANT_OUTPUT_SCHEMAS = Object.freeze({
  getCalendarMemorySettings:ASSISTANT_CALENDAR_MEMORY_SCHEMA,configureCalendarMemory:ASSISTANT_CALENDAR_MEMORY_SCHEMA,
  getAnalysisProvider:ASSISTANT_ANALYSIS_STATUS_SCHEMA,configureAnalysisProvider:ASSISTANT_ANALYSIS_STATUS_SCHEMA,listLaunchTargets:ASSISTANT_THREAD_TARGET_PAGE_SCHEMA,
  getQualityStatus:ASSISTANT_QUALITY_STATUS_SCHEMA,exportQualityReview:ASSISTANT_QUALITY_RESULT_SCHEMA,importQualityReview:ASSISTANT_QUALITY_RESULT_SCHEMA,revokeQualityReview:ASSISTANT_QUALITY_STATUS_SCHEMA,
  getPeriodicStatus:ASSISTANT_PERIODIC_STATUS_SCHEMA,configurePeriodic:ASSISTANT_PERIODIC_STATUS_SCHEMA,checkPeriodic:ASSISTANT_PERIODIC_CHECK_SCHEMA,
  cancelLaunch:ASSISTANT_LAUNCH_OPERATION_SCHEMA,
  prepareReconfirmation:ASSISTANT_LAUNCH_DRAFT_SCHEMA,
  prepareFollowUpLaunch:ASSISTANT_LAUNCH_DRAFT_SCHEMA,
  prepareLaunch:ASSISTANT_LAUNCH_DRAFT_SCHEMA,confirmLaunch:ASSISTANT_LAUNCH_OPERATION_SCHEMA,getActionLaunch:ASSISTANT_LAUNCH_LOOKUP_SCHEMA,resolveActionLaunch:ASSISTANT_LAUNCH_OPERATION_SCHEMA,
  getCalendarStatus:ASSISTANT_CALENDAR_STATUS_SCHEMA,connectCalendar:ASSISTANT_CALENDAR_STATUS_SCHEMA,disconnectCalendar:ASSISTANT_CALENDAR_STATUS_SCHEMA,
  getActionCandidatesPage:ASSISTANT_CANDIDATE_PAGE_SCHEMA,
  dismissAction:ASSISTANT_ACTION_DECISION_RESULT_SCHEMA,snoozeAction:ASSISTANT_ACTION_DECISION_RESULT_SCHEMA,
  getActionOverview: ASSISTANT_ACTION_OVERVIEW_SCHEMA, getOverview: ASSISTANT_OVERVIEW_SCHEMA, activate: ASSISTANT_PROFILE_SCHEMA,
  pause: ASSISTANT_PROFILE_SCHEMA, resume: ASSISTANT_PROFILE_SCHEMA,
  acceptCandidate: ASSISTANT_ACCEPT_RESULT_SCHEMA, rejectCandidate: ASSISTANT_CANDIDATE_SCHEMA,
});
export type AssistantProfileDto = z.infer<typeof ASSISTANT_PROFILE_SCHEMA>;
export type AssistantCandidateDto = z.infer<typeof ASSISTANT_CANDIDATE_SCHEMA>;
export type AssistantPromotionDto = z.infer<typeof ASSISTANT_PROMOTION_SCHEMA>;
export type AssistantOverviewDto = z.infer<typeof ASSISTANT_OVERVIEW_SCHEMA>;
export type AssistantAcceptResultDto = z.infer<typeof ASSISTANT_ACCEPT_RESULT_SCHEMA>;
