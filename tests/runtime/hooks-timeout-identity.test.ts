import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { performance } from 'node:perf_hooks';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { createHooksRunner } from '../../src/runtime/hooks-runner.js';

function createMockChild(opts: {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  delay?: number;
  noExit?: boolean;
}) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
    unref: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() });
  child.kill = vi.fn(() => { child.emit('exit', 1); child.emit('close', 1, null); });
  child.unref = vi.fn();

  if (!opts.noExit) {
    setTimeout(() => {
      if (opts.stdout) child.stdout.emit('data', opts.stdout);
      if (opts.stderr) child.stderr.emit('data', opts.stderr);
      child.emit('exit', opts.exitCode ?? 0);
      child.emit('close', opts.exitCode ?? 0, null);
    }, opts.delay ?? 0);
  }

  return child;
}

describe('command timeout identity is separate from an unknown physical drain', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  let restoreClock = () => {};
  beforeEach(() => {
    vi.useFakeTimers(); vi.mocked(spawn).mockReset();
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
    restoreClock = () => clock.mockRestore();
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  });
  afterEach(() => {
    restoreClock();
    if (platform) Object.defineProperty(process, 'platform', platform);
    vi.restoreAllMocks(); vi.mocked(spawn).mockReset(); vi.useRealTimers();
  });
  function start(event: 'PermissionRequest' | 'PreToolUse' = 'PermissionRequest') {
    const gone = Object.assign(new Error('original owned group gone'), { code: 'ESRCH' });
    const kill = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => { if (signal === 0) throw gone; return true; });
    const child = Object.assign(createMockChild({ noExit: true }), { pid: 43210, exitCode: null, signalCode: null });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const runner = createHooksRunner({ hooks: [{ command: 'owned-probe', events: [event], timeoutMs: 50 }] });
    const running = runner.runHooks(event, {});
    return { child, kill, runner, running };
  }
  it.each(['PermissionRequest', 'PreToolUse'] as const)('%s retains timeout semantics but permits drain only after original close and group gone', async event => {
    const f = start(event); let settled = false;
    void f.running.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(50); expect(settled).toBe(false);
    f.child.emit('exit', null, 'SIGTERM');
    await vi.advanceTimersByTimeAsync(0); expect(settled).toBe(false);
    f.child.emit('close', null, 'SIGTERM');
    const result = await f.running;
    expect(result.message).toContain('hook timeout after 50ms');
    expect(result.ok).toBe(event === 'PermissionRequest'); expect(result.decision).toBeUndefined();
    expect(f.kill).toHaveBeenCalledWith(-43210, 0);
    await expect(f.runner.closeAndDrain()).resolves.toBeUndefined();
  });
  it.each(['stdin', 'stdout', 'stderr', 'spawn', 'EPERM', 'group-alive'] as const)('a timeout cannot hide unknown %s evidence', async kind => {
    const f = start(); const failure = Object.assign(new Error('original unknown failure'), { code: 'EPERM' });
    await vi.advanceTimersByTimeAsync(50);
    if (kind === 'stdin') f.child.stdin.emit('error', failure);
    else if (kind === 'stdout') f.child.stdout.emit('error', failure);
    else if (kind === 'stderr') f.child.stderr.emit('error', failure);
    else if (kind === 'spawn') f.child.emit('error', failure);
    else f.kill.mockImplementation(() => { if (kind === 'EPERM') throw failure; return true; });
    f.child.emit('close', null, 'SIGTERM');
    if (kind === 'group-alive') await vi.advanceTimersByTimeAsync(250);
    await f.running;
    await expect(f.runner.closeAndDrain()).rejects.toThrow('hook_physical_drain_unconfirmed');
  });
  it('does not trust a timeout-shaped Error provided by a transport leaf', async () => {
    const f = start(); await vi.advanceTimersByTimeAsync(0);
    const lookalike = new Error('hook timeout after 50ms');
    f.child.emit('error', lookalike); f.child.emit('close', 1, null); await f.running;
    const error = await f.runner.closeAndDrain().then(() => undefined, value => value);
    expect(error).toBeInstanceOf(AggregateError); expect(error.errors).toContain(lookalike);
  });
  it('one joined timeout does not erase another original unknown failure in the same owner', async () => {
    const f = start(); await vi.advanceTimersByTimeAsync(50);
    f.child.emit('close', null, 'SIGTERM');
    await f.running;
    const child = Object.assign(createMockChild({ noExit: true }), { pid: 43211, exitCode: null, signalCode: null });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const second = f.runner.runHooks('PermissionRequest', {}); await vi.advanceTimersByTimeAsync(0);
    const failure = new Error('second original spawn failure'); child.emit('error', failure); child.emit('close', 1, null); await second;
    const error = await f.runner.closeAndDrain().then(() => undefined, value => value);
    expect(error).toBeInstanceOf(AggregateError); expect(error.errors).toContain(failure);
  });
});
