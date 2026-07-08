import { describe, expect, it, vi } from 'vitest';
import type { SkillExecutionPlan, SkillPlanStep } from '../../src/ai/skills/planner.js';
import type { SkillInvocationState, SessionSkillExecutionState } from '../../src/ai/skills/execution-state.js';
import { createStrictSkillAdherenceFlow } from '../../src/commands/chat/skill-adherence-flow.js';

function createPlan(overrides: Partial<SkillExecutionPlan> = {}): SkillExecutionPlan {
  const step: SkillPlanStep = {
    name: 'strict-skill',
    description: 'Strict skill',
    path: '/tmp/strict-skill/SKILL.md',
    rootDir: '/tmp/strict-skill',
    source: 'project',
    tier: 'project',
    executionContext: 'inline',
    allowedTools: [],
    dependsOn: [],
    content: '',
    referencesManifest: [],
    scriptsManifest: [],
    assetsManifest: [],
    requiredReferences: [],
    requiredScripts: [],
    requiredSteps: [],
    successChecks: [],
    strict: true,
  };

  return {
    type: 'skill_plan',
    requested: ['strict-skill'],
    resolved: [step],
    strategy: 'inline',
    primarySkill: 'strict-skill',
    strict: true,
    ...overrides,
  };
}

function createInvocation(overrides: Partial<SkillInvocationState> = {}): SkillInvocationState {
  const plan = overrides.plan ?? createPlan();
  return {
    invocationId: 'inv-1',
    sessionId: 'session-1',
    agentId: 'main',
    skillName: plan.primarySkill,
    requested: [...plan.requested],
    strategy: plan.strategy,
    strictMode: plan.strict,
    bundleHash: 'hash',
    status: 'running',
    plan,
    evidence: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createHarness(invocation: SkillInvocationState | undefined) {
  let state: SessionSkillExecutionState = {
    invocations: invocation ? [invocation] : [],
    updatedAt: 1,
  };
  const continuationRunner = {
    runContinuation: vi.fn<Parameters<(input: string) => Promise<string>>, ReturnType<(input: string) => Promise<string>>>(),
  };
  const adherenceStore = {
    record: vi.fn(),
  };
  const writeProgressTranscriptNote = vi.fn();
  const flow = createStrictSkillAdherenceFlow({
    getTrackedInvocation: () => (invocation ? state.invocations.find((item) => item.invocationId === invocation.invocationId) : undefined),
    getInvocationById: (invocationId) => state.invocations.find((item) => item.invocationId === invocationId),
    getSkillExecutionState: () => state,
    setSkillExecutionState: (nextState) => {
      state = nextState;
    },
    continuationRunner,
    adherenceStore,
    writeProgressTranscriptNote,
  });

  return {
    flow,
    continuationRunner,
    adherenceStore,
    writeProgressTranscriptNote,
    getState: () => state,
  };
}

describe('strict skill adherence flow', () => {
  it('returns original assistant text for non-strict invocation without running continuation', async () => {
    const invocation = createInvocation({
      strictMode: false,
      plan: createPlan({ strict: false }),
    });
    const harness = createHarness(invocation);

    const result = await harness.flow.maybeRunStrictCompletionLoop('original answer');

    expect(result).toBe('original answer');
    expect(harness.continuationRunner.runContinuation).not.toHaveBeenCalled();
    expect(harness.adherenceStore.record).not.toHaveBeenCalled();
  });

  it('retries strict continuation at most twice and appends continuation text in order', async () => {
    const step = createPlan().resolved[0]!;
    const invocation = createInvocation({
      plan: createPlan({
        resolved: [{
          ...step,
          successChecks: [{ type: 'must_mention_all', terms: ['done'] }],
        }],
      }),
    });
    const harness = createHarness(invocation);
    harness.continuationRunner.runContinuation
      .mockResolvedValueOnce(' still missing')
      .mockResolvedValueOnce(' done');

    const result = await harness.flow.maybeRunStrictCompletionLoop('start');

    expect(result).toBe('start still missing done');
    expect(harness.continuationRunner.runContinuation).toHaveBeenCalledTimes(2);
    expect(harness.adherenceStore.record).toHaveBeenCalledTimes(1);
    expect(harness.adherenceStore.record.mock.calls[0]?.[1].passed).toBe(true);
    expect(harness.writeProgressTranscriptNote).not.toHaveBeenCalled();
  });

  it('writes one failed progress note with missing reference, script, step, and check labels', async () => {
    const step = createPlan().resolved[0]!;
    const invocation = createInvocation({
      plan: createPlan({
        resolved: [{
          ...step,
          requiredReferences: ['references/required.md'],
          requiredScripts: ['npm test'],
          requiredSteps: ['custom_step'],
          successChecks: [{ type: 'must_mention_all', terms: ['ship-ready'] }],
        }],
      }),
    });
    const harness = createHarness(invocation);
    harness.continuationRunner.runContinuation.mockResolvedValue('');

    const result = await harness.flow.maybeRunStrictCompletionLoop('');

    expect(result).toBe('');
    expect(harness.continuationRunner.runContinuation).toHaveBeenCalledTimes(2);
    expect(harness.adherenceStore.record).toHaveBeenCalledTimes(1);
    expect(harness.adherenceStore.record.mock.calls[0]?.[1].passed).toBe(false);
    expect(harness.writeProgressTranscriptNote).toHaveBeenCalledTimes(1);
    const note = harness.writeProgressTranscriptNote.mock.calls[0]?.[0] ?? '';
    expect(note).toContain('reference:references/required.md');
    expect(note).toContain('script:npm test');
    expect(note).toContain('step:custom_step');
    expect(note).toContain('check:must_mention_all');
  });
});
