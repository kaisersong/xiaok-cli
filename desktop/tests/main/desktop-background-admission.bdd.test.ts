// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

it('real service and ordinary host keep a held background task out of the foreground lane', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xiaok-background-admission-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  const c = new DesktopExecutionCoordinator({ backgroundCapacity: 1 });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started: string[] = [];
  const services = createDesktopServices({ dataRoot: dir, executionCoordinator: c,
    runner: async ({ prompt }) => { started.push(prompt); if (prompt === 'background') await gate; },
  });
  cleanups.push(async () => { release(); await services.disposeMultiAgent(); });
  await services.createBackgroundTask({ prompt: 'background', materials: [] });
  await vi.waitFor(() => expect(started).toEqual(['background']));
  const foreground = await services.createTask({ prompt: 'foreground', materials: [] });
  await vi.waitFor(() => expect(started).toContain('foreground'));
  expect((await services.recoverTask(foreground.taskId)).snapshot.prompt).toBe('foreground');
  expect(c.snapshot().active).toBeGreaterThanOrEqual(1);
  release();
  await vi.waitFor(() => expect(c.snapshot().active).toBe(0));
});
