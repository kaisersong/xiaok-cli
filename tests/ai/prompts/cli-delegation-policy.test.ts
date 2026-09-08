import { describe, expect, it } from 'vitest';
import { PromptBuilder } from '../../../src/ai/prompts/builder.js';

const base = { cwd: process.cwd(), enterpriseId: null, devApp: null, budget: 12000,
  channel: 'chat' as const, autoContext: { docs: [], git: null } };
const builder = new PromptBuilder({
  memoryStore: { listRelevant: async () => [] } as any,
  harnessMemoryStore: { listActive: () => [] },
});

describe('CLI autonomous delegation policy', () => {
  it('injects an explicit system rule with automatic, self and ask-first decisions', async () => {
    const snapshot = await builder.build({ ...base, cliDelegation: { interactive: true } });
    const policy = snapshot.segments.find((segment) => segment.key === 'tool_policy');
    expect(policy).toMatchObject({ kind: 'system_rule', cacheable: true });
    for (const rule of ['Delegate automatically', 'Do not require the user to mention',
      'Do the work yourself', 'Ask before delegation only', 'Ordinary token usage',
      'Never batch a question with', 'An empty answer', 'spawn_agent, subagent',
      'current stage', 'Only use tools available', 'send_message to your parent']) {
      expect(policy?.text).toContain(rule);
    }
    expect(policy?.text).toContain('before deeply reading every area yourself');
    expect(snapshot.rendered).toContain(policy!.text);
    expect(snapshot.rendered).toContain('AskUserQuestion');
  });

  it('uses a non-interactive fallback without inventing approval', async () => {
    const snapshot = await builder.build({ ...base, cliDelegation: { interactive: false } });
    const policy = snapshot.segments.find((segment) => segment.key === 'tool_policy')!.text;
    expect(policy).toContain('No interactive user input is available');
    expect(policy).toContain('Do not call AskUserQuestion or ask_user');
    expect(policy).toContain('report the missing decision');
    expect(policy).toContain('--auto is a tool permission mode');
  });

  it('preserves user opt-out and ask-first instructions as constraints, not task keywords', async () => {
    const snapshot = await builder.build({ ...base, cliDelegation: { interactive: true },
      autoContext: { docs: [{ name: 'AGENTS.md', path: 'AGENTS.md', content: 'Do not delegate without asking me.', truncated: false }], git: null } });
    const policy = snapshot.segments.find((segment) => segment.key === 'tool_policy')!.text;
    expect(policy).toContain('User instructions to work alone or ask first take precedence');
    expect(policy).toContain('do not switch to another delegation tool');
    expect(policy).toContain('Do not ask again within an already approved scope');
  });

  it('does not enable CLI orchestration for other callers or channels', async () => {
    for (const input of [base, { ...base, channel: 'yzj' as const, cliDelegation: { interactive: true } }]) {
      const snapshot = await builder.build(input);
      expect(snapshot.segments.some((segment) => segment.key === 'tool_policy')).toBe(false);
      expect(snapshot.rendered).not.toContain('# CLI autonomous delegation');
    }
  });

  it('preserves the shared static prefix and keeps the policy outside context truncation', async () => {
    const plain = await builder.build(base);
    const small = await builder.build({ ...base, budget: 1, cliDelegation: { interactive: true } });
    expect(small.segments.find((segment) => segment.key === 'static_identity')?.text)
      .toBe(plain.segments.find((segment) => segment.key === 'static_identity')?.text);
    expect(small.rendered).toContain('Never batch a question with');
  });
});
