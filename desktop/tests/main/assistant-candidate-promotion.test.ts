import { describe, expect, it, vi } from 'vitest';
import {
  AssistantCandidatePromotionService,
  type AssistantCandidatePromotionRecord,
  type AssistantCandidatePromotionRepository,
} from '../../electron/assistant-candidate-promotion.js';

function repository(initial: AssistantCandidatePromotionRecord): AssistantCandidatePromotionRepository & {
  current: AssistantCandidatePromotionRecord;
} {
  return {
    current: structuredClone(initial),
    get(candidateId) {
      return this.current.id === candidateId ? structuredClone(this.current) : undefined;
    },
    beginAccept(candidateId, targetKind, targetId) {
      if (this.current.id !== candidateId || !['pending', 'accept_failed'].includes(this.current.status)) return structuredClone(this.current);
      this.current = { ...this.current, status: 'accepting', targetKind, targetId };
      return structuredClone(this.current);
    },
    markAccepted(candidateId, targetRef) {
      if (this.current.id !== candidateId || this.current.status !== 'accepting') return undefined;
      this.current = { ...this.current, status: 'accepted', acceptedTargetRef: targetRef };
      return structuredClone(this.current);
    },
    markAcceptFailed(candidateId, error) {
      if (this.current.id !== candidateId) return undefined;
      this.current = { ...this.current, status: 'accept_failed', error };
      return structuredClone(this.current);
    },
    listAccepting() {
      return this.current.status === 'accepting' ? [structuredClone(this.current)] : [];
    },
  };
}

const memoryCandidate: AssistantCandidatePromotionRecord = {
  id: 'candidate-1',
  runId: 'run-1',
  kind: 'memory',
  status: 'pending',
  title: '汇报偏好',
  content: '先说结论。',
  scope: 'global',
  evidenceRefs: [{ kind: 'task', id: 'task-1' }],
};

