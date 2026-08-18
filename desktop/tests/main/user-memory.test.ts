import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UserMemoryStore } from '../../electron/user-memory.js';

describe('UserMemoryStore assistant fallback contract', () => {
  let rootDir: string;
  let store: UserMemoryStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-user-memory-assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = new UserMemoryStore(rootDir);
  });

  afterEach(() => rmSync(rootDir, { recursive: true, force: true }));

  it('preserves the supplied stable identity and assistant provenance across a reload', () => {
    store.save({
      id: 'assistant-memory:candidate-1', content: '项目只用中文。', tags: ['language'], createdAt: 1,
      scope: 'project', cwd: '/workspace/project-a', type: 'project',
      provenance: { kind: 'assistant_candidate', candidateId: 'candidate-1', runId: 'run-1' },
    });

    const reloaded = new UserMemoryStore(rootDir);
    expect(reloaded.getById('assistant-memory:candidate-1')).toMatchObject({
      id: 'assistant-memory:candidate-1', scope: 'project', cwd: '/workspace/project-a', type: 'project',
      provenance: { kind: 'assistant_candidate', candidateId: 'candidate-1', runId: 'run-1' },
    });
    expect(reloaded.listRelevant({ cwd: '/workspace/other', query: '' })).toEqual([]);
    expect(reloaded.listRelevant({ cwd: '/workspace/project-a', query: '' })).toHaveLength(1);
  });

  it('evicts ordinary legacy records before assistant provenance records and fails closed when only protected entries remain', () => {
    store.save({
      id: 'assistant-memory:protected', content: '保护记录', tags: [], createdAt: 1, scope: 'global',
      provenance: { kind: 'assistant_candidate', candidateId: 'candidate-protected', runId: 'run-1' },
    });
    for (let index = 0; index < 500; index += 1) {
      store.save({ id: `legacy-${index}`, content: `legacy ${index}`, tags: [], createdAt: index + 2, scope: 'global' });
    }

    expect(store.getById('assistant-memory:protected')).toBeDefined();
    expect(store.getById('legacy-0')).toBeUndefined();
  });
});
