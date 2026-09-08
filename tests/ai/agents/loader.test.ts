import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseAgentFile } from '../../../src/ai/agents/loader.js';

describe('custom agent loader', () => {
  it('parses tools, model and max_iterations', () => {
    const agent = parseAgentFile(
      'reviewer',
      '---\ntools: read,grep\nmodel: claude\nmax_iterations: 5\n---\nYou are a reviewer.',
    );

    expect(agent.allowedTools).toEqual(['read', 'grep']);
    expect(agent.model).toBe('claude');
    expect(agent.maxIterations).toBe(5);
    expect(agent.systemPrompt).toBe('You are a reviewer.');
  });

  it('parses background, isolation, cleanup, and team policy frontmatter', () => {
    const agent = parseAgentFile(
      'planner',
      '---\nbackground: true\nisolation: worktree\ncleanup: delete\nteam: platform\n---\nYou plan tasks.',
    );

    expect(agent.background).toBe(true);
    expect(agent.isolation).toBe('worktree');
    expect(agent.cleanup).toBe('delete');
    expect(agent.team).toBe('platform');
  });
});

 it.each(['explore', 'plan', 'verification'])('bundled %s inherits the runtime budget', name => {
   const agent = parseAgentFile(name, readFileSync(join(process.cwd(), 'data', 'agents', `${name}.md`), 'utf8'));
   expect(agent.maxIterations).toBeUndefined();
 });
