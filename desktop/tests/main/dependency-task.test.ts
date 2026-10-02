import { describe, expect, it } from 'vitest';
import { runDependencyProcess, DependencyTaskOwner } from '../../electron/dependency-task.js';

describe('dependency task owner', () => {
  it('runs asynchronously and bounds child output', async () => {
    let ticked = false;
    const pending = runDependencyProcess(process.execPath, ['-e', "setTimeout(()=>process.stdout.write('x'.repeat(10000)),100)"], { maxOutputBytes: 100 });
    await new Promise(resolve => setTimeout(() => { ticked = true; resolve(null); }, 10));
    expect(ticked).toBe(true);
    const result = await pending;
    expect(result.success).toBe(false);
    expect(result.error).toBe('dependency_output_limit');
    expect(result.output?.length ?? 0).toBeLessThanOrEqual(100);
  });

  it('waits for owned child exit before cancellation completes', async () => {
    const controller = new AbortController();
    const pending = runDependencyProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal });
    controller.abort();
    expect(await pending).toMatchObject({ success: false, error: 'dependency_cancelled' });
  });

  it.skipIf(process.platform === 'win32')('bounds shutdown when an owned child ignores SIGTERM', async () => {
    const result = await runDependencyProcess(process.execPath, ['-e',
      "process.on('SIGTERM',()=>{}); process.stdout.write(String(process.pid)); setInterval(()=>{},1000)"],
    { timeoutMs: 300 });
    expect(result).toMatchObject({ success: false, error: 'dependency_timeout' });
    const pid = Number(result.output);
    expect(pid).toBeGreaterThan(0);
    expect(() => process.kill(pid, 0)).toThrow();
  }, 4000);

  it('rejects conflicting tasks while cancellation is settling', async () => {
    const owner = new DependencyTaskOwner();
    let release!: () => void;
    const first = owner.run('cua-driver', async signal => {
      await new Promise<void>(resolve => { release = resolve; });
      signal.throwIfAborted();
      return 'done';
    });
    owner.cancel('cua-driver');
    expect(owner.get('cua-driver')?.state).toBe('cancelling');
    await expect(owner.run('cua-driver', async () => 'second')).rejects.toThrow('dependency_task_busy');
    release();
    await expect(first).rejects.toThrow();
    expect(owner.get('cua-driver')).toBeUndefined();
  });
});
