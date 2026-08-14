import { describe, expect, it, vi } from 'vitest';
import {
  AssistantController,
  type AssistantCandidateStore,
} from '../../electron/assistant-controller.js';
import type { AssistantCandidate, AssistantProfile } from '../../electron/assistant-types.js';
import type { KbStore } from '../../electron/kb-store.js';
import { computeKbSourceContentDigest } from '../../electron/kb-store.js';
import type { MemoryRecord, MemoryStore } from '../../../src/ai/memory/store.js';

const profile: AssistantProfile = {
  id: 'default-personal-assistant',
  status: 'needs_consent',
  locale: 'zh',
  timeZone: 'Asia/Shanghai',
  eveningTime: '22:30',
  morningTime: '08:30',
  workdays: [1, 2, 3, 4, 5],
  quietHours: { start: '22:00', end: '08:00' },
  dataScopes: ['threads', 'projects'],
  createdAt: 1,
  updatedAt: 1,
};

function candidate(overrides: Partial<AssistantCandidate> = {}): AssistantCandidate {
  return {
    id: 'candidate-1',
    runId: 'run-1',
    kind: 'memory',
    title: '汇报偏好',
    content: '先说结论。',
    scope: 'global',
    confidence: 0.9,
    evidenceRefs: [{ kind: 'task', id: 'task-1' }],
    dedupeKey: 'memory:report-style',
    status: 'pending',
    createdAt: 1,
    ...overrides,
  };
}

function candidateStore(initial: AssistantCandidate[]): AssistantCandidateStore & { records: Map<string, AssistantCandidate> } {
  const records = new Map(initial.map(item => [item.id, structuredClone(item)]));
  return {
    records,
    getAssistantCandidate(id) {
      const record = records.get(id);
      return record ? structuredClone(record) : undefined;
    },
    listAssistantCandidates(input = {}) {
      return [...records.values()]
        .filter(record => !input.statuses || input.statuses.includes(record.status))
        .map(record => structuredClone(record));
    },
    beginAssistantCandidateAccept(id, targetKind, targetId, now) {
      const record = records.get(id);
      if (!record || !['pending', 'accept_failed'].includes(record.status)) return record ? structuredClone(record) : undefined;
      const updated = { ...record, status: 'accepting' as const, targetKind, targetId, decidedAt: now };
      records.set(id, updated);
      return structuredClone(updated);
    },
    markAssistantCandidateAccepted(id, targetRef, now) {
      const record = records.get(id);
      if (!record || record.status !== 'accepting') return record ? structuredClone(record) : undefined;
      const updated = { ...record, status: 'accepted' as const, acceptedTargetRef: targetRef, decidedAt: now };
      records.set(id, updated);
      return structuredClone(updated);
    },
    markAssistantCandidateAcceptFailed(id, now) {
      const record = records.get(id);
      if (!record || record.status !== 'accepting') return record ? structuredClone(record) : undefined;
      const updated = { ...record, status: 'accept_failed' as const, decidedAt: now };
      records.set(id, updated);
      return structuredClone(updated);
    },
    rejectAssistantCandidate(id, now) {
      const record = records.get(id);
      if (!record || !['pending', 'accept_failed'].includes(record.status)) return record ? structuredClone(record) : undefined;
      const updated = { ...record, status: 'rejected' as const, decidedAt: now };
      records.set(id, updated);
      return structuredClone(updated);
    },
  };
}

function memoryStore(): MemoryStore & { records: Map<string, MemoryRecord>; save: ReturnType<typeof vi.fn> } {
  const records = new Map<string, MemoryRecord>();
  return {
    records,
    save: vi.fn(async (record: MemoryRecord) => { records.set(record.id, structuredClone(record)); }),
    getById(id) {
      const record = records.get(id);
      return record ? structuredClone(record) : undefined;
    },
    listRelevant: vi.fn().mockResolvedValue([]),
  };
}

function createController(input: {
  candidates?: AssistantCandidate[];
  memory?: ReturnType<typeof memoryStore>;
  kbStore?: KbStore;
  resolveProjectCwd?: (projectId: string) => string | undefined;
  listMorningSuggestions?: () => Array<{ id: string; title: string; summary: string }>;
} = {}) {
  const candidates = candidateStore(input.candidates ?? [candidate()]);
  const memory = input.memory ?? memoryStore();
  const assistantService = {
    bootstrap: vi.fn(() => ({ profile: structuredClone(profile) })),
    setStatus: vi.fn((status: AssistantProfile['status']) => ({ ...profile, status })),
  };
  const kbStore = input.kbStore ?? {
    getCollection: vi.fn(),
    getSource: vi.fn(),
    addSource: vi.fn(),
  } as unknown as KbStore;
  return {
    candidates,
    memory,
    assistantService,
    kbStore,
    controller: new AssistantController({
      assistantService,
      candidates,
      memoryStore: memory,
      memoryBackend: 'layered',
      kbStore,
      resolveProjectCwd: input.resolveProjectCwd,
      listMorningSuggestions: input.listMorningSuggestions,
      now: () => 100,
    }),
  };
}

