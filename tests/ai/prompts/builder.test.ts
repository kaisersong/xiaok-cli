import { readFileSync, rmSync } from 'node:fs';
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

  it('does not inject yzj domain docs into generic chat prompts by default', async () => {
    const builder = new PromptBuilder();
    const snapshot = await builder.build({
      cwd: '/repo',
      enterpriseId: null,
      devApp: null,
      budget: 4000,
      channel: 'chat',
      skills: [],
      deferredTools: [],
      agents: [],
      pluginCommands: [],
      lspDiagnostics: '',
      autoContext: { docs: [], git: null },
    });

    expect(snapshot.rendered).not.toContain('云之家开放平台 API 概览');
    expect(snapshot.rendered).not.toContain('## yzj CLI usage');
  });

  it('gates yzj domain injection on channel or explicit relevance instead of forcing it globally', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'ai', 'prompts', 'assembler.ts'), 'utf8');

    expect(source).toContain('function shouldInjectYzjContext');
    expect(source).toContain("opts.channel === 'yzj'");
    expect(source).toContain('includeYzjContext');
  });

  it('marks memory summaries as fenced background memory in both segment metadata and rendered prompt', async () => {
    const rootDir = join(tmpdir(), `xiaok-memory-fence-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      const store = new FileMemoryStore(rootDir);
      await store.save({
        id: 'mem_background_rules',
        scope: 'project',
        title: 'Background Rules',
        summary: 'Always validate in tmux before landing terminal UI changes.',
        cwd: '/repo',
        tags: ['terminal'],
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
        autoContext: { docs: [], git: null },
      });

      const memorySegment = snapshot.segments.find((segment) => segment.key === 'memory_summary');

      expect(memorySegment).toEqual(expect.objectContaining({
        kind: 'background_context',
        title: 'Background Memory',
      }));
      expect(snapshot.rendered).toContain('Background memory');
      expect(snapshot.rendered).toContain('Always validate in tmux before landing terminal UI changes.');
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('marks auto-loaded repository docs as fenced workspace context instead of generic dynamic context', async () => {
    const builder = new PromptBuilder();
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
        docs: [{
          name: 'AGENTS.md',
          path: '/repo/AGENTS.md',
          content: 'Keep terminal regressions covered by focused tmux tests.',
          truncated: false,
        }],
        git: null,
      },
    });

    const workspaceSegment = snapshot.segments.find((segment) => segment.text.includes('Keep terminal regressions covered'));

    expect(workspaceSegment).toEqual(expect.objectContaining({
      kind: 'background_context',
      title: 'Workspace Context',
    }));
    expect(snapshot.rendered).toContain('Workspace context');
    expect(snapshot.rendered).toContain('Keep terminal regressions covered by focused tmux tests.');
  });

  it('should include decomposition section in static prefix', async () => {
    const builder = new PromptBuilder();
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
      autoContext: { docs: [], git: null },
    });

    const staticSegment = snapshot.segments.find((s) => s.key === 'static_identity');
    expect(staticSegment?.text).toContain('Always decompose before you act');
    expect(staticSegment?.text).toContain('PREVIEW');
    expect(staticSegment?.text).toContain('CHUNK');
    expect(staticSegment?.text).toContain('RECURSIVE');
  });

  it('should include verification section in static prefix', async () => {
    const builder = new PromptBuilder();
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
      autoContext: { docs: [], git: null },
    });

    const staticSegment = snapshot.segments.find((s) => s.key === 'static_identity');
    expect(staticSegment?.text).toContain('Verify before claiming success');
    expect(staticSegment?.text).toContain('Check stdout');
    expect(staticSegment?.text).toContain('Check stderr');
  });

  it('should include parallel execution section in static prefix', async () => {
    const builder = new PromptBuilder();
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
      autoContext: { docs: [], git: null },
    });

    const staticSegment = snapshot.segments.find((s) => s.key === 'static_identity');
    expect(staticSegment?.text).toContain('Parallel-first');
    expect(staticSegment?.text).toContain('Multiple independent file reads');
    expect(staticSegment?.text).toContain('Dependent operations MUST be sequential');
  });
});
