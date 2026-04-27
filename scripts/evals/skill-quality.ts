import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { validateSkillFile } from '../../src/ai/skills/quality.js';

type EvalCase = {
  id: string;
  fixture: string;
  expectOk: boolean;
  expectErrors?: string[];
  expectWarnings?: string[];
};

type EvalFixture = {
  cases: EvalCase[];
};

type EvalFailure = {
  id: string;
  message: string;
};

function loadFixture(): EvalFixture {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'evals/skill-quality.cases.json'), 'utf8'),
  ) as EvalFixture;
}

async function runCase(testCase: EvalCase): Promise<EvalFailure | null> {
  const rootDir = mkdtempSync(join(tmpdir(), `xiaok-skill-quality-eval-${testCase.id}-`));
  const configDir = join(rootDir, 'config');
  const projectDir = join(rootDir, 'project');
  const skillDir = join(projectDir, '.xiaok', 'skills', testCase.fixture);
  const fixturePath = resolve(process.cwd(), 'evals', 'skill-quality-fixtures', testCase.fixture, 'SKILL.md');
  const skillPath = join(skillDir, 'SKILL.md');

  try {
    mkdirSync(configDir, { recursive: true });
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(skillPath, readFileSync(fixturePath, 'utf8'));

    const result = await validateSkillFile(skillPath, {
      cwd: projectDir,
      xiaokConfigDir: configDir,
      builtinRoots: [],
    });

    if (result.ok !== testCase.expectOk) {
      return {
        id: testCase.id,
        message: `expected ok=${testCase.expectOk}, got ok=${result.ok}`,
      };
    }

    const errorCodes = new Set(result.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code));
    const warningCodes = new Set(result.issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.code));

    for (const code of testCase.expectErrors ?? []) {
      if (!errorCodes.has(code)) {
        return {
          id: testCase.id,
          message: `expected error code ${code}, got [${[...errorCodes].join(', ')}]`,
        };
      }
    }

    for (const code of testCase.expectWarnings ?? []) {
      if (!warningCodes.has(code)) {
        return {
          id: testCase.id,
          message: `expected warning code ${code}, got [${[...warningCodes].join(', ')}]`,
        };
      }
    }

    return null;
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const fixture = loadFixture();
  const failures: EvalFailure[] = [];

  for (const testCase of fixture.cases) {
    const failure = await runCase(testCase);
    if (failure) {
      failures.push(failure);
    }
  }

  console.log('Skill Quality Eval');
  console.log('');

  if (failures.length === 0) {
    console.log(`PASS skill-quality: ${fixture.cases.length}/${fixture.cases.length}`);
    console.log('');
    console.log(`All structured skill-quality checks passed (${fixture.cases.length}/${fixture.cases.length}).`);
    return;
  }

  console.log(`FAIL skill-quality: ${fixture.cases.length - failures.length}/${fixture.cases.length}`);
  console.log('');
  console.log('Failures:');
  for (const failure of failures) {
    console.log(`- [skill-quality] ${failure.id}: ${failure.message}`);
  }
  process.exitCode = 1;
}

void main().catch((error) => {
  console.error('Skill Quality Eval configuration error');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