describe('assistant candidate promotion', () => {
  it('denies agent and scheduler accept before changing candidate state', async () => {
    const candidates = repository(memoryCandidate);
    const service = new AssistantCandidatePromotionService({
      candidates,
      targets: { ensureMemory: vi.fn(), ensureKnowledge: vi.fn(), ensureFollowUp: vi.fn() },
    });

    await expect(service.accept({ candidateId: 'candidate-1', requestSource: 'agent' })).rejects.toThrow('assistant_candidate_user_only');
    await expect(service.accept({ candidateId: 'candidate-1', requestSource: 'scheduler' })).rejects.toThrow('assistant_candidate_user_only');
    expect(candidates.current.status).toBe('pending');
  });

  it('uses a stable memory target id and duplicate accept returns the accepted snapshot', async () => {
    const candidates = repository(memoryCandidate);
    const ensureMemory = vi.fn().mockResolvedValue({ targetRef: 'memory://assistant-memory:candidate-1' });
    const service = new AssistantCandidatePromotionService({
      candidates,
      targets: { ensureMemory, ensureKnowledge: vi.fn(), ensureFollowUp: vi.fn() },
    });

    const first = await service.accept({ candidateId: 'candidate-1', requestSource: 'user' });
    const second = await service.accept({ candidateId: 'candidate-1', requestSource: 'user' });

    expect(first).toMatchObject({ status: 'accepted', targetId: 'assistant-memory:candidate-1' });
    expect(second).toEqual(first);
    expect(ensureMemory).toHaveBeenCalledTimes(1);
    expect(ensureMemory).toHaveBeenCalledWith(expect.objectContaining({
      targetId: 'assistant-memory:candidate-1',
      provenance: expect.objectContaining({ candidateId: 'candidate-1', loopRunId: 'run-1' }),
    }));
  });

  it('recovers an accepting candidate after the target write succeeds but finalization crashes', async () => {
    const candidates = repository(memoryCandidate);
    const originalMarkAccepted = candidates.markAccepted.bind(candidates);
    candidates.markAccepted = vi.fn().mockImplementationOnce(() => { throw new Error('simulated crash'); });
    const ensureMemory = vi.fn().mockResolvedValue({ targetRef: 'memory://assistant-memory:candidate-1' });
    const service = new AssistantCandidatePromotionService({
      candidates,
      targets: { ensureMemory, ensureKnowledge: vi.fn(), ensureFollowUp: vi.fn() },
    });

    await expect(service.accept({ candidateId: 'candidate-1', requestSource: 'user' })).rejects.toThrow('simulated crash');
    expect(candidates.current).toMatchObject({ status: 'accepting', targetId: 'assistant-memory:candidate-1' });

    candidates.markAccepted = originalMarkAccepted;
    const recovered = await service.recoverAccepting();

    expect(recovered).toEqual([{ candidateId: 'candidate-1', status: 'accepted' }]);
    expect(candidates.current.status).toBe('accepted');
    expect(ensureMemory).toHaveBeenCalledTimes(2);
  });

  it('uses deterministic knowledge and follow-up target identities', async () => {
    const knowledge = repository({ ...memoryCandidate, id: 'candidate-k', kind: 'knowledge' });
    const knowledgeTarget = vi.fn().mockResolvedValue({ targetRef: 'kb://assistant-source:candidate-k' });
    const knowledgeService = new AssistantCandidatePromotionService({
      candidates: knowledge,
      targets: { ensureMemory: vi.fn(), ensureKnowledge: knowledgeTarget, ensureFollowUp: vi.fn() },
    });
    await knowledgeService.accept({ candidateId: 'candidate-k', requestSource: 'user', collectionId: 'collection-1' });
    expect(knowledgeTarget).toHaveBeenCalledWith(expect.objectContaining({
      targetId: 'assistant-source:candidate-k',
      collectionId: 'collection-1',
    }));

    const followUp = repository({ ...memoryCandidate, id: 'candidate-f', kind: 'follow_up' });
    const followUpTarget = vi.fn().mockResolvedValue({ targetRef: 'draft://assistant-follow-up:candidate-f' });
    const followUpService = new AssistantCandidatePromotionService({
      candidates: followUp,
      targets: { ensureMemory: vi.fn(), ensureKnowledge: vi.fn(), ensureFollowUp: followUpTarget },
    });
    await followUpService.accept({ candidateId: 'candidate-f', requestSource: 'user' });
    expect(followUpTarget).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'assistant-follow-up:candidate-f' }));
  });

  it('retries a user-requested accept after a permanent target failure is repaired', async () => {
    const candidates = repository({ ...memoryCandidate, status: 'accept_failed' });
    const ensureMemory = vi.fn().mockResolvedValue({ targetRef: 'memory://assistant-memory:candidate-1' });
    const service = new AssistantCandidatePromotionService({
      candidates,
      targets: { ensureMemory, ensureKnowledge: vi.fn(), ensureFollowUp: vi.fn() },
    });

    await expect(service.accept({ candidateId: 'candidate-1', requestSource: 'user' }))
      .resolves.toMatchObject({ status: 'accepted', targetId: 'assistant-memory:candidate-1' });
    expect(ensureMemory).toHaveBeenCalledTimes(1);
  });

  it('marks a known permanent target validation error as accept_failed', async () => {
    const candidates = repository(memoryCandidate);
    const service = new AssistantCandidatePromotionService({
      candidates,
      targets: {
        ensureMemory: vi.fn().mockRejectedValue(new Error('assistant_candidate_project_cwd_required')),
        ensureKnowledge: vi.fn(),
        ensureFollowUp: vi.fn(),
      },
    });

    await expect(service.accept({ candidateId: 'candidate-1', requestSource: 'user' }))
      .rejects.toThrow('assistant_candidate_project_cwd_required');
    expect(candidates.current.status).toBe('accept_failed');
  });
});
