import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export interface DependencyProcessResult { success: boolean; output?: string; error?: string }

/** Completion follows close, including abort/timeout. Never invokes a shell or kills by name. */
export async function runDependencyProcess(command: string, args: string[], options: {
  signal?: AbortSignal; timeoutMs?: number; maxOutputBytes?: number;
} = {}): Promise<DependencyProcessResult> {
  if (options.signal?.aborted) return { success: false, error: 'dependency_cancelled' };
  return new Promise(resolve => {
    const ownsProcessGroup = process.platform !== 'win32';
    const child = spawn(command, args, { shell: false, detached: ownsProcessGroup, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let failure: string | undefined;
    let forceStopTimer: ReturnType<typeof setTimeout> | undefined;
    const limit = options.maxOutputBytes ?? 1024 * 1024;
    const stop = (reason: string) => {
      failure ??= reason;
      try {
        if (ownsProcessGroup && child.pid) process.kill(-child.pid, 'SIGTERM');
        else child.kill();
        if (ownsProcessGroup && child.pid && !forceStopTimer) {
          const ownedGroup = child.pid;
          forceStopTimer = setTimeout(() => {
            try { process.kill(-ownedGroup, 'SIGKILL'); } catch { /* Already exited. */ }
          }, 1000);
        }
      } catch { /* close/error establishes completion; never kill another process. */ }
    };
    const abort = () => stop('dependency_cancelled');
    const timer = setTimeout(() => stop('dependency_timeout'), options.timeoutMs ?? 120_000);
    const receive = (chunk: Buffer) => {
      const buffer = Buffer.from(chunk);
      const remaining = Math.max(0, limit - bytes);
      if (remaining) chunks.push(buffer.subarray(0, remaining));
      bytes += buffer.length;
      if (bytes > limit) stop('dependency_output_limit');
    };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    child.once('error', error => { failure ??= error.message; });
    child.once('close', code => {
      clearTimeout(timer);
      clearTimeout(forceStopTimer);
      options.signal?.removeEventListener('abort', abort);
      const output = Buffer.concat(chunks).toString('utf8').trim();
      resolve(failure || code !== 0
        ? { success: false, error: failure ?? (output || `exit ${code}`), output }
        : { success: true, output });
    });
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
  });
}

export interface DependencyTaskView { taskId: string; dependencyId: string; state: 'running' | 'cancelling' }
export class DependencyTaskOwner {
  private readonly tasks = new Map<string, { view: DependencyTaskView; controller: AbortController }>();
  get(id: string): DependencyTaskView | undefined { const task = this.tasks.get(id); return task && { ...task.view }; }
  cancelAll(): void { for (const id of this.tasks.keys()) this.cancel(id); }
  cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    task.view.state = 'cancelling';
    task.controller.abort();
    return true;
  }
  async run<T>(id: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.tasks.has(id)) throw new Error('dependency_task_busy');
    const task = { view: { taskId: randomUUID(), dependencyId: id, state: 'running' as const } as DependencyTaskView, controller: new AbortController() };
    this.tasks.set(id, task);
    try { return await operation(task.controller.signal); }
    finally { if (this.tasks.get(id) === task) this.tasks.delete(id); }
  }
}
