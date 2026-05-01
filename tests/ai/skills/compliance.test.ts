import { describe, expect, it } from 'vitest';
import { evaluateSkillCompliance, buildComplianceReminder } from '../../../src/ai/skills/compliance.js';
import { buildSkillExecutionPlan } from '../../../src/ai/skills/planner.js';
import type { SkillMeta } from '../../../src/ai/skills/loader.js';

function makeSkill(overrides: Partial<SkillMeta> = {}): SkillMeta {
  return {
    name: 'release-checklist',
    description: 'release helper',
    content: 'content',
    path: '/tmp/release-checklist/SKILL.md',
    rootDir: '/tmp/release-checklist',
    source: 'project',
    tier: 'project',
    allowedTools: [],
    executionContext: 'inline',
    dependsOn: [],
    userInvocable: true,
    taskHints: {
      taskGoals: [],
      inputKinds: [],
      outputKinds: [],
      examples: [],
    },
    referencesManifest: [],
    scriptsManifest: [],
    assetsManifest: [],
    requiredReferences: ['references/principles.md'],
    requiredScripts: ['python scripts/check_release.py --mode smoke'],
    requiredSteps: ['read_skill', 'read_required_references', 'run_required_scripts', 'summarize_findings'],
    successChecks: [
      { type: 'must_mention_all', terms: ['ready', 'blockers'] },
      { type: 'must_answer_yes_no', terms: ['ready'] },
    ],
    strict: true,
    ...overrides,
  };
}

describe('skill compliance', () => {
  it('fails when required references, scripts, or success checks are missing', () => {
    const plan = buildSkillExecutionPlan(['release-checklist'], [makeSkill()]);
    const result = evaluateSkillCompliance({
      plan,
      evidence: {
        readReferences: [],
        runScripts: [],
        completedSteps: ['read_skill'],
      },
      finalAnswer: 'I reviewed the branch.',
      checkedAt: 123,
    });

    expect(result.passed).toBe(false);
    expect(result.missingReferences).toEqual(['references/principles.md']);
    expect(result.missingScripts).toEqual(['python scripts/check_release.py --mode smoke']);
    expect(result.missingSteps).toEqual(expect.arrayContaining([
      'read_required_references',
      'run_required_scripts',
    ]));
    expect(result.failedChecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'must_mention_all' }),
      expect.objectContaining({ type: 'must_answer_yes_no' }),
    ]));
  });

  it('passes when evidence and final answer satisfy the strict contract', () => {
    const plan = buildSkillExecutionPlan(['release-checklist'], [makeSkill()]);
    const result = evaluateSkillCompliance({
      plan,
      evidence: {
        readReferences: ['references/principles.md'],
        runScripts: ['python scripts/check_release.py --mode smoke'],
        completedSteps: ['read_skill', 'read_required_references', 'run_required_scripts', 'summarize_findings'],
      },
      finalAnswer: [
        'ready: yes',
        'blockers: none',
        'The branch is ready to ship.',
      ].join('\n'),
      checkedAt: 456,
    });

    expect(result.passed).toBe(true);
    expect(result.missingReferences).toEqual([]);
    expect(result.missingScripts).toEqual([]);
    expect(result.missingSteps).toEqual([]);
    expect(result.failedChecks).toEqual([]);
  });

  it('fails when custom required steps have no execution evidence', () => {
    const plan = buildSkillExecutionPlan(['release-checklist'], [makeSkill({
      requiredSteps: [
        'read_skill',
        'create_brief_json',
        'render_from_brief',
        'validate_artifact',
        'summarize_findings',
      ],
      requiredScripts: [],
    })]);
    const result = evaluateSkillCompliance({
      plan,
      evidence: {
        readReferences: ['references/principles.md'],
        runScripts: [],
        completedSteps: ['read_skill', 'summarize_findings'],
      },
      finalAnswer: 'ready: yes\nblockers: none',
      checkedAt: 789,
    });

    expect(result.passed).toBe(false);
    expect(result.missingSteps).toEqual([
      'create_brief_json',
      'render_from_brief',
      'validate_artifact',
    ]);
  });

  it('builds a continuation reminder from failed checks', () => {
    const reminder = buildComplianceReminder({
      passed: false,
      missingReferences: ['references/principles.md'],
      missingScripts: ['python scripts/check_release.py --mode smoke'],
      missingSteps: ['run_required_scripts'],
      failedChecks: [{ type: 'must_answer_yes_no', terms: ['ready'], passed: false }],
      checkedAt: 1,
    });

    expect(reminder).toContain('Missing required references');
    expect(reminder).toContain('Missing required scripts');
    expect(reminder).toContain('Failed success checks');
  });
});
