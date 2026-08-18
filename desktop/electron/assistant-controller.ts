import type { MemoryRecord, MemoryStore } from '../../src/ai/memory/store.js';
import {
  AssistantCandidatePromotionService,
  type AssistantCandidatePromotionRecord,
  type AssistantCandidatePromotionRepository,
  type AssistantCandidatePromotionTargets,
  type AssistantCandidateRequestSource,
  type AssistantPromotionTargetInput,
} from './assistant-candidate-promotion.js';
import type { AssistantCandidate, AssistantCandidateStatus, AssistantProfile } from './assistant-types.js';
import { computeKbSourceContentDigest, type KbStore } from './kb-store.js';
import type { Source } from './kb-types.js';

export interface AssistantCandidateStore {
  getAssistantCandidate(id: string): AssistantCandidate | undefined;
  listAssistantCandidates(input?: { statuses?: AssistantCandidateStatus[] }): AssistantCandidate[];
  beginAssistantCandidateAccept(
    candidateId: string,
    targetKind: NonNullable<AssistantCandidate['targetKind']>,
    targetId: string,
    now: number,
  ): AssistantCandidate | undefined;
  markAssistantCandidateAccepted(candidateId: string, targetRef: string, now: number): AssistantCandidate | undefined;
  markAssistantCandidateAcceptFailed(candidateId: string, now: number): AssistantCandidate | undefined;
  rejectAssistantCandidate(candidateId: string, now: number): AssistantCandidate | undefined;
}

export interface AssistantStatusService {
  bootstrap(): { profile: AssistantProfile };
  setStatus(status: AssistantProfile['status']): AssistantProfile;
}

export interface AssistantOverview {
  profile: AssistantProfile;
  suggestions: Array<{ id: string; title: string; summary: string }>;
  pendingCandidateCount: number;
  candidates: AssistantCandidate[];
}

export interface AssistantControllerOptions {
  assistantService: AssistantStatusService;
  candidates: AssistantCandidateStore;
  memoryStore: MemoryStore;
  memoryBackend: 'layered' | 'fallback';
  kbStore: Pick<KbStore, 'getCollection' | 'getSource' | 'addSource'>;
  resolveProjectCwd?: (projectId: string) => string | undefined;
  listMorningSuggestions?: () => Array<{ id: string; title: string; summary: string }>;
  now?: () => number;
}

export class AssistantController {
  private readonly now: () => number;
  private readonly promotion: AssistantCandidatePromotionService;

  constructor(private readonly options: AssistantControllerOptions) {
    this.now = options.now ?? (() => Date.now());
    this.promotion = new AssistantCandidatePromotionService({
      candidates: createCandidateRepository(options.candidates, this.now, options.resolveProjectCwd),
      targets: createAssistantCandidatePromotionTargets({
        memoryStore: options.memoryStore,
        memoryBackend: options.memoryBackend,
        kbStore: options.kbStore,
        now: this.now,
      }),
    });
  }

  getOverview(): AssistantOverview {
    const { profile } = this.options.assistantService.bootstrap();
    const candidates = this.options.candidates.listAssistantCandidates();
    const pending = candidates.filter(candidate => candidate.status === 'pending');
    return {
      profile,
      suggestions: (this.options.listMorningSuggestions?.() ?? []).slice(0, 3),
      pendingCandidateCount: pending.length,
      candidates,
    };
  }

  activate(input: { requestSource: AssistantCandidateRequestSource }): AssistantProfile {
    requireAssistantUser(input.requestSource);
    return this.options.assistantService.setStatus('active');
  }

  pause(input: { requestSource: AssistantCandidateRequestSource }): AssistantProfile {
    requireAssistantUser(input.requestSource);
    return this.options.assistantService.setStatus('paused');
  }

  resume(input: { requestSource: AssistantCandidateRequestSource }): AssistantProfile {
    requireAssistantUser(input.requestSource);
    return this.options.assistantService.setStatus('active');
  }

  async acceptCandidate(input: {
    candidateId: string;
    requestSource: AssistantCandidateRequestSource;
    collectionId?: string;
  }): Promise<AssistantCandidatePromotionRecord> {
    return await this.promotion.accept(input);
  }

  rejectCandidate(input: {
    candidateId: string;
    requestSource: AssistantCandidateRequestSource;
  }): AssistantCandidate {
    if (input.requestSource !== 'user') throw new Error('assistant_candidate_user_only');
    const candidate = this.options.candidates.rejectAssistantCandidate(input.candidateId, this.now());
    if (!candidate) throw new Error('assistant_candidate_not_found');
    if (candidate.status !== 'rejected') throw new Error('assistant_candidate_reject_conflict');
    return candidate;
  }

  async recoverAccepting(): Promise<Array<{ candidateId: string; status: 'accepted' | 'accept_failed' }>> {
    return await this.promotion.recoverAccepting();
  }
}

