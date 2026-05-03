import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';

describe('MaterialRegistry', () => {
  let rootDir: string;
  let sourceDir: string;
  let workspaceRoot: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-task-host-material-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    sourceDir = join(rootDir, 'source');
    workspaceRoot = join(rootDir, 'workspace');
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(workspaceRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('imports a supported file into the task workspace and exposes only safe view fields', async () => {
    const sourcePath = join(sourceDir, 'A客户需求.md');
    writeFileSync(sourcePath, '# A 客户需求\n需要制造业数字化方案。');
    const registry = new MaterialRegistry({
      workspaceRoot,
      maxBytes: 1024 * 1024,
      now: () => 1_777_000_000,
    });

    const record = await registry.importMaterial({
      taskId: 'task_1',
      sourcePath,
      role: 'customer_material',
      roleSource: 'user',
    });

    expect(record).toMatchObject({
      taskId: 'task_1',
      originalName: 'A客户需求.md',
      mimeType: 'text/markdown',
      role: 'customer_material',
      roleSource: 'user',
      parseStatus: 'pending',
      createdAt: 1_777_000_000,
    });
    expect(record.materialId).toMatch(/^mat_/);
    expect(record.sizeBytes).toBeGreaterThan(0);
    expect(record.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(record.workspacePath).toContain(join(workspaceRoot, 'task_1'));
    expect(existsSync(record.workspacePath)).toBe(true);
    expect(readFileSync(record.workspacePath, 'utf8')).toContain('制造业数字化方案');

    const view = registry.toView(record);
    expect(view).toEqual({
      materialId: record.materialId,
      originalName: 'A客户需求.md',
      role: 'customer_material',
      parseStatus: 'pending',
      parseSummary: undefined,
    });
    expect(view).not.toHaveProperty('workspacePath');
    expect(view).not.toHaveProperty('sha256');
    expect(view).not.toHaveProperty('sourcePath');
  });

  it('reloads imported material records from the workspace index', async () => {
    const sourcePath = join(sourceDir, 'A客户需求.md');
    const secondSourcePath = join(sourceDir, '产品资料.pdf');
    writeFileSync(sourcePath, '# A 客户需求');
    writeFileSync(secondSourcePath, 'pdf bytes');
    const registry = new MaterialRegistry({
      workspaceRoot,
      maxBytes: 1024 * 1024,
      now: () => 1_777_000_000,
    });

    const record = await registry.importMaterial({
      taskId: 'task_1',
      sourcePath,
      role: 'customer_material',
      roleSource: 'user',
    });
    const reloaded = new MaterialRegistry({
      workspaceRoot,
      maxBytes: 1024 * 1024,
      now: () => 1_777_000_001,
    });

    expect(reloaded.get(record.materialId)).toEqual(record);
    expect(reloaded.list('task_1')).toEqual([record]);

    const secondRecord = await reloaded.importMaterial({
      taskId: 'task_1',
      sourcePath: secondSourcePath,
      role: 'product_material',
      roleSource: 'user',
    });

    expect(secondRecord.materialId).not.toBe(record.materialId);
    expect(reloaded.list('task_1').map((item) => item.materialId)).toEqual([
      record.materialId,
      secondRecord.materialId,
    ]);
  });

  it('rejects unsupported, oversized, and unsafe source files', async () => {
    const registry = new MaterialRegistry({
      workspaceRoot,
      maxBytes: 4,
      now: () => 1,
    });
    const unsupported = join(sourceDir, 'script.sh');
    const oversized = join(sourceDir, 'large.md');
    const taskWorkspaceSource = join(workspaceRoot, 'task_1', 'already-imported.md');
    mkdirSync(join(workspaceRoot, 'task_1'), { recursive: true });
    writeFileSync(unsupported, 'echo nope');
    writeFileSync(oversized, '12345');
    writeFileSync(taskWorkspaceSource, 'inside workspace');

    await expect(registry.importMaterial({
      taskId: 'task_1',
      sourcePath: unsupported,
      role: 'unknown',
      roleSource: 'auto',
    })).rejects.toThrow(/unsupported/i);

    await expect(registry.importMaterial({
      taskId: 'task_1',
      sourcePath: oversized,
      role: 'unknown',
      roleSource: 'auto',
    })).rejects.toThrow(/oversized/i);

    await expect(registry.importMaterial({
      taskId: 'task_1',
      sourcePath: taskWorkspaceSource,
      role: 'unknown',
      roleSource: 'auto',
    })).rejects.toThrow(/unsafe/i);
  });
});
