// tests/ai/context/yzj-context.test.ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../../../src/ai/context/yzj-context.js';

describe('buildSystemPrompt', () => {
  it('includes yzj API overview', async () => {
    const prompt = await buildSystemPrompt({ enterpriseId: null, devApp: null, cwd: '/tmp', budget: 4000 });
    expect(prompt).toContain('xiaok');
  });

  it('includes enterprise context when logged in', async () => {
    const prompt = await buildSystemPrompt({ enterpriseId: 'ent_123', devApp: null, cwd: '/tmp', budget: 4000 });
    expect(prompt).toContain('ent_123');
  });

  it('truncates to token budget', async () => {
    const prompt = await buildSystemPrompt({ enterpriseId: null, devApp: null, cwd: '/tmp', budget: 50 });
    expect(prompt.length).toBeLessThan(8000);
  });

  it('resolves successfully when yzj CLI is not installed or times out', async () => {
    const prompt = await buildSystemPrompt({ enterpriseId: 'ent_x', devApp: null, cwd: '/tmp', budget: 4000 });
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('includes builtin skill summary in the system prompt', async () => {
    const prompt = await buildSystemPrompt({
      enterpriseId: null,
      devApp: null,
      cwd: '/tmp/demo',
      budget: 2000,
      skills: [
        {
          name: 'review',
          description: 'review code',
          content: 'Do review',
          path: '/builtin/review.md',
          source: 'builtin',
          tier: 'system',
        },
      ],
    });

    expect(prompt).toContain('review');
  });

  it('instructs the agent to search remote sources before giving up on missing skills', async () => {
    const prompt = await buildSystemPrompt({
      enterpriseId: null,
      devApp: null,
      cwd: '/tmp/demo',
      budget: 2000,
    });

    expect(prompt).toContain('install_skill');
  });

  it('includes 7-layer behavior governance sections', async () => {
    const prompt = await buildSystemPrompt({
      enterpriseId: null,
      devApp: null,
      cwd: '/tmp/demo',
      budget: 4000,
    });

    // Layer 1: Intro (Chinese)
    expect(prompt).toContain('xiaok');
    expect(prompt).toContain('金蝶苍穹');
    // Layer 2: System (English)
    expect(prompt).toContain('permission mode');
    expect(prompt).toContain('prompt injection');
    // Layer 3: DoingTasks (English)
    expect(prompt).toContain('OWASP');
    expect(prompt).toContain('Read existing code before suggesting modifications');
    // Layer 4: Actions (English)
    expect(prompt).toContain('Destructive operations');
    expect(prompt).toContain('merge conflicts');
    // Layer 5: UsingTools (English)
    expect(prompt).toContain('read tool');
    expect(prompt).toContain('edit tool');
    // Layer 6: ToneAndStyle (English)
    expect(prompt).toContain('file_path:line_number');
    // Layer 7: OutputEfficiency (English)
    expect(prompt).toContain('brief and direct');
  });

  it('includes auto-loaded prompt docs and git context in the system prompt', async () => {
    const prompt = await buildSystemPrompt({
      enterpriseId: null,
      devApp: null,
      cwd: '/tmp/demo',
      budget: 2000,
      autoContext: {
        docs: [
          {
            name: 'AGENTS.md',
            path: '/repo/AGENTS.md',
            content: 'workspace rules',
            truncated: false,
          },
        ],
        git: {
          branch: 'feature/runtime',
          isDirty: true,
          recentCommits: ['feat: add prompt cache'],
        },
      },
    });

    expect(prompt).toContain('workspace rules');
    expect(prompt).toContain('feature/runtime');
    expect(prompt).toContain('feat: add prompt cache');
  });

  it('produces static and dynamic sections via renderPromptSections', async () => {
    const { renderPromptSections } = await import('../../../src/ai/context/yzj-context.js');
    const sections = await renderPromptSections({
      enterpriseId: 'ent_test',
      devApp: null,
      cwd: '/tmp/demo',
      budget: 2000,
    });

    expect(sections.length).toBeGreaterThanOrEqual(1);
    expect(sections.length).toBeLessThanOrEqual(2);
    // Static section contains intro
    expect(sections[0]).toContain('xiaok');
    // Dynamic section contains cwd
    if (sections[1]) {
      expect(sections[1]).toContain('/tmp/demo');
    }
  });
});