export function createAssistantCandidatePromotionTargets(options: {
  memoryStore: MemoryStore;
  memoryBackend: 'layered' | 'fallback';
  kbStore: Pick<KbStore, 'getCollection' | 'getSource' | 'addSource'>;
  now?: () => number;
}): AssistantCandidatePromotionTargets {
  const now = options.now ?? (() => Date.now());
  return {
    async ensureMemory(input) {
      const record = memoryRecordFromTarget(input, options.memoryBackend, now());
      const existing = options.memoryStore.getById?.(input.targetId);
      if (existing) {
        assertMemoryTargetMatches(existing, record);
      } else {
        if (!options.memoryStore.getById) throw new Error('assistant_memory_stable_lookup_unavailable');
        await options.memoryStore.save(record);
        const saved = options.memoryStore.getById(input.targetId);
        if (!saved) throw new Error('assistant_memory_write_not_durable');
        assertMemoryTargetMatches(saved, record);
      }
      return { targetRef: `memory://${options.memoryBackend}/${input.targetId}` };
    },

    async ensureKnowledge(input) {
      const existing = options.kbStore.getSource(input.targetId);
      if (existing) {
        assertKnowledgeTargetMatches(existing, input);
        return { targetRef: `kb://${input.targetId}` };
      }
      if (!input.collectionId) throw new Error('assistant_candidate_collection_required');
      if (!options.kbStore.getCollection(input.collectionId)) throw new Error('assistant_candidate_collection_not_found');
      const source = options.kbStore.addSource({
        sourceId: input.targetId,
        clientRequestKey: `assistant-candidate:${input.candidateId}`,
        collectionId: input.collectionId,
        kind: 'paste',
        title: input.title,
        text: input.content,
        parseStatus: 'pending',
        metadata: {
          assistantCandidateId: input.candidateId,
          assistantRunId: input.loopRunId,
          assistantEvidenceRefs: input.provenance.evidenceRefs,
        },
      }, 'user');
      assertKnowledgeTargetMatches(source, input);
      return { targetRef: `kb://${input.targetId}` };
    },

    async ensureFollowUp(input) {
      return { targetRef: `draft://${input.targetId}` };
    },
  };
}

function createCandidateRepository(
  store: AssistantCandidateStore,
  now: () => number,
  resolveProjectCwd?: (projectId: string) => string | undefined,
): AssistantCandidatePromotionRepository {
  const map = (candidate: AssistantCandidate | undefined): AssistantCandidatePromotionRecord | undefined => {
    if (!candidate || !['pending', 'accepting', 'accepted', 'accept_failed'].includes(candidate.status)) return undefined;
    return {
      id: candidate.id,
      runId: candidate.runId,
      kind: candidate.kind,
      status: candidate.status as AssistantCandidatePromotionRecord['status'],
      title: candidate.title,
      content: candidate.content,
      scope: candidate.scope,
      projectId: candidate.projectId,
      projectCwd: candidate.projectId ? resolveProjectCwd?.(candidate.projectId) : undefined,
      evidenceRefs: candidate.evidenceRefs.map(reference => ({ ...reference })),
      targetKind: candidate.targetKind,
      targetId: candidate.targetId,
      acceptedTargetRef: candidate.acceptedTargetRef,
    };
  };
  return {
    get(candidateId) {
      return map(store.getAssistantCandidate(candidateId));
    },
    beginAccept(candidateId, targetKind, targetId) {
      const candidate = map(store.beginAssistantCandidateAccept(candidateId, targetKind, targetId, now()));
      return candidate?.status === 'accepting' && candidate.targetKind === targetKind && candidate.targetId === targetId
        ? candidate
        : undefined;
    },
    markAccepted(candidateId, targetRef) {
      const candidate = map(store.markAssistantCandidateAccepted(candidateId, targetRef, now()));
      return candidate?.status === 'accepted' && candidate.acceptedTargetRef === targetRef ? candidate : undefined;
    },
    markAcceptFailed(candidateId) {
      const candidate = map(store.markAssistantCandidateAcceptFailed(candidateId, now()));
      return candidate?.status === 'accept_failed' ? candidate : undefined;
    },
    listAccepting() {
      return store.listAssistantCandidates({ statuses: ['accepting'] })
        .map(candidate => map(candidate))
        .filter((candidate): candidate is AssistantCandidatePromotionRecord => candidate !== undefined);
    },
  };
}

function memoryRecordFromTarget(
  input: AssistantPromotionTargetInput,
  backend: 'layered' | 'fallback',
  updatedAt: number,
): MemoryRecord {
  if (input.scope === 'project' && !input.projectCwd) throw new Error('assistant_candidate_project_cwd_required');
  return {
    id: input.targetId,
    scope: input.scope,
    cwd: input.scope === 'project' ? input.projectCwd : undefined,
    title: input.title,
    summary: input.content,
    tags: ['assistant-candidate'],
    updatedAt,
    type: input.scope === 'project' ? 'project' : 'user',
    provenance: {
      kind: 'assistant_candidate',
      candidateId: input.candidateId,
      loopRunId: input.loopRunId,
      backend,
      evidenceRefs: input.provenance.evidenceRefs.map(reference => ({ ...reference })),
    },
  };
}

function assertMemoryTargetMatches(existing: MemoryRecord, expected: MemoryRecord): void {
  const matches = existing.id === expected.id
    && existing.scope === expected.scope
    && existing.cwd === expected.cwd
    && existing.title === expected.title
    && existing.summary === expected.summary
    && existing.type === expected.type
    && JSON.stringify(existing.provenance) === JSON.stringify(expected.provenance);
  if (!matches) throw new Error('assistant_memory_target_conflict');
}

function assertKnowledgeTargetMatches(
  source: Source,
  input: AssistantPromotionTargetInput,
): void {
  const metadata = source.metadata;
  const matches = source.id === input.targetId
    && (!input.collectionId || source.collectionId === input.collectionId)
    && metadata.clientRequestKey === `assistant-candidate:${input.candidateId}`
    && metadata.assistantCandidateId === input.candidateId
    && metadata.assistantRunId === input.loopRunId
    && JSON.stringify(metadata.assistantEvidenceRefs ?? []) === JSON.stringify(input.provenance.evidenceRefs)
    && metadata.assistantContentDigest === computeKbSourceContentDigest({ text: input.content });
  if (!matches) throw new Error('assistant_knowledge_target_conflict');
}

function requireAssistantUser(requestSource: AssistantCandidateRequestSource): void {
  if (requestSource !== 'user') throw new Error('assistant_user_only');
}
