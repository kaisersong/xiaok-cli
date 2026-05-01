import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateSkillCompliance } from '../../src/ai/skills/compliance.js';
import { buildSkillExecutionPlan } from '../../src/ai/skills/planner.js';
import type { SkillMeta } from '../../src/ai/skills/loader.js';

type EvalCase = {
  id: string;
  skill?: 'release-audit' | 'artifact-deck';
  expectPassed: boolean;
  expectMissingReferences?: string[];
  expectMissingScripts?: string[];
  expectMissingSteps?: string[];
  expectFailedChecks?: string[];
  evidence: {
    readReferences: string[];
    runScripts: string[];
    completedSteps: string[];
  };
  finalAnswer: string;
};

type EvalFixture = {
  cases: EvalCase[];
};

function makeReleaseAuditSkill(): SkillMeta {
  return {
    name: 'release-audit',
    description: 'release audit helper',
    content: 'content',
    path: '/tmp/release-audit/SKILL.md',
    rootDir: '/tmp/release-audit',
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
    requiredReferences: ['references/principles.md', 'references/ship-criteria.md'],
    requiredScripts: [
      'python scripts/check_release.py --mode smoke',
      'python scripts/check_release.py --mode policy',
    ],
    requiredSteps: ['read_skill', 'read_required_references', 'run_required_scripts', 'summarize_findings'],
    successChecks: [
      { type: 'must_emit_field', terms: ['ready', 'blockers'] },
      { type: 'must_answer_yes_no', terms: ['ready'] },
      { type: 'must_mention_any', terms: ['ship', 'rollback'] },
    ],
    strict: true,
  };
}

function makeArtifactDeckSkill(): SkillMeta {
  return {
    name: 'artifact-deck',
    description: 'high-quality deck artifact helper',
    content: 'content',
    path: '/tmp/artifact-deck/SKILL.md',
    rootDir: '/tmp/artifact-deck',
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
    requiredReferences: ['references/data-story.md'],
    requiredScripts: ['node scripts/render_from_brief.js --brief BRIEF.json --style data-story'],
    requiredSteps: [
      'read_skill',
      'create_brief_json',
      'render_from_brief',
      'validate_artifact',
      'summarize_findings',
    ],
    successChecks: [
      { type: 'must_emit_field', terms: ['brief', 'composition_routes', 'watermark', 'validation'] },
      { type: 'must_mention_all', terms: ['data-story', 'watermark'] },
    ],
    strict: true,
  };
}

function loadFixture(): EvalFixture {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'evals/skill-adherence.release.cases.json'), 'utf8'),
  ) as EvalFixture;
}

async function main(): Promise<void> {
  const fixture = loadFixture();
  const releaseAuditPlan = buildSkillExecutionPlan(['release-audit'], [makeReleaseAuditSkill()]);
  const artifactDeckPlan = buildSkillExecutionPlan(['artifact-deck'], [makeArtifactDeckSkill()]);
  const failures: string[] = [];

  for (const testCase of fixture.cases) {
    const plan = testCase.skill === 'artifact-deck' ? artifactDeckPlan : releaseAuditPlan;
    const result = evaluateSkillCompliance({
      plan,
      evidence: testCase.evidence,
      finalAnswer: testCase.finalAnswer,
      checkedAt: 1,
    });

    if (result.passed !== testCase.expectPassed) {
      failures.push(`[skill-adherence-release] ${testCase.id}: expected passed=${testCase.expectPassed}, got ${result.passed}`);
      continue;
    }

    for (const expectedReference of testCase.expectMissingReferences ?? []) {
      if (!result.missingReferences.includes(expectedReference)) {
        failures.push(`[skill-adherence-release] ${testCase.id}: missing expected reference ${expectedReference}`);
      }
    }
    for (const expectedScript of testCase.expectMissingScripts ?? []) {
      if (!result.missingScripts.includes(expectedScript)) {
        failures.push(`[skill-adherence-release] ${testCase.id}: missing expected script ${expectedScript}`);
      }
    }
    for (const expectedStep of testCase.expectMissingSteps ?? []) {
      if (!result.missingSteps.includes(expectedStep)) {
        failures.push(`[skill-adherence-release] ${testCase.id}: missing expected step ${expectedStep}`);
      }
    }
    for (const expectedCheck of testCase.expectFailedChecks ?? []) {
      if (!result.failedChecks.some((check) => check.type === expectedCheck)) {
        failures.push(`[skill-adherence-release] ${testCase.id}: missing expected failed check ${expectedCheck}`);
      }
    }
  }

  console.log('Skill Adherence Release Eval');
  console.log('');
  if (failures.length === 0) {
    console.log(`PASS skill-adherence-release: ${fixture.cases.length}/${fixture.cases.length}`);
    return;
  }

  console.log(`FAIL skill-adherence-release: ${fixture.cases.length - failures.length}/${fixture.cases.length}`);
  console.log('');
  console.log('Failures:');
  for (const failure of failures) {
    console.log(`- ${failure}`);
  }
  process.exitCode = 1;
}

void main().catch((error) => {
  console.error('Skill Adherence Release Eval configuration error');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
