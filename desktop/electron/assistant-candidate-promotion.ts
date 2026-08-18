export type AssistantCandidateRequestSource = 'user' | 'agent' | 'scheduler';
export type AssistantCandidatePromotionStatus = 'pending' | 'accepting' | 'accepted' | 'accept_failed';
export type AssistantCandidatePromotionKind = 'memory' | 'knowledge' | 'follow_up';

export interface AssistantCandidatePromotionRecord {
  id: string;
  runId: string;
  kind: AssistantCandidatePromotionKind;
  status: AssistantCandidatePromotionStatus;
  title: string;
  content: string;
  scope: 'global' | 'project';
  projectId?: string;
  projectCwd?: string;
  evidenceRefs: Array<{ kind: string; id: string }>;
  targetKind?: AssistantCandidatePromotionKind;
  targetId?: string;
  acceptedTargetRef?: string;
  error?: string;
}

export interface AssistantCandidatePromotionRepository {
  get(candidateId: string): AssistantCandidatePromotionRecord | undefined;
  beginAccept(
    candidateId: string,
    targetKind: AssistantCandidatePromotionKind,
    targetId: string,
  ): AssistantCandidatePromotionRecord | undefined;
  markAccepted(candidateId: string, targetRef: string): AssistantCandidatePromotionRecord | undefined;
  markAcceptFailed(candidateId: string, error: string): AssistantCandidatePromotionRecord | undefined;
  listAccepting(): AssistantCandidatePromotionRecord[];
}

export interface AssistantPromotionTargetInput {
  candidateId: string;
  loopRunId: string;
  targetId: string;
  title: string;
  content: string;
  scope: 'global' | 'project';
  projectId?: string;
  projectCwd?: string;
  collectionId?: string;
  provenance: {
    kind: 'assistant_candidate';
    candidateId: string;
    loopRunId: string;
    evidenceRefs: Array<{ kind: string; id: string }>;
  };
}

export interface AssistantCandidatePromotionTargets {
  ensureMemory(input: AssistantPromotionTargetInput): Promise<{ targetRef: string }>;
  ensureKnowledge(input: AssistantPromotionTargetInput): Promise<{ targetRef: string }>;
  ensureFollowUp(input: AssistantPromotionTargetInput): Promise<{ targetRef: string }>;
}

export class AssistantCandidatePromotionService {
  constructor(private readonly dependencies: {
    candidates: AssistantCandidatePromotionRepository;
    targets: AssistantCandidatePromotionTargets;
  }) {}

  async accept(input: {
    candidateId: string;
    requestSource: AssistantCandidateRequestSource;
    collectionId?: string;
  }): Promise<AssistantCandidatePromotionRecord> {
    if (input.requestSource !== 'user') throw new Error('assistant_candidate_user_only');
    const existing = this.requireCandidate(input.candidateId);
    if (existing.status === 'accepted') return existing;
    if (existing.kind === 'knowledge' && existing.status !== 'accepting' && !input.collectionId) {
      throw new Error('assistant_candidate_collection_required');
    }
    const targetId = existing.targetId ?? stableTargetId(existing.kind, existing.id);
    const accepting = existing.status === 'accepting'
      ? existing
      : this.dependencies.candidates.beginAccept(existing.id, existing.kind, targetId);
    if (!accepting) throw new Error('assistant_candidate_accept_conflict');
    try {
      return await this.ensureAndFinalize(accepting, input.collectionId);
    } catch (error) {
      if (isPermanentPromotionError(error)) {
        this.dependencies.candidates.markAcceptFailed(accepting.id, error instanceof Error ? error.message : String(error));
      }
      throw error;
    }
  }

  async recoverAccepting(): Promise<Array<{ candidateId: string; status: 'accepted' | 'accept_failed' }>> {
    const results: Array<{ candidateId: string; status: 'accepted' | 'accept_failed' }> = [];
    for (const candidate of this.dependencies.candidates.listAccepting()) {
      try {
        const accepted = await this.ensureAndFinalize(candidate);
        results.push({ candidateId: accepted.id, status: 'accepted' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.dependencies.candidates.markAcceptFailed(candidate.id, message);
        results.push({ candidateId: candidate.id, status: 'accept_failed' });
      }
    }
    return results;
  }

  private async ensureAndFinalize(
    candidate: AssistantCandidatePromotionRecord,
    collectionId?: string,
  ): Promise<AssistantCandidatePromotionRecord> {
    if (!candidate.targetId) throw new Error('assistant_candidate_target_missing');
    const targetInput: AssistantPromotionTargetInput = {
      candidateId: candidate.id,
      loopRunId: candidate.runId,
      targetId: candidate.targetId,
      title: candidate.title,
      content: candidate.content,
      scope: candidate.scope,
      projectId: candidate.projectId,
      projectCwd: candidate.projectCwd,
      collectionId,
      provenance: {
        kind: 'assistant_candidate',
        candidateId: candidate.id,
        loopRunId: candidate.runId,
        evidenceRefs: candidate.evidenceRefs.map(reference => ({ ...reference })),
      },
    };
    const target = candidate.kind === 'memory'
      ? await this.dependencies.targets.ensureMemory(targetInput)
      : candidate.kind === 'knowledge'
        ? await this.dependencies.targets.ensureKnowledge(targetInput)
        : await this.dependencies.targets.ensureFollowUp(targetInput);
    const accepted = this.dependencies.candidates.markAccepted(candidate.id, target.targetRef);
    if (!accepted) throw new Error('assistant_candidate_finalize_conflict');
    return accepted;
  }

  private requireCandidate(candidateId: string): AssistantCandidatePromotionRecord {
    const candidate = this.dependencies.candidates.get(candidateId);
    if (!candidate) throw new Error('assistant_candidate_not_found');
    return candidate;
  }
}

function stableTargetId(kind: AssistantCandidatePromotionKind, candidateId: string): string {
  if (kind === 'memory') return `assistant-memory:${candidateId}`;
  if (kind === 'knowledge') return `assistant-source:${candidateId}`;
  return `assistant-follow-up:${candidateId}`;
}

function isPermanentPromotionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message === 'assistant_candidate_project_cwd_required'
    || message === 'assistant_candidate_collection_not_found'
    || message === 'assistant_memory_stable_lookup_unavailable'
    || message === 'assistant_memory_target_conflict'
    || message === 'assistant_knowledge_target_conflict'
    || message === 'kb_stable_source_conflict'
    || message === 'kb_client_request_key_conflict';
}
