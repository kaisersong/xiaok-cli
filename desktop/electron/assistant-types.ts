import type {AssistantCandidateKind, AssistantCandidateStatus, AssistantEvidenceRef, AssistantCandidate} from '../../src/runtime/loop/producer-types.js';
export type {AssistantCandidateKind, AssistantCandidateStatus, AssistantEvidenceRef, AssistantCandidate} from '../../src/runtime/loop/producer-types.js';
export const DEFAULT_PERSONAL_ASSISTANT_ID = 'default-personal-assistant' as const;
export const ASSISTANT_EVENING_LOOP_ID = 'personal-assistant-evening-reflection' as const;
export const ASSISTANT_MORNING_LOOP_ID = 'personal-assistant-morning-briefing' as const;

export type AssistantStatus = 'needs_consent' | 'active' | 'paused';
export type AssistantDataScope = 'threads' | 'projects' | 'tasks' | 'artifacts' | 'automations' | 'meetings';

export interface AssistantProfile {
  id: typeof DEFAULT_PERSONAL_ASSISTANT_ID;
  status: AssistantStatus;
  locale: 'zh' | 'en';
  timeZone: string;
  eveningTime: string;
  morningTime: string;
  workdays: number[];
  quietHours: { start: string; end: string };
  dataScopes: AssistantDataScope[];
  createdAt: number;
  updatedAt: number;
}




export type CreateAssistantCandidateInput = Omit<AssistantCandidate, 'id' | 'runId' | 'status' | 'createdAt' | 'decidedAt'>;

export const ASSISTANT_LOOP_IDS = [ASSISTANT_EVENING_LOOP_ID, ASSISTANT_MORNING_LOOP_ID] as const;
