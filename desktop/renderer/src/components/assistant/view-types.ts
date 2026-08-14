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
  profile: AssistantProfileView;
  suggestions: AssistantSuggestionView[];
  pendingCandidateCount: number;
}

export type AssistantCandidateKindView = 'memory' | 'knowledge' | 'follow_up';
export type AssistantCandidateStatusView = 'staged' | 'pending' | 'accepting' | 'accepted' | 'rejected' | 'superseded' | 'accept_failed';

export interface AssistantCandidateView {
  id: string;
  kind: AssistantCandidateKindView;
  status: AssistantCandidateStatusView;
  title: string;
  content: string;
  confidence: number;
  evidenceRefs: Array<{ kind: string; id: string }>;
}
