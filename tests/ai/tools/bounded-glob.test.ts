import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { runFallbackGrepSearch } from '../../../src/ai/tools/grep.js';
import { globTool } from '../../../src/ai/tools/glob.js';
import type { ToolExecutionContext } from '../../../src/types.js';
import { createBoundedGlobRunner } from '../../../src/ai/tools/bounded-glob.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'xiaok-bounded-glob-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); });
const input = () => ({ patterns: '**/*', cwd: dir });
function script(body: string): URL {
  const path = join(dir, 'fixture.mjs'); writeFileSync(path, body); return pathToFileURL(path);
}

describe('bounded glob production worker', () => {
  it('bounds traversal even when there are no matching results', async () => {
    for (let i = 0; i < 25; i++) mkdirSync(join(dir, `d${i}`));
    const runner = createBoundedGlobRunner({ limits: { maxEntries: 10 } });
    await expect(runner.search({ ...input(), patterns: '**/absent' })).rejects.toThrow('glob_scan_limit');
    expect(runner.activeCount).toBe(0);
    expect(await runner.search({ ...input(), patterns: 'absent' })).toEqual([]);
  });

  it.each([true, false])('bounds static brace metadata lookups (matches=%s)', async matches => {
    if (matches) for (let i = 0; i < 5; i++) writeFileSync(join(dir, `file${i}`), '');
    const runner = createBoundedGlobRunner({ limits: { maxEntries: 1, maxDirectories: 1 } });
    await expect(runner.search({ ...input(), patterns: 'file{0,1,2,3,4}' })).rejects.toThrow('glob_scan_limit');
    expect(runner.activeCount).toBe(0);
  });

  it('rejects host V8 overrides which enlarge the actual worker heap', () => {
    let moduleUrl = new URL('../../../src/ai/tools/bounded-glob.js', import.meta.url);
    if (!existsSync(fileURLToPath(moduleUrl))) moduleUrl = new URL('../../../src/ai/tools/bounded-glob.ts', import.meta.url);
    const source = `const {createBoundedGlobRunner}=await import(${JSON.stringify(moduleUrl.href)});
      const runner=createBoundedGlobRunner();
      try {await runner.search({patterns:'absent',cwd:${JSON.stringify(dir)}});process.exitCode=2;}
      catch(error){console.log(error.message);if(error.message!=='glob_worker_heap_config')process.exitCode=3;}
      if(runner.activeCount!==0)process.exitCode=4;`;
    const child = spawnSync(process.execPath, ['--max-old-space-size=256', '--import', 'tsx', '--input-type=module', '-e', source], { encoding: 'utf8', timeout: 5000 });
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout.trim()).toBe('glob_worker_heap_config');
  });

  it('bounds matched results independently of pagination', async () => {
    for (let i = 0; i < 6; i++) writeFileSync(join(dir, `${i}.ts`), '');
    const runner = createBoundedGlobRunner({ limits: { maxResults: 3 } });
    await expect(runner.search(input())).rejects.toThrow('glob_result_limit');
    expect(runner.activeCount).toBe(0);
  });

  it('bounds directory visits and aggregate path payload', async () => {
    mkdirSync(join(dir, 'a', 'b', 'c'), { recursive: true });
    const directories = createBoundedGlobRunner({ limits: { maxDirectories: 2 } });
    await expect(directories.search(input())).rejects.toThrow('glob_scan_limit');
    writeFileSync(join(dir, 'file.ts'), '');
    const bytes = createBoundedGlobRunner({ limits: { maxPathBytes: 5 } });
    await expect(bytes.search(input())).rejects.toThrow('glob_result_limit');
    expect(bytes.activeCount + directories.activeCount).toBe(0);
  });

  it.skipIf(process.platform === 'win32')('does not follow symlink cycles or enumerate linked external trees', async () => {
    writeFileSync(join(dir, 'a.ts'), '');
    symlinkSync(dir, join(dir, 'cycle'));
    const runner = createBoundedGlobRunner();
    const result = await runner.search(input());
    expect(result.map(entry => entry.path)).toEqual([join(dir, 'a.ts').replace(/\\/g, '/')]);
    expect(runner.activeCount).toBe(0);
  });

  it('returns only stable errors when worker fails and releases capacity', async () => {
    const runner = createBoundedGlobRunner({ workerUrl: script("throw new Error('PRIVATE_CANARY');") });
    await expect(runner.search(input())).rejects.toThrow(/^glob_worker_failed$/);
    expect(runner.activeCount).toBe(0);
  });

  it('terminates timed out workers before settling, including CPU-bound work', async () => {
    const runner = createBoundedGlobRunner({ timeoutMs: 100, workerUrl: script('while (true) {}') });
    await expect(runner.search(input())).rejects.toThrow('glob_timeout');
    expect(runner.activeCount).toBe(0);
  });

  it('does not start a pre-cancelled search and terminates an active worker on abort', async () => {
    const controller = new AbortController(); const reason = new Error('caller cancelled');
    controller.abort(reason);
    const runner = createBoundedGlobRunner({ workerUrl: script('while (true) {}') });
    await expect(runner.search(input(), controller.signal)).rejects.toBe(reason);
    expect(runner.activeCount).toBe(0);
    const active = new AbortController();
    const pending = runner.search(input(), active.signal);
    expect(runner.activeCount).toBe(1);
    active.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(runner.activeCount).toBe(0);
  });

  it('rejects overload without queued work, and recovers after cancellation', async () => {
    const runner = createBoundedGlobRunner({ maxWorkers: 1, workerUrl: script('while (true) {}') });
    const controller = new AbortController();
    const pending = runner.search(input(), controller.signal);
    await expect(runner.search(input())).rejects.toThrow('glob_busy');
    controller.abort(); await expect(pending).rejects.toThrow();
    expect(runner.activeCount).toBe(0);
    const next = runner.search(input(), controller.signal);
    await expect(next).rejects.toThrow();
    expect(runner.activeCount).toBe(0);
  });

  it('contains V8 worker OOM without killing the caller', async () => {
    const runner = createBoundedGlobRunner({ workerUrl: script('const arrays=[]; while(true) arrays.push(new Array(1000000).fill(123));') });
    await expect(runner.search(input())).rejects.toThrow(/^glob_worker_memory_limit$/);
    expect(runner.activeCount).toBe(0);
    const normal = createBoundedGlobRunner();
    writeFileSync(join(dir, 'ok.ts'), '');
    expect((await normal.search({ ...input(), patterns: '*.ts' }))[0].path).toBe(join(dir, 'ok.ts').replace(/\\/g, '/'));
  }, 15_000);

  it('shares cancellation with the glob tool and grep fallback entrypoints', async () => {
    const controller = new AbortController(); const reason = new Error('cancelled by host');
    controller.abort(reason);
    await expect(globTool.execute({ pattern: '**/*', path: dir }, { signal: controller.signal } as ToolExecutionContext)).rejects.toBe(reason);
    await expect(runFallbackGrepSearch({ pattern: 'hello', path: dir, signal: controller.signal })).rejects.toBe(reason);
    writeFileSync(join(dir, 'hello.txt'), 'hello world');
    expect(await runFallbackGrepSearch({ pattern: 'hello', path: dir })).toContain(`${join(dir, 'hello.txt').replace(/\\/g, '/')}:1:hello world`);
  });

  it('does not expose filesystem error text through the tool', async () => {
    const result = await globTool.execute({ pattern: '**/*', path: join(dir, 'missing') });
    expect(result).not.toContain(dir);
    expect(result).toMatch(/无匹配|glob_search_failed/);
  });

  it('rejects oversized patterns without worker allocation', async () => {
    const runner = createBoundedGlobRunner();
    await expect(runner.search({ ...input(), patterns: '*'.repeat(2049) })).rejects.toThrow('glob_invalid_input');
    expect(runner.activeCount).toBe(0);
  });
});
