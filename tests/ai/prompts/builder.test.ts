import { describe, expect, it } from 'vitest';
import { PromptBuilder } from '../../../src/ai/prompts/builder.js';
import { FileMemoryStore } from '../../../src/ai/memory/store.js';

describe('PromptBuilder', () => {
  it('renders cacheable prompt segments and preserves memory references in the snapshot', async () => {
    const store = new FileMemoryStore('/tmp/xiaok-memory-builder');
    await store.save({
      id: 'mem_project_rules',
      scope: 'project',
      title: 'Project Rules',
      summary: 'Prefer runtime-first refactors.',
      cwd: '/repo',
      tags: ['runtime'],
      updatedAt: 1,
    });

    const builder = new PromptBuilder({ memoryStore: store });
    const snapshot = await builder.build({
      cwd: '/repo',
      enterpriseId: null,
      devApp: null,
      budget: 2000,
      channel: 'chat',
      skills: [],
      deferredTools: [],
      agents: [],
      pluginCommands: [],
      lspDiagnostics: '',
      autoContext: {
        docs: [],
        git: null,
      },
    });

    expect(snapshot.rendered).toContain('Prefer runtime-first refactors.');
    expect(snapshot.memoryRefs).toEqual(['mem_project_rules']);
    expect(snapshot.segments.some((segment) => segment.cacheable)).toBe(true);
  });
});
