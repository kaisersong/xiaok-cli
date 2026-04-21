import { describe, expect, it } from 'vitest';
import { PromptBuilder } from '../../../src/ai/prompts/builder.js';

describe('task delivery prompt section', () => {
  it('injects task-delivery instructions into the system prompt', async () => {
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

    expect(snapshot.rendered).toContain('Treat each substantial business request as a task');
    expect(snapshot.rendered).toContain('keep repairing until the requested deliverable exists');
  });
});
