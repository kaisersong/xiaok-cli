import { describe, expect, it } from 'vitest';
import { assembleSystemPrompt } from '../../../src/ai/prompts/assembler.js';

const input = {
  cwd: process.cwd(), enterpriseId: null, devApp: null, budget: 12000,
  channel: 'chat' as const, autoContext: { docs: [], git: null },
};

describe('system prompt contract', () => {
  it('keeps the common policy compact without forcing tool-only acknowledgments', async () => {
    const prompt = await assembleSystemPrompt(input);
    expect(prompt.staticText.length).toBeLessThanOrEqual(9000);
    expect(prompt.rendered).not.toMatch(/CRITICAL RULE|FIRST OUTPUT MUST|APPROVAL RESPONSE PROTOCOL|first output MUST be a tool call/i);
    expect(prompt.staticText).toMatch(/approval.*execute|execute.*approval/i);
    expect(prompt.staticText).toMatch(/progress|status update/i);
  });

  it('preserves authorization, denial, source protection and evidence boundaries', async () => {
    const { staticText } = await assembleSystemPrompt(input);
    expect(staticText).toMatch(/authoriz.*scope|scope.*authoriz/i);
    expect(staticText).toMatch(/deni(?:al|ed).*another tool|another tool.*deni(?:al|ed)/i);
    expect(staticText).toContain('Never choose an output path that is identical');
    expect(staticText).toMatch(/unrelated.*changes|changes.*unrelated/i);
    expect(staticText).toContain('Verify before claiming success');
    expect(staticText).toMatch(/not (?:run|verified)|unverified/i);
  });

  it('does not inject a second execution protocol based on approval keywords', async () => {
    const plain = await assembleSystemPrompt(input);
    const approved = await assembleSystemPrompt({ ...input, lastAssistantMessage: '方案已完成', lastUserMessage: '好的' });
    expect(approved.rendered).toBe(plain.rendered);
  });

  it('keeps runtime restrictions and delegated policy intact even with a tiny context budget', async () => {
    const prompt = await assembleSystemPrompt({ ...input, budget: 1,
      cliDelegation: { interactive: false }, permissionMode: 'plan', allowedToolsActive: ['Read', 'Grep'],
      mcpInstructions: 'MCP_POLICY_SENTINEL',
    });
    expect(prompt.rendered).toContain('Current permission mode: plan');
    expect(prompt.rendered).toContain('only Read, Grep');
    expect(prompt.rendered).toContain('MCP_POLICY_SENTINEL');
    expect(prompt.rendered).toContain('Do not call AskUserQuestion or ask_user');
    expect(prompt.rendered).toContain('resourcesReleased/cleanupPending');
    expect(prompt.rendered).not.toContain('use AskUserQuestion to ask them');
  });
});
