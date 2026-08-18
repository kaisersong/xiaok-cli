import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKbStoreSqlite } from '../../electron/kb-store-sqlite.js';
import type { KbStore } from '../../electron/kb-store.js';

describe('KbStore stable assistant source identity', () => {
  let rootDir: string;
  let store: KbStore;
  let collectionId: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-kb-assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = createKbStoreSqlite(join(rootDir, 'knowledge.db'));
    collectionId = store.createCollection({ name: 'Assistant', embeddingModelId: 'm', embeddingDim: 384 }).id;
  });

  afterEach(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('returns the existing source for the same stable identity and content', () => {
    const input = {
      sourceId: 'assistant-source:candidate-1',
      clientRequestKey: 'assistant-candidate:candidate-1',
      collectionId,
      kind: 'paste' as const,
      title: '团队知识',
      text: '使用 ADR 记录架构决策。',
      parseStatus: 'pending' as const,
      metadata: {
        assistantCandidateId: 'candidate-1',
        assistantRunId: 'run-1',
        assistantEvidenceRefs: [{ kind: 'task', id: 'task-1' }],
      },
    };

    const first = store.addSource(input, 'user');
    const second = store.addSource(input, 'user');

    expect(first.id).toBe('assistant-source:candidate-1');
    expect(second).toEqual(first);
    expect(store.listSources(collectionId)).toHaveLength(1);
    expect(first.metadata).toMatchObject({
      createdBy: 'user',
      clientRequestKey: 'assistant-candidate:candidate-1',
      assistantCandidateId: 'candidate-1',
      assistantRunId: 'run-1',
      assistantContentDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('fails closed when a stable source id is reused with conflicting provenance or content', () => {
    const base = {
      sourceId: 'assistant-source:candidate-1',
      clientRequestKey: 'assistant-candidate:candidate-1',
      collectionId,
      kind: 'paste' as const,
      title: '团队知识',
      text: '原始内容',
      metadata: { assistantCandidateId: 'candidate-1', assistantRunId: 'run-1' },
    };
    store.addSource(base, 'user');

    expect(() => store.addSource({ ...base, text: '冲突内容' }, 'user'))
      .toThrow('kb_stable_source_conflict');
    expect(() => store.addSource({
      ...base,
      metadata: { assistantCandidateId: 'candidate-2', assistantRunId: 'run-1' },
    }, 'user')).toThrow('kb_stable_source_conflict');
    expect(store.listSources(collectionId)).toHaveLength(1);
  });

  it('fails closed when a client request key points at another source id', () => {
    const base = {
      sourceId: 'assistant-source:candidate-1',
      clientRequestKey: 'assistant-candidate:candidate-1',
      collectionId,
      kind: 'paste' as const,
      title: '团队知识',
      text: '内容',
      metadata: { assistantCandidateId: 'candidate-1', assistantRunId: 'run-1' },
    };
    store.addSource(base, 'user');

    expect(() => store.addSource({ ...base, sourceId: 'assistant-source:other' }, 'user'))
      .toThrow('kb_client_request_key_conflict');
  });

  it('allows stable identity only on the explicit user path', () => {
    expect(() => store.addSource({
      sourceId: 'assistant-source:candidate-1',
      clientRequestKey: 'assistant-candidate:candidate-1',
      collectionId,
      kind: 'paste',
      title: '团队知识',
      text: '内容',
    }, 'agent')).toThrow('kb_stable_source_user_only');
  });
});
