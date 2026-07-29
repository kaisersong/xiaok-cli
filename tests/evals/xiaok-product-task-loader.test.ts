import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

async function loadModule(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/xiaok-product/task-loader.mjs',
  )).href);
}

function validReportTask(overrides: Record<string, unknown> = {}): any {
  return {
    taskId: 'prod:report:sample-01',
    category: 'report',
    title: '生成一份示例报告',
    artifactSystem: 'A',
    turns: [{ ordinal: 1, prompt: '写一份报告' }],
    expectations: {
      artifactType: 'report',
      mustExist: true,
      artifactMatch: { kindAnyOf: ['text', 'html'], extensionAnyOf: ['.md', '.html'] },
      structure: { minSections: 2, requiredSectionKeywords: ['结论'], minChars: 100 },
      projectCreatedOnly: false,
      forbiddenAgentTools: ['scheduled_task_cancel'],
    },
    timeoutMs: 600000,
    passK: 3,
    ...overrides,
  };
}

describe('xiaok-product task loader', () => {
  it('accepts a valid System A report task', async () => {
    const { validateTask } = await loadModule();
    const task = validateTask(validReportTask());
    expect(task.taskId).toBe('prod:report:sample-01');
    expect(task.passK).toBe(3);
  });

  it('rejects artifactSystem other than "A"', async () => {
    const { validateTask } = await loadModule();
    expect(() => validateTask(validReportTask({ artifactSystem: 'B' })))
      .toThrow(/ARTIFACT_SYSTEM/i);
  });

  it('rejects unknown categories', async () => {
    const { validateTask } = await loadModule();
    expect(() => validateTask(validReportTask({ category: 'blog' })))
      .toThrow(/CATEGORY/i);
  });

  it('rejects kindAnyOf values outside the normalized ArtifactKind vocabulary (B4 guard)', async () => {
    const { validateTask } = await loadModule();
    const task = validReportTask();
    (task.expectations as any).artifactMatch = { kindAnyOf: ['report'] };
    expect(() => validateTask(task)).toThrow(/KIND/i);
  });

  it('requires projectCreatedOnly=true for project tasks', async () => {
    const { validateTask } = await loadModule();
    const task = validReportTask({ taskId: 'prod:project:x', category: 'project' });
    (task.expectations as any).projectCreatedOnly = false;
    expect(() => validateTask(task)).toThrow(/PROJECT_CREATED_ONLY/i);
  });

  it('rejects empty turns and non-positive passK', async () => {
    const { validateTask } = await loadModule();
    expect(() => validateTask(validReportTask({ turns: [] }))).toThrow(/TURNS/i);
    expect(() => validateTask(validReportTask({ passK: 0 }))).toThrow(/PASS_K/i);
  });

  it('expands the plan by passK with stable sessionKeys and replica indexes', async () => {
    const { validateTask, expandPlan } = await loadModule();
    const report = validateTask(validReportTask());
    const project = validateTask(validReportTask({
      taskId: 'prod:project:y',
      category: 'project',
      passK: 1,
      expectations: {
        ...validReportTask().expectations as object,
        projectCreatedOnly: true,
      },
    }));
    const plan = expandPlan([report, project]);
    expect(plan).toHaveLength(4);
    expect(plan[0].sessionKey).toBe('prod:report:sample-01#0');
    expect(plan[2].sessionKey).toBe('prod:report:sample-01#2');
    expect(plan.map((p: any) => p.replicaIndex)).toEqual([0, 1, 2, 0]);
    expect(plan[3].taskId).toBe('prod:project:y');
  });

  it('loads tasks recursively from a directory and rejects duplicate taskIds', async () => {
    const { loadTasksFromDir } = await loadModule();
    const dir = mkdtempSync(join(tmpdir(), 'xiaok-product-tasks-'));
    try {
      mkdirSync(join(dir, 'report'), { recursive: true });
      writeFileSync(join(dir, 'report', 'a.json'), JSON.stringify(validReportTask()));
      const tasks = await loadTasksFromDir(dir);
      expect(tasks).toHaveLength(1);
      writeFileSync(
        join(dir, 'report', 'b.json'),
        JSON.stringify(validReportTask()),
      );
      await expect(loadTasksFromDir(dir)).rejects.toThrow(/DUPLICATE/i);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