describe('AssistantController', () => {
  it('returns pending candidates separately from at most three morning suggestions', () => {
    const records = Array.from({ length: 5 }, (_, index) => candidate({
      id: `candidate-${index + 1}`,
      title: `建议 ${index + 1}`,
      content: `内容 ${index + 1}`,
      createdAt: index + 1,
    }));
    const { controller } = createController({
      candidates: records,
      listMorningSuggestions: () => Array.from({ length: 5 }, (_, index) => ({
        id: `morning-${index + 1}`,
        title: `晨间建议 ${index + 1}`,
        summary: `reason_${index + 1}`,
      })),
    });

    expect(controller.getOverview()).toMatchObject({
      profile: { status: 'needs_consent' },
      pendingCandidateCount: 5,
      suggestions: [
        { id: 'morning-1', title: '晨间建议 1', summary: 'reason_1' },
        { id: 'morning-2', title: '晨间建议 2', summary: 'reason_2' },
        { id: 'morning-3', title: '晨间建议 3', summary: 'reason_3' },
      ],
    });
  });

  it('does not project evening candidates as morning suggestions', () => {
    const { controller } = createController({ candidates: [candidate()] });

    expect(controller.getOverview()).toMatchObject({
      pendingCandidateCount: 1,
      suggestions: [],
    });
  });

  it('allows only a user to activate, pause, resume, or reject', () => {
    const { controller, assistantService, candidates } = createController();

    expect(() => controller.activate({ requestSource: 'agent' })).toThrow('assistant_user_only');
    expect(() => controller.pause({ requestSource: 'scheduler' })).toThrow('assistant_user_only');
    expect(() => controller.resume({ requestSource: 'agent' })).toThrow('assistant_user_only');
    expect(() => controller.rejectCandidate({ candidateId: 'candidate-1', requestSource: 'agent' })).toThrow('assistant_candidate_user_only');
    expect(candidates.records.get('candidate-1')?.status).toBe('pending');

    expect(controller.activate({ requestSource: 'user' }).status).toBe('active');
    expect(controller.pause({ requestSource: 'user' }).status).toBe('paused');
    expect(controller.resume({ requestSource: 'user' }).status).toBe('active');
    expect(controller.rejectCandidate({ candidateId: 'candidate-1', requestSource: 'user' }).status).toBe('rejected');
    expect(assistantService.setStatus).toHaveBeenCalledTimes(3);
  });

  it('accepts memory with stable identity and complete provenance exactly once', async () => {
    const { controller, memory } = createController();

    const accepted = await controller.acceptCandidate({ candidateId: 'candidate-1', requestSource: 'user' });
    const duplicate = await controller.acceptCandidate({ candidateId: 'candidate-1', requestSource: 'user' });

    expect(accepted).toMatchObject({
      status: 'accepted',
      targetId: 'assistant-memory:candidate-1',
      acceptedTargetRef: 'memory://layered/assistant-memory:candidate-1',
    });
    expect(duplicate).toEqual(accepted);
    expect(memory.save).toHaveBeenCalledTimes(1);
    expect(memory.records.get('assistant-memory:candidate-1')).toEqual({
      id: 'assistant-memory:candidate-1',
      scope: 'global',
      title: '汇报偏好',
      summary: '先说结论。',
      tags: ['assistant-candidate'],
      updatedAt: 100,
      type: 'user',
      provenance: {
        kind: 'assistant_candidate',
        candidateId: 'candidate-1',
        loopRunId: 'run-1',
        backend: 'layered',
        evidenceRefs: [{ kind: 'task', id: 'task-1' }],
      },
    });
  });

  it('requires a canonical cwd for project-scoped memory', async () => {
    const projectCandidate = candidate({ scope: 'project', projectId: 'project-1' });
    const { controller, candidates } = createController({ candidates: [projectCandidate] });

    await expect(controller.acceptCandidate({ candidateId: 'candidate-1', requestSource: 'user' }))
      .rejects.toThrow('assistant_candidate_project_cwd_required');
    expect(candidates.records.get('candidate-1')?.status).toBe('accept_failed');
  });

  it('requires an explicit collection before beginning knowledge acceptance', async () => {
    const knowledge = candidate({ kind: 'knowledge' });
    const { controller, candidates, kbStore } = createController({ candidates: [knowledge] });

    await expect(controller.acceptCandidate({ candidateId: 'candidate-1', requestSource: 'user' }))
      .rejects.toThrow('assistant_candidate_collection_required');
    expect(candidates.records.get('candidate-1')?.status).toBe('pending');
    expect(kbStore.addSource).not.toHaveBeenCalled();
  });

  it('accepts a knowledge candidate into the confirmed collection with stable identity', async () => {
    const knowledge = candidate({ kind: 'knowledge' });
    const addSource = vi.fn((input) => ({
      id: input.sourceId,
      collectionId: input.collectionId,
      metadata: {
        ...input.metadata,
        clientRequestKey: input.clientRequestKey,
        assistantContentDigest: computeKbSourceContentDigest(input),
      },
    }));
    const kbStore = {
      getCollection: vi.fn(() => ({ id: 'collection-1' })),
      getSource: vi.fn(),
      addSource,
    } as unknown as KbStore;
    const { controller } = createController({ candidates: [knowledge], kbStore });

    const accepted = await controller.acceptCandidate({
      candidateId: 'candidate-1',
      requestSource: 'user',
      collectionId: 'collection-1',
    });

    expect(accepted.acceptedTargetRef).toBe('kb://assistant-source:candidate-1');
    expect(addSource).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 'assistant-source:candidate-1',
      clientRequestKey: 'assistant-candidate:candidate-1',
      collectionId: 'collection-1',
      kind: 'paste',
      text: '先说结论。',
      parseStatus: 'pending',
      metadata: expect.objectContaining({
        assistantCandidateId: 'candidate-1',
        assistantRunId: 'run-1',
        assistantEvidenceRefs: [{ kind: 'task', id: 'task-1' }],
      }),
    }), 'user');
  });

  it('accepts follow-up as a draft target without creating an external mutation', async () => {
    const followUp = candidate({ kind: 'follow_up' });
    const { controller, memory, kbStore } = createController({ candidates: [followUp] });

    const accepted = await controller.acceptCandidate({ candidateId: 'candidate-1', requestSource: 'user' });

    expect(accepted).toMatchObject({
      status: 'accepted',
      acceptedTargetRef: 'draft://assistant-follow-up:candidate-1',
    });
    expect(memory.save).not.toHaveBeenCalled();
    expect(kbStore.addSource).not.toHaveBeenCalled();
  });

  it('recovers an accepting memory candidate idempotently after restart', async () => {
    const accepting = candidate({
      status: 'accepting',
      targetKind: 'memory',
      targetId: 'assistant-memory:candidate-1',
    });
    const memory = memoryStore();
    memory.records.set('assistant-memory:candidate-1', {
      id: 'assistant-memory:candidate-1',
      scope: 'global',
      title: '汇报偏好',
      summary: '先说结论。',
      tags: ['assistant-candidate'],
      updatedAt: 99,
      type: 'user',
      provenance: {
        kind: 'assistant_candidate',
        candidateId: 'candidate-1',
        loopRunId: 'run-1',
        backend: 'layered',
        evidenceRefs: [{ kind: 'task', id: 'task-1' }],
      },
    });
    const { controller, candidates } = createController({ candidates: [accepting], memory });

    await expect(controller.recoverAccepting()).resolves.toEqual([
      { candidateId: 'candidate-1', status: 'accepted' },
    ]);
    expect(candidates.records.get('candidate-1')?.status).toBe('accepted');
    expect(memory.save).not.toHaveBeenCalled();
  });

  it('recovers an accepting knowledge candidate from its stable source without a second insert', async () => {
    const accepting = candidate({
      kind: 'knowledge',
      status: 'accepting',
      targetKind: 'knowledge',
      targetId: 'assistant-source:candidate-1',
    });
    const addSource = vi.fn();
    const kbStore = {
      getCollection: vi.fn(),
      getSource: vi.fn(() => ({
        id: 'assistant-source:candidate-1',
        collectionId: 'collection-1',
        metadata: {
          clientRequestKey: 'assistant-candidate:candidate-1',
          assistantCandidateId: 'candidate-1',
          assistantRunId: 'run-1',
          assistantEvidenceRefs: [{ kind: 'task', id: 'task-1' }],
          assistantContentDigest: computeKbSourceContentDigest({ text: '先说结论。' }),
        },
      })),
      addSource,
    } as unknown as KbStore;
    const { controller, candidates } = createController({ candidates: [accepting], kbStore });

    await expect(controller.recoverAccepting()).resolves.toEqual([
      { candidateId: 'candidate-1', status: 'accepted' },
    ]);
    expect(candidates.records.get('candidate-1')).toMatchObject({
      status: 'accepted',
      acceptedTargetRef: 'kb://assistant-source:candidate-1',
    });
    expect(addSource).not.toHaveBeenCalled();
  });
});
