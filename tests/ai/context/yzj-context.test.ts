// tests/ai/context/yzj-context.test.ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../../../src/ai/context/yzj-context.js';

describe('buildSystemPrompt', () => {
  it('includes yzj API overview', async () => {
    const prompt = await buildSystemPrompt({ enterpriseId: null, devApp: null, cwd: '/tmp', budget: 4000 });
    expect(prompt).toContain('云之家');
  });

  it('includes enterprise context when logged in', async () => {
    const prompt = await buildSystemPrompt({ enterpriseId: 'ent_123', devApp: null, cwd: '/tmp', budget: 4000 });
    expect(prompt).toContain('ent_123');
  });

  it('truncates to token budget', async () => {
    const prompt = await buildSystemPrompt({ enterpriseId: null, devApp: null, cwd: '/tmp', budget: 50 });
    // rough estimate: 50 tokens ≈ 200 chars
    expect(prompt.length).toBeLessThan(1000);
  });

  it('resolves successfully when yzj CLI is not installed or times out', async () => {
    // spawnSync returns non-zero when yzj is not found; buildSystemPrompt should not throw
    const prompt = await buildSystemPrompt({ enterpriseId: 'ent_x', devApp: null, cwd: '/tmp', budget: 4000 });
    // Should still contain the base API overview even if yzj help loading failed
    expect(prompt).toContain('云之家');
    expect(typeof prompt).toBe('string');
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

    expect(prompt).toContain('默认 Skills');
    expect(prompt).toContain('/review');
  });

  it('instructs the agent to search remote sources before giving up on missing skills', async () => {
    const prompt = await buildSystemPrompt({
      enterpriseId: null,
      devApp: null,
      cwd: '/tmp/demo',
      budget: 2000,
    });

    expect(prompt).toContain('web_search');
    expect(prompt).toContain('web_fetch');
    expect(prompt).toContain('install_skill');
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

    expect(prompt).toContain('仓库提示文档');
    expect(prompt).toContain('workspace rules');
    expect(prompt).toContain('Git 上下文');
    expect(prompt).toContain('feature/runtime');
    expect(prompt).toContain('feat: add prompt cache');
  });
});
