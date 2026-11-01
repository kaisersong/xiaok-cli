import type {AssistantCalendarMemorySettingsDto} from '../../../../shared/assistant-calendar-memory-contract';
import type {AssistantAnalysisStatus} from '../../../../shared/assistant-analysis-settings-contract';
import type {AssistantQualityStatus} from '../../../../shared/assistant-quality-contract';
import type {AssistantPeriodicStatus} from '../../../../shared/assistant-periodic-contract';
import type {AssistantLaunchSummary} from '../../../../shared/assistant-launch-contract';
import type {AssistantCalendarStatus} from '../../../../shared/assistant-calendar-contract';
import type {AssistantActionProposalDto} from '../../../../shared/assistant-action-contract';
import type { AssistantSourceCoverage } from '../../../../shared/assistant-coverage-contract';
export type AssistantProfileStatusView = 'needs_consent' | 'active' | 'paused';

export interface AssistantProfileView {
  status: AssistantProfileStatusView;
  eveningTime: string;
  morningTime: string;
}

export interface AssistantSuggestionView {
  id: string;
  title: string;
  summary: string;
}

export interface AssistantHomeSnapshot {
  analysisProvider?:AssistantAnalysisStatus;
  quality?:AssistantQualityStatus;
  periodic?:AssistantPeriodicStatus;
  calendar?:AssistantCalendarStatus;
  calendarMemory?:AssistantCalendarMemorySettingsDto;
  launches?:AssistantLaunchSummary[];
  proposals?:AssistantActionProposalDto[];
  coverageState?:'known'|'unknown';
  coverage?:AssistantSourceCoverage[];
  collectedAt?:number|null;
  analysisStatus?:'pending'|'complete'|'failed'|null;
  profile: AssistantProfileView;
  suggestions: AssistantSuggestionView[];
  pendingCandidateCount: number;
}

export type AssistantCandidateKindView = 'memory' | 'knowledge' | 'follow_up';
export type AssistantCandidateStatusView = 'staged' | 'pending' | 'accepting' | 'accepted' | 'rejected' | 'superseded' | 'accept_failed';

export interface AssistantCandidateView {
  acceptedTargetRef?:string;
  id: string;
  kind: AssistantCandidateKindView;
  status: AssistantCandidateStatusView;
  title: string;
  content: string;
  confidence: number;
  evidenceRefs: Array<{ kind: string; id: string }>;
}
