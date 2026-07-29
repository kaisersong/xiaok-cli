import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const CATEGORIES = Object.freeze(['report', 'slide', 'project']);

// The normalized ArtifactKind vocabulary emitted at runtime
// (src/runtime/task-host/types.ts:82 via normalizeArtifactKind).
// There is deliberately no "report" kind: report=.md→'text' / .html→'html'.
export const ARTIFACT_KINDS = Object.freeze([
  'pptx', 'pdf', 'docx', 'xlsx', 'html', 'image', 'text', 'a2ui', 'other',
]);

function fail(code, detail) {
  throw new Error(detail ? `${code}: ${detail}` : code);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

export function validateTask(task) {
  if (typeof task !== 'object' || task === null) fail('PRODUCT_EVAL_TASK_INVALID');
  if (!isNonEmptyString(task.taskId)) fail('PRODUCT_EVAL_TASK_ID_INVALID');
  if (!CATEGORIES.includes(task.category)) {
    fail('PRODUCT_EVAL_CATEGORY_INVALID', String(task.category));
  }
  if (!isNonEmptyString(task.title)) fail('PRODUCT_EVAL_TITLE_INVALID', task.taskId);
  if (task.artifactSystem !== 'A') {
    fail('PRODUCT_EVAL_ARTIFACT_SYSTEM_UNSUPPORTED', `${task.taskId}: only System A`);
  }
  if (!Array.isArray(task.turns) || task.turns.length === 0) {
    fail('PRODUCT_EVAL_TURNS_INVALID', task.taskId);
  }
  for (const turn of task.turns) {
    if (
      !Number.isSafeInteger(turn?.ordinal)
      || turn.ordinal < 1
      || !isNonEmptyString(turn?.prompt)
    ) {
      fail('PRODUCT_EVAL_TURNS_INVALID', task.taskId);
    }
  }
  const expectations = task.expectations;
  if (typeof expectations !== 'object' || expectations === null) {
    fail('PRODUCT_EVAL_EXPECTATIONS_INVALID', task.taskId);
  }
  const kindAnyOf = expectations.artifactMatch?.kindAnyOf;
  if (kindAnyOf !== undefined) {
    if (!Array.isArray(kindAnyOf) || kindAnyOf.length === 0) {
      fail('PRODUCT_EVAL_KIND_LIST_INVALID', task.taskId);
    }
    for (const kind of kindAnyOf) {
      if (!ARTIFACT_KINDS.includes(kind)) {
        fail(
          'PRODUCT_EVAL_KIND_UNKNOWN',
          `${task.taskId}: "${kind}" is not a normalized ArtifactKind`,
        );
      }
    }
  }
  const forbidden = expectations.forbiddenAgentTools;
  if (forbidden !== undefined && (
    !Array.isArray(forbidden) || forbidden.some(name => !isNonEmptyString(name))
  )) {
    fail('PRODUCT_EVAL_FORBIDDEN_TOOLS_INVALID', task.taskId);
  }
  if (task.category === 'project' && expectations.projectCreatedOnly !== true) {
    fail(
      'PRODUCT_EVAL_PROJECT_CREATED_ONLY_REQUIRED',
      `${task.taskId}: project tasks are creation-only in the MVP`,
    );
  }
  if (!Number.isSafeInteger(task.timeoutMs) || task.timeoutMs <= 0) {
    fail('PRODUCT_EVAL_TIMEOUT_INVALID', task.taskId);
  }
  if (!Number.isSafeInteger(task.passK) || task.passK < 1) {
    fail('PRODUCT_EVAL_PASS_K_INVALID', task.taskId);
  }
  return Object.freeze(structuredClone(task));
}

export function expandPlan(tasks) {
  const plan = [];
  for (const task of tasks) {
    for (let replicaIndex = 0; replicaIndex < task.passK; replicaIndex += 1) {
      plan.push(Object.freeze({
        sessionKey: `${task.taskId}#${replicaIndex}`,
        taskId: task.taskId,
        category: task.category,
        replicaIndex,
        task,
      }));
    }
  }
  return Object.freeze(plan);
}

async function collectJsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectJsonFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

export async function loadTasksFromDir(dir) {
  const files = await collectJsonFiles(dir);
  const tasks = [];
  const seen = new Set();
  for (const file of files) {
    let parsed;
    try {
      parsed = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      fail('PRODUCT_EVAL_TASK_PARSE_FAILED', file);
    }
    const task = validateTask(parsed);
    if (seen.has(task.taskId)) {
      fail('PRODUCT_EVAL_DUPLICATE_TASK_ID', task.taskId);
    }
    seen.add(task.taskId);
    tasks.push(task);
  }
  return tasks;
}
