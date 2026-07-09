import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillMeta } from '../../../src/ai/skills/loader.js';

const checkpointMocks = vi.hoisted(() => ({
  captureCheckpoint: vi.fn(),
  diffCheckpoints: vi.fn(),
}));

const subagentMocks = vi.hoisted(() => ({
  executeNamedSubAgent: vi.fn(),
}));

vi.mock('../../../src/runtime/snapshot/checkpoint.js', () => checkpointMocks);
vi.mock('../../../src/ai/agents/subagent-executor.js', () => subagentMocks);

import { executeStagedSkill, type StageExecutorDeps } from '../../../src/runtime/stage/executor.js';

function mockSkillMeta(partial: Partial<SkillMeta>): SkillMeta {
  return {
    name: 'kai-report-creator',
    description: 'Generate reports',
    content: '# Report Creator',
    path: '/tmp/skill/SKILL.md',
    rootDir: '/tmp/skill',
    source: 'builtin',
    tier: 'system',
    allowedTools: [],
    executionContext: 'inline',
    dependsOn: [],
    userInvocable: true,
    taskHints: { taskGoals: [], inputKinds: [], outputKinds: [], examples: [] },
    referencesManifest: [],
    scriptsManifest: [],
    assetsManifest: [],
    requiredReferences: [],
    requiredScripts: [],
    requiredSteps: [],
    successChecks: [],
    strict: false,
    ...partial,
  };
}

function createDeps(): StageExecutorDeps {
  return {
    adapter: () => ({
      getModelName: () => 'test-model',
      stream: async function* () {
        yield { type: 'done' as const };
      },
    }),
    createRegistry: () => ({
      getToolDefinitions: () => [],
      executeTool: async () => 'ok',
    }) as any,
    buildSystemPrompt: async () => 'system prompt',
    skills: [mockSkillMeta({})],
    sessionId: 'sess_1',
    cwd: '/tmp/project',
    contextLimit: 200_000,
    currentTokens: 1000,
  };
}

describe('executeStagedSkill checkpoint integration', () => {
  beforeEach(() => {
    checkpointMocks.captureCheckpoint.mockReset();
    checkpointMocks.diffCheckpoints.mockReset();
    subagentMocks.executeNamedSubAgent.mockReset();

    checkpointMocks.captureCheckpoint.mockImplementation(async (_cwd, sessionId, stageId, boundary) => ({
      id: `${sessionId}-${stageId}-${boundary}`,
      sessionId,
      stageId,
      boundary,
      method: 'file-copy',
      ref: `/tmp/${boundary}`,
      files: boundary === 'stage-start' ? { 'report.md': 'old' } : { 'report.md': 'new' },
      capturedAt: '2026-06-30T00:00:00.000Z',
    }));
    checkpointMocks.diffCheckpoints.mockResolvedValue([{ path: 'report.md', status: 'modified' }]);
    subagentMocks.executeNamedSubAgent.mockResolvedValue('ok');
  });

  it('captures stage-start and stage-end around a completed stage', async () => {
    const result = await executeStagedSkill('生成报告', createDeps());

    expect(result.results[0].status).toBe('completed');
    expect(checkpointMocks.captureCheckpoint).toHaveBeenNthCalledWith(
      1,
      '/tmp/project',
      'sess_1',
      '1',
      'stage-start',
    );
    expect(checkpointMocks.captureCheckpoint).toHaveBeenNthCalledWith(
      2,
      '/tmp/project',
      'sess_1',
      '1',
      'stage-end',
    );
  });

  it('captures stage-end and reports a revert hint when a stage fails after changing files', async () => {
    subagentMocks.executeNamedSubAgent.mockRejectedValue(new Error('stage failed'));

    const result = await executeStagedSkill('生成报告', createDeps());

    expect(result.results[0].status).toBe('failed');
    expect(checkpointMocks.captureCheckpoint).toHaveBeenCalledWith('/tmp/project', 'sess_1', '1', 'stage-start');
    expect(checkpointMocks.captureCheckpoint).toHaveBeenCalledWith('/tmp/project', 'sess_1', '1', 'stage-end');
    expect(checkpointMocks.diffCheckpoints).toHaveBeenCalled();
    expect(result.debugEvents.some((event) => (
      event.level === 'warn' &&
      event.detail.includes('1 files modified') &&
      event.detail.includes('xiaok revert sess_1-1-stage-start')
    ))).toBe(true);
  });
});
