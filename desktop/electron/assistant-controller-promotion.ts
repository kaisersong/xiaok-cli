import {canonicalVerificationJson as canonicalJson} from '../../src/runtime/verification/protocol.js';
import type {MemoryRecord,MemoryStore} from '../../src/ai/memory/store.js';
import type {AssistantCandidateStore} from './assistant-controller.js';
import type {AssistantCandidate} from './assistant-types.js';
import type {AssistantCandidatePromotionRepository,AssistantCandidatePromotionTargets,AssistantCandidatePromotionRecord,AssistantPromotionTargetInput} from './assistant-candidate-promotion.js';
import {computeKbSourceContentDigest,type KbStore} from './kb-store.js';
import type {Source} from './kb-types.js';

export function createAssistantCandidatePromotionTargets(options: {
  memoryStore: MemoryStore;
  memoryBackend: 'layered' | 'fallback';
  kbStore: Pick<KbStore, 'getCollection' | 'getSource' | 'addSource' | 'ensureAssistantSource'>;
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
      // Legacy ordinary recovery can recover the collection only from its exact
      // existing stable target. Protected recovery always supplies durable intent.
      const collectionId = input.collectionId ?? options.kbStore.getSource(input.targetId)?.collectionId;
      if (!collectionId) throw new Error('assistant_candidate_collection_required');
      if (!options.kbStore.ensureAssistantSource) throw Error('assistant_knowledge_durable_store_required');
      const source = options.kbStore.ensureAssistantSource({
        sourceId: input.targetId,
        clientRequestKey: `assistant-candidate:${input.candidateId}`,
        collectionId,
        kind: 'paste', title: input.title, text: input.content, parseStatus: 'pending',
        metadata: {assistantCandidateId:input.candidateId,assistantRunId:input.loopRunId,assistantEvidenceRefs:input.provenance.evidenceRefs},
      }, 'user');
      assertKnowledgeTargetMatches(source, {...input,collectionId});
      return { targetRef: `kb://${input.targetId}` };
    },

    async ensureFollowUp(input) {
      return { targetRef: `draft://${input.targetId}` };
    },
  };
}

export function createCandidateRepository(
  store: AssistantCandidateStore,
  now: () => number,
  resolveProjectCwd?: (projectId: string) => string | undefined,
): AssistantCandidatePromotionRepository {
  const map = (candidate: AssistantCandidate | undefined): AssistantCandidatePromotionRecord | undefined => {
    if (!candidate || !['pending', 'accepting', 'accepted', 'accept_failed'].includes(candidate.status)) return undefined;
    const mapped:AssistantCandidatePromotionRecord = {
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
    if(store.getAssistantCandidatePublicationMode?.(candidate.id)==='protected')throw Error('assistant_publication_required');
    return mapped;
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
    && canonicalJson(existing.provenance) === canonicalJson(expected.provenance);
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
    && canonicalJson(metadata.assistantEvidenceRefs ?? []) === canonicalJson(input.provenance.evidenceRefs)
    && metadata.assistantContentDigest === computeKbSourceContentDigest({ text: input.content });
  if (!matches) throw new Error('assistant_knowledge_target_conflict');
}
