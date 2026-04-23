import { describe, expect, it } from 'vitest';
import { PromptBuilder } from '../../../src/ai/prompts/builder.js';

describe('intent delegation prompt section', () => {
  it('replaces task-delivery text with intent/delegation supervision rules', async () => {
    const builder = new PromptBuilder();
    const snapshot = await builder.build({
      cwd: '/test/workspace',
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

    expect(snapshot.rendered).not.toContain('Treat each substantial business request as a task');
    expect(snapshot.rendered).not.toContain('Use the task tools to keep the current task state accurate');
    expect(snapshot.rendered).toContain('Treat each substantial request as an intent');
    expect(snapshot.rendered).toContain('delegation boundary');
    expect(snapshot.rendered).toContain('one active step at a time');
    expect(snapshot.rendered).toContain('run contract');
    expect(snapshot.rendered).toContain('receipt');
    expect(snapshot.rendered).toContain('salvage');
    expect(snapshot.rendered).toContain('authoritative source inputs');
    expect(snapshot.rendered).toContain('Never choose an output path that is identical');
  });
});
