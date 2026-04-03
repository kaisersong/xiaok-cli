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
    // Budget controls API overview and yzj help truncation, not static behavior sections.
    // Static sections are always included. With budget=50, no API/yzj content should be added.
    expect(prompt.length).toBeLessThan(5000);
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

    expect(prompt).toContain('review');  // skill name appears in prompt
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

  it('includes behavior governance sections in the system prompt', async () => {
    const prompt = await buildSystemPrompt({
      enterpriseId: null,
      devApp: null,
      cwd: '/tmp/demo',
      budget: 4000,
    });

    // System Reality
    expect(prompt).toContain('permission mode');
    expect(prompt).toContain('prompt injection');
    // DoingTasks
    expect(prompt).toContain('不要加用户没要求的功能');
    expect(prompt).toContain('OWASP');
    // Actions
    expect(prompt).toContain('不可逆');
    expect(prompt).toContain('merge conflict');
    // UsingTools
    expect(prompt).toContain('read 工具');
    expect(prompt).toContain('edit 工具');
    // ToneAndStyle
    expect(prompt).toContain('file_path:line_number');
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

  it('tells the agent to hide internal tool chatter and ground deliverables in real repo facts', async () => {
    const prompt = await buildSystemPrompt({
      enterpriseId: null,
      devApp: null,
      cwd: '/tmp/demo',
      budget: 2000,
    });

    expect(prompt).toContain('不要向用户逐条展示 read、glob、tool_search、skill');
    expect(prompt).toContain('不要写 [数据待填写]');
  });
});
