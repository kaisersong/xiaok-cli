// tests/ai/context/yzj-context.test.ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../../../src/ai/context/yzj-context.js';

describe('buildSystemPrompt', () => {
  it('does not force yzj API context into generic chat prompts', async () => {
    const prompt = await buildSystemPrompt({ enterpriseId: null, devApp: null, cwd: '/tmp', budget: 4000 });
    expect(prompt).toContain('xiaok');
    expect(prompt).not.toContain('云之家开放平台 API 概览');
  });

  it('includes enterprise context when logged in', async () => {
    const prompt = await buildSystemPrompt({ enterpriseId: 'ent_123', devApp: null, cwd: '/tmp', budget: 4000 });
    expect(prompt).toContain('ent_123');
  });

  it('still returns the core prompt when the token budget is tiny', async () => {
    const prompt = await buildSystemPrompt({ enterpriseId: null, devApp: null, cwd: '/tmp', budget: 50 });
    expect(typeof prompt).toBe('string');
    expect(prompt).toContain('xiaok');
    expect(prompt.length).toBeGreaterThan(1000);
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

  it('includes shared execution, authorization and verification rules through the legacy builder', async () => {
    const prompt = await buildSystemPrompt({
      enterpriseId: null,
      devApp: null,
      cwd: '/tmp/demo',
      budget: 4000,
    });

    expect(prompt).toContain('xiaok');
    expect(prompt).toContain('执行协作者');
    expect(prompt).toContain('permission mode');
    expect(prompt).toContain('untrusted content');
    expect(prompt).toContain('Read the relevant code or source material');
    expect(prompt).toContain('destructive or hard-to-reverse');
    expect(prompt).toContain('Never overwrite unrelated work');
    expect(prompt).toContain('To read files use Read');
    expect(prompt).toContain('edit with Edit');
    expect(prompt).toContain('file_path:line_number');
    expect(prompt).toContain('Verify before claiming success');
    expect(prompt).toContain('final response self-contained');
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
