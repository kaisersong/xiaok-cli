import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PromptBuilder } from '../../../src/ai/prompts/builder.js';
import { FileMemoryStore } from '../../../src/ai/memory/store.js';

describe('PromptBuilder', () => {
  it('renders cacheable prompt segments and preserves memory references in the snapshot', async () => {
    const rootDir = join(tmpdir(), `xiaok-memory-builder-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      const store = new FileMemoryStore(rootDir);
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
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

describe('PromptBuilder static/dynamic split', () => {
  it('produces a static_identity segment and a dynamic_context segment', async () => {
    const builder = new PromptBuilder();
    const snapshot = await builder.build({
      cwd: '/repo',
      enterpriseId: 'ent_123',
      devApp: null,
      budget: 2000,
      channel: 'chat',
      skills: [],
      deferredTools: [],
      agents: [],
      pluginCommands: [],
      lspDiagnostics: '',
      autoContext: { docs: [], git: null },
    });

    const keys = snapshot.segments.map((s) => s.key);
    expect(keys).toContain('static_identity');
    expect(keys).toContain('dynamic_context');

    const staticSeg = snapshot.segments.find((s) => s.key === 'static_identity')!;
    const dynamicSeg = snapshot.segments.find((s) => s.key === 'dynamic_context')!;

    expect(staticSeg.cacheable).toBe(true);
    expect(dynamicSeg.cacheable).toBe(false);
    expect(dynamicSeg.text).toContain('/repo');
    expect(dynamicSeg.text).toContain('ent_123');
    expect(staticSeg.text).not.toContain('/repo');
  });
});
