import { beforeAll, describe, expect, it } from 'vitest';
import { PromptBuilder } from '../../src/ai/prompts/builder.js';

// Prompt injection contracts; these do not measure a live model's adherence.
describe('Agent autonomy prompt integration', () => {
  let prompt: string;
  beforeAll(async () => {
    prompt = (await new PromptBuilder({
      memoryStore: { listRelevant: async () => [] }, harnessMemoryStore: { listActive: () => [] },
    }).build({ cwd: process.cwd(), enterpriseId: null, devApp: null, budget: 4000,
      channel: 'chat', autoContext: { docs: [], git: null },
    })).rendered;
  });

  it('acts on approved scope while keeping the user informed', () => {
    expect(prompt).toContain('instructions to execute');
    expect(prompt).toContain('authorized scope');
    expect(prompt).toContain('Do not ask again');
    expect(prompt).toContain('progress');
    expect(prompt).not.toContain('ZERO text');
  });

  it('retains diagnosis, interaction, dependency and verification boundaries', () => {
    expect(prompt).toContain('Diagnose failures');
    expect(prompt).toContain('genuine interactive input');
    expect(prompt).toContain('independent tool calls in parallel');
    expect(prompt).toContain('dependent operations sequentially');
    expect(prompt).toContain('Verify before claiming success');
    expect(prompt).toContain('stdout/stderr');
    expect(prompt).toContain('not verified');
  });
});
