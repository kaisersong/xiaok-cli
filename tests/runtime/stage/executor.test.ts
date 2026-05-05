/**
 * Stage Executor Unit Tests
 *
 * Tests:
 * - shouldUseSubagent threshold logic
 * - analyzeIntent keyword matching
 * - extractFilePaths from user input
 * - formatDebugOutput structure
 */

import { describe, it, expect } from 'vitest';
import type { SkillMeta } from '../../../src/ai/skills/loader.js';

// Import the functions we need to test
import {
  shouldUseSubagent,
  analyzeIntent,
  formatDebugOutput,
  type StageDef,
  type StageOutput,
  type StageResult,
  type DebugEvent,
} from '../../../src/runtime/stage/executor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockSkillMeta(partial: Partial<SkillMeta>): SkillMeta {
  return {
    name: 'test-skill',
    description: 'A test skill',
    content: partial.content ?? '',
    path: '/tmp/test-skill/SKILL.md',
    rootDir: '/tmp/test-skill',
    source: 'builtin',
    tier: 'system',
    allowedTools: [],
    executionContext: 'inline',
    dependsOn: [],
    userInvocable: true,
    taskHints: { taskGoals: [], inputKinds: [], outputKinds: [], examples: [] },
    referencesManifest: partial.referencesManifest ?? [],
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

// ---------------------------------------------------------------------------
// Context Threshold Tests
// ---------------------------------------------------------------------------

describe('shouldUseSubagent', () => {
  it('returns true when available tokens < estimated needed', () => {
    // available = 2000, estimated = (14000 + 2000) / 4 + 4000 = 8000
    // 2000 < 8000 → true
    expect(shouldUseSubagent(8000, 10000, 14000, 2000)).toBe(true);
  });

  it('returns false when available > estimated and usage < 60%', () => {
    // available = 7000, estimated = (2000 + 500) / 4 + 4000 = 4625
    // 7000 >= 4625 AND 30% < 60% → false
    expect(shouldUseSubagent(3000, 10000, 2000, 500)).toBe(false);
  });

  it('returns true when usage > 60% even if estimated is small', () => {
    // usage = 70% > 60% → true
    expect(shouldUseSubagent(7000, 10000, 500, 0)).toBe(true);
  });

  it('does not trigger subagent when usage is low (30%)', () => {
    // usage = 30% < 60% → false
    expect(shouldUseSubagent(3000, 10000, 500, 0)).toBe(false);
  });

  it('triggers at exactly 60% threshold', () => {
    // usage = 60% → should be > 60%? No, 0.60 is not > 0.60
    // Let's test 61%
    expect(shouldUseSubagent(6100, 10000, 0, 0)).toBe(true);
  });

  it('does not trigger at 59% with small skill', () => {
    expect(shouldUseSubagent(5900, 10000, 100, 0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Intent Analysis Tests
// ---------------------------------------------------------------------------

describe('analyzeIntent', () => {
  const mockSkills: SkillMeta[] = [
    mockSkillMeta({
      name: 'kai-report-creator',
      description: 'Generate reports from Markdown',
      content: '# Report Creator\nWhen to use: Generate business reports',
      referencesManifest: [],
    }),
    mockSkillMeta({
      name: 'kai-slide-creator',
      description: 'Generate slides from reports',
      content: '# Slide Creator\nWhen to use: Create presentations',
      referencesManifest: [],
    }),
    mockSkillMeta({
      name: 'kai-docx-generator',
      description: 'Generate Word documents',
      content: '# DOCX Generator\nWhen to use: Create Word docs',
      referencesManifest: [],
    }),
  ];

  it('detects report stage from Chinese input', () => {
    const stages = analyzeIntent('生成报告', mockSkills, '/tmp');
    expect(stages).toHaveLength(1);
    expect(stages[0].skill).toBe('kai-report-creator');
  });

  it('detects slides stage from Chinese input', () => {
    const stages = analyzeIntent('生成幻灯片', mockSkills, '/tmp');
    expect(stages).toHaveLength(1);
    expect(stages[0].skill).toBe('kai-slide-creator');
  });

  it('detects multi-stage: report then slides', () => {
    const stages = analyzeIntent('把这个md生成报告，再生成幻灯片', mockSkills, '/tmp');
    expect(stages).toHaveLength(2);
    expect(stages[0].skill).toBe('kai-report-creator');
    expect(stages[1].skill).toBe('kai-slide-creator');
  });

  it('detects multi-stage: report and PPT', () => {
    const stages = analyzeIntent('生成报告和PPT', mockSkills, '/tmp');
    expect(stages).toHaveLength(2);
  });

  it('extracts file paths from input', () => {
    const stages = analyzeIntent('用 /Users/song/projects/plan.md 生成报告', mockSkills, '/tmp');
    expect(stages).toHaveLength(1);
    expect(stages[0].inputFiles).toContain('/Users/song/projects/plan.md');
  });

  it('handles English report keyword', () => {
    const stages = analyzeIntent('generate a report', mockSkills, '/tmp');
    expect(stages).toHaveLength(1);
    expect(stages[0].skill).toBe('kai-report-creator');
  });

  it('handles English slides keyword', () => {
    const stages = analyzeIntent('create slides', mockSkills, '/tmp');
    expect(stages).toHaveLength(1);
    expect(stages[0].skill).toBe('kai-slide-creator');
  });
});

// ---------------------------------------------------------------------------
// Debug Output Tests
// ---------------------------------------------------------------------------

describe('formatDebugOutput', () => {
  it('produces structured output with stage markers', () => {
    const result: StageOutput = {
      stages: [
        { id: '1', title: '生成报告', skill: 'kai-report-creator' },
        { id: '2', title: '生成幻灯片', skill: 'kai-slide-creator' },
      ],
      results: [
        {
          stage: { id: '1', title: '生成报告', skill: 'kai-report-creator' },
          status: 'completed',
          timing: { totalMs: 13500, contextCheckMs: 8, subagentSpawnMs: 23, subagentExecMs: 13450, skillLoadMs: 156, skillExecMs: 13294, artifactReadMs: 0 },
          debugEvents: [],
          contextCheck: { usagePercent: 45, estimatedNeeded: 8000, available: 5500, needsSubagent: false },
        },
        {
          stage: { id: '2', title: '生成幻灯片', skill: 'kai-slide-creator' },
          status: 'completed',
          timing: { totalMs: 8700, contextCheckMs: 6, subagentSpawnMs: 18, subagentExecMs: 8630, skillLoadMs: 89, skillExecMs: 8541, artifactReadMs: 0 },
          debugEvents: [],
          contextCheck: { usagePercent: 48, estimatedNeeded: 4000, available: 5200, needsSubagent: false },
        },
      ],
      debugEvents: [
        { timestamp: Date.now(), phase: 'intent_analysis', detail: 'Detected 2 stages', durationMs: 42, level: 'info' },
      ],
    };

    const output = formatDebugOutput(result);

    expect(output).toContain('[stage:plan]');
    expect(output).toContain('Detected 2 stages');
    expect(output).toContain('[stage:1/2]');
    expect(output).toContain('[stage:2/2]');
    expect(output).toContain('Skill flow completed');
    expect(output).toContain('Context check');
  });

  it('handles failed stage in output', () => {
    const result: StageOutput = {
      stages: [{ id: '1', title: 'test', skill: 'test-skill' }],
      results: [{
        stage: { id: '1', title: 'test', skill: 'test-skill' },
        status: 'failed',
        timing: { totalMs: 0, contextCheckMs: 0, subagentSpawnMs: 0, subagentExecMs: 0, skillLoadMs: 0, skillExecMs: 0, artifactReadMs: 0 },
        debugEvents: [],
        error: 'Skill not found',
      }],
      debugEvents: [],
    };

    const output = formatDebugOutput(result);
    expect(output).toContain('FAILED');
    expect(output).toContain('Skill not found');
  });

  it('handles skipped stage in output', () => {
    const result: StageOutput = {
      stages: [
        { id: '1', title: 'step1', skill: 'test' },
        { id: '2', title: 'step2', skill: 'test' },
      ],
      results: [
        {
          stage: { id: '1', title: 'step1', skill: 'test' },
          status: 'failed',
          timing: { totalMs: 0, contextCheckMs: 0, subagentSpawnMs: 0, subagentExecMs: 0, skillLoadMs: 0, skillExecMs: 0, artifactReadMs: 0 },
          debugEvents: [],
          error: 'error',
        },
        {
          stage: { id: '2', title: 'step2', skill: 'test' },
          status: 'skipped',
          timing: { totalMs: 0, contextCheckMs: 0, subagentSpawnMs: 0, subagentExecMs: 0, skillLoadMs: 0, skillExecMs: 0, artifactReadMs: 0 },
          debugEvents: [],
          error: 'Skipped due to previous stage failure',
        },
      ],
      debugEvents: [],
    };

    const output = formatDebugOutput(result);
    expect(output).toContain('Skipped');
  });
});
