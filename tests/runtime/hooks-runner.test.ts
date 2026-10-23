import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { win32 } from 'node:path';
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

describe('hooks runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks tool execution when a matching pre hook fails (exit code 2)', async () => {
    const mockExec = vi.mocked(spawn) as any;
    mockExec.mockImplementation(() =>
      createMockChild({ exitCode: 2, stderr: 'blocked by pre hook' }),
    );

    const runner = createHooksRunner({
      pre: [{ command: 'echo pre', tools: ['write'] }],
      timeoutMs: 500,
    });

    const result = await runner.runPreHooks('write', { file_path: '/tmp/x' });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('blocked by pre hook');
  });

  it('ignores non-matching hooks', async () => {
    const mockExec = vi.mocked(spawn) as any;
    const runner = createHooksRunner({
      pre: [{ command: 'echo pre', tools: ['bash'] }],
      timeoutMs: 500,
    });

    const result = await runner.runPreHooks('write', { file_path: '/tmp/x' });

    expect(result.ok).toBe(true);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('returns a warning when a post hook fails (non-zero exit)', async () => {
    const mockExec = vi.mocked(spawn) as any;
    mockExec.mockImplementation(() =>
      createMockChild({ exitCode: 1, stderr: 'post hook failed' }),
    );

    const runner = createHooksRunner({
      post: [{ command: 'echo post', tools: ['write'] }],
      timeoutMs: 500,
    });

    const warnings = await runner.runPostHooks('write', { file_path: '/tmp/x' });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('post hook failed');
  });

  it('times out long-running hooks', async () => {
    const mockExec = vi.mocked(spawn) as any;
    const child = createMockChild({ noExit: true });
    mockExec.mockImplementation(() => child);

    const runner = createHooksRunner({
      pre: [{ command: 'sleep 10', tools: ['write'] }],
      timeoutMs: 50,
    });

    const result = await runner.runPreHooks('write', { file_path: '/tmp/x' });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('timeout');
    expect(child.kill).toHaveBeenCalled();
  });

  it('passes payload via stdin', async () => {
    const mockExec = vi.mocked(spawn) as any;
    const child = createMockChild({ exitCode: 0 });
    mockExec.mockImplementation(() => child);

    const runner = createHooksRunner({
      pre: [{ command: 'cat', tools: ['write'] }],
      context: { session_id: 'test-session', cwd: '/tmp' },
    });

    await runner.runPreHooks('write', { file_path: '/tmp/x' });

    expect(child.stdin.end).toHaveBeenCalled();
    const payload = JSON.parse(child.stdin.end.mock.calls[0][0]);
    expect(payload.hook_event_name).toBe('PreToolUse');
    expect(payload.session_id).toBe('test-session');
    expect(payload.tool_name).toBe('write');
  });

  it('parses structured JSON output from hook stdout', async () => {
    const mockExec = vi.mocked(spawn) as any;
    mockExec.mockImplementation(() =>
      createMockChild({
        exitCode: 0,
        stdout: JSON.stringify({ updatedInput: { path: '/tmp/y' }, additionalContext: 'modified' }),
      }),
    );

    const runner = createHooksRunner({
      pre: [{ command: 'hook-script', tools: ['write'] }],
    });

    const result = await runner.runPreHooks('write', { file_path: '/tmp/x' });

    expect(result.ok).toBe(true);
    expect(result.updatedInput).toEqual({ path: '/tmp/y' });
    expect(result.additionalContext).toBe('modified');
  });

  it('supports pipe-separated matcher', async () => {
    const mockExec = vi.mocked(spawn) as any;
    mockExec.mockImplementation(() => createMockChild({ exitCode: 0 }));

    const runner = createHooksRunner({
      hooks: [{ type: 'command', command: 'echo ok', events: ['PreToolUse'], matcher: 'Read|Write' }],
    });

    const result1 = await runner.runPreHooks('Write', {});
    expect(result1.ok).toBe(true);
    expect(mockExec).toHaveBeenCalledTimes(1);

    mockExec.mockClear();
    const result2 = await runner.runPreHooks('Bash', {});
    expect(result2.ok).toBe(true);
    expect(mockExec).not.toHaveBeenCalled(); // no match
  });

  it('runs once-per-session hooks only once', async () => {
    const mockExec = vi.mocked(spawn) as any;
    mockExec.mockImplementation(() => createMockChild({ exitCode: 0 }));

    const runner = createHooksRunner({
      hooks: [{ type: 'command', command: 'echo once', events: ['PreToolUse'], once: true }],
    });

    await runner.runPreHooks('write', {});
    await runner.runPreHooks('write', {});

    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it('runs async hooks without blocking', async () => {
    const mockExec = vi.mocked(spawn) as any;
    const child = createMockChild({ noExit: true });
    mockExec.mockImplementation(() => child);

    const runner = createHooksRunner({
      hooks: [{ type: 'command', command: 'slow-task', events: ['PostToolUse'], async: true }],
    });

    const result = await runner.runHooks('PostToolUse', { tool_name: 'Bash' });

    expect(result.ok).toBe(true);
    expect(result.async).toBe(true);
    expect(child.unref).not.toHaveBeenCalled();
    child.emit('exit', 0); child.emit('close', 0, null);
    await runner.closeAndDrain();
  });

  it('parses structured allow decisions from PermissionRequest hook output', async () => {
    const mockExec = vi.mocked(spawn) as any;
    mockExec.mockImplementation(() =>
      createMockChild({
        exitCode: 0,
        stdout: JSON.stringify({ decision: 'allow', message: 'allowed by hook policy' }),
      }),
    );

    const runner = createHooksRunner({
      hooks: [{ type: 'command', command: 'permission-hook', events: ['PermissionRequest'], matcher: 'write' }],
    });

    const result = await runner.runHooks('PermissionRequest', { tool_name: 'write', input: { file_path: '/tmp/x' } });

    expect(result.ok).toBe(true);
    expect(result.decision).toBe('allow');
    expect(result.message).toBe('allowed by hook policy');
  });

  it('treats malformed PermissionRequest hook output as no decision instead of crashing the flow', async () => {
    const mockExec = vi.mocked(spawn) as any;
    mockExec.mockImplementation(() =>
      createMockChild({
        exitCode: 0,
        stdout: 'definitely not json',
      }),
    );

    const runner = createHooksRunner({
      hooks: [{ type: 'command', command: 'permission-hook', events: ['PermissionRequest'], matcher: 'write' }],
    });

    const result = await runner.runHooks('PermissionRequest', { tool_name: 'write', input: { file_path: '/tmp/x' } });

    expect(result.ok).toBe(true);
    expect(result.decision).toBeUndefined();
    expect(result.message).toBeUndefined();
  });
});

describe('Windows owned hook tree and pipe drain', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  let restoreClock = () => {};
  beforeEach(() => {
    vi.useFakeTimers();
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
    restoreClock = () => clock.mockRestore();
    vi.mocked(spawn).mockReset();
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.stubEnv('SystemRoot', 'C:\\Windows');
  });
  afterEach(() => {
    restoreClock();
    if (platform) Object.defineProperty(process, 'platform', platform);
    vi.mocked(spawn).mockReset();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });
  function start(finalHookAdmission?: () => Record<string, unknown> | undefined) {
    const child = Object.assign(createMockChild({ noExit: true }), { pid: 43210, exitCode: null, signalCode: null });
    const killer = createMockChild({ noExit: true });
    const spawnMock = vi.mocked(spawn) as any;
    spawnMock.mockReturnValueOnce(child).mockReturnValueOnce(killer);
    const runner = createHooksRunner({ pre: [{ command: 'owned-hook', tools: ['write'] }], timeoutMs: 50, finalHookAdmission });
    const running = runner.runPreHooks('write', {});
    return { child, killer, runner, running, spawnMock };
  }

  it('targets only the original live shell tree and joins the termination helper after hook pipes close', async () => {
    const admission = vi.fn(() => ({ reason: 'original-host-final-admission' }));
    const f = start(admission);
    await vi.advanceTimersByTimeAsync(0);
    f.child.pid = 54321;
    let settled = false;void f.running.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(50);
    expect(f.spawnMock).toHaveBeenLastCalledWith(win32.join('C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', '43210', '/T', '/F'], { shell: false, stdio: 'ignore', windowsHide: true });
    expect(f.child.kill).not.toHaveBeenCalled();
    f.child.emit('exit', 1);f.child.emit('close', 1, null);
    const closing = f.runner.closeAndDrain().then(() => undefined, error => error);
    await vi.advanceTimersByTimeAsync(0);expect(settled).toBe(false);
    expect(admission).not.toHaveBeenCalled();
    f.killer.emit('close', 0, null);
    expect(await f.running).toMatchObject({ ok: false });
    expect(await closing).toBeUndefined();
    expect(admission).toHaveBeenCalledTimes(1);
  });

  it('does not equate taskkill completion or shell exit with inherited pipe closure', async () => {
    const f = start();let settled = false;void f.running.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(50);
    f.child.emit('exit', 1);f.killer.emit('close', 0, null);
    await vi.advanceTimersByTimeAsync(0);expect(settled).toBe(false);
    f.child.emit('close', 1, null);
    expect(await f.running).toMatchObject({ ok: false });
    await expect(f.runner.closeAndDrain()).resolves.toBeUndefined();
  });

  it('retains the original timeout and termination-helper failure instead of claiming cleanup', async () => {
    const f = start(), failure = Error('original_taskkill_launch_failure');
    await vi.advanceTimersByTimeAsync(50);
    f.killer.emit('error', failure);f.killer.emit('close', null, null);f.child.emit('close', 1, null);
    await f.running;
    const error = await f.runner.closeAndDrain().then(() => undefined, value => value);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors[0]).toBeInstanceOf(AggregateError);
    expect(error.errors[0].errors).toContain(failure);
    expect(error.errors[0].errors.map((value: Error) => value.message)).toContain('hook timeout after 50ms');
    expect(error.errors[0].errors.map((value: Error) => value.message)).toContain('hook_windows_tree_termination_failed:null');
  });

  it('starts one owned tree termination when owner abort and timeout both occur', async () => {
    const f = start();await vi.advanceTimersByTimeAsync(0);
    const closing = f.runner.closeAndDrain().then(() => undefined, error => error);
    await vi.advanceTimersByTimeAsync(50);
    expect(f.spawnMock).toHaveBeenCalledTimes(2);
    f.child.emit('close', 1, null);f.killer.emit('close', 0, null);
    expect(await f.running).toMatchObject({ ok: false });expect(await closing).toBeUndefined();
  });

  it('never sends a completed shell PID to taskkill while descendant-held pipes remain unknown', async () => {
    const f = start();let settled = false;void f.running.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);f.child.emit('exit', 0);
    await vi.advanceTimersByTimeAsync(50);
    expect(f.spawnMock).toHaveBeenCalledTimes(1);expect(settled).toBe(false);
    f.child.emit('close', 0, null);await f.running;
    const error = await f.runner.closeAndDrain().then(() => undefined, value => value);
    expect(error.errors[0].errors.map((value: Error) => value.message)).toContain('hook_windows_process_tree_unconfirmed');
  });

  it('retains a helper error even when its subsequent close reports zero', async () => {
    const f = start(), failure = Error('hook timeout after 50ms');
    await vi.advanceTimersByTimeAsync(50);
    f.killer.emit('error', failure);f.killer.emit('close', 0, null);f.child.emit('close', 1, null);
    expect(await f.running).toEqual({ ok: false, message: 'AggregateError: hook_transport_failed; hook timeout after 50ms' });
    const error = await f.runner.closeAndDrain().then(() => undefined, value => value);
    expect(error.errors[0].message).toBe('hook_transport_failed');
    expect(error.errors[0].errors).toContain(failure);
    expect(error.errors[0].errors).toHaveLength(2);
  });

  it('does not transfer a joined timeout fact to another raw promise reusing the exact error object', async () => {
    const errorPrototype: { toString(): string } = Error.prototype;
    const f = start(), originalToString = errorPrototype.toString;
    let timeoutError: Error | undefined;
    const rendering = vi.spyOn(errorPrototype, 'toString').mockImplementation(function(this: Error) {
      if (this.message === 'hook timeout after 50ms') timeoutError = this;
      return originalToString.call(this);
    });
    try {
      await vi.advanceTimersByTimeAsync(50);
      f.killer.emit('close', 0, null);f.child.emit('close', 1, null);
      expect(await f.running).toMatchObject({ ok: false });
    } finally { rendering.mockRestore(); }
    if (!timeoutError) throw Error('original_timeout_not_observed');
    const second = createMockChild({ noExit: true });
    f.spawnMock.mockReturnValueOnce(second);
    const running = f.runner.runPreHooks('write', {});await vi.advanceTimersByTimeAsync(0);
    second.emit('error', timeoutError);second.emit('close', 1, null);await running;
    const error = await f.runner.closeAndDrain().then(() => undefined, value => value);
    expect(error.errors).toEqual([timeoutError]);expect(error.errors[0]).toBe(timeoutError);
  });

  it('retains a synchronous producer-start failure on its registered raw promise', async () => {
    const failure = Error('original_spawn_throw');
    vi.mocked(spawn).mockImplementationOnce(() => { throw failure; });
    const runner = createHooksRunner({ pre: [{ command: 'owned-hook', tools: ['write'] }] });
    expect(await runner.runPreHooks('write', {})).toMatchObject({ ok: false });
    const error = await runner.closeAndDrain().then(() => undefined, value => value);
    expect(error.errors).toEqual([failure]);expect(error.errors[0]).toBe(failure);
  });

  it.each(['ESRCH', 'EPERM', 'alive'] as const)('qualifies a POSIX timeout only after the original group probe proves absence: %s', async probe => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const failure = Object.assign(Error('original_group_probe'), { code: probe });
    const kill = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0 && probe !== 'alive') throw failure;
      return true;
    });
    try {
      const f = start();await vi.advanceTimersByTimeAsync(0);f.child.pid = 54321;
      await vi.advanceTimersByTimeAsync(50);f.child.emit('close', 1, null);
      if (probe === 'alive') await vi.advanceTimersByTimeAsync(250);
      expect(await f.running).toEqual({ ok: false, message: probe === 'ESRCH'
        ? 'Error: hook timeout after 50ms'
        : 'AggregateError: hook_transport_failed; hook timeout after 50ms' });
      expect(kill).toHaveBeenCalledWith(-43210, 'SIGTERM');expect(kill).toHaveBeenCalledWith(-43210, 0);
      if (probe === 'ESRCH') await expect(f.runner.closeAndDrain()).resolves.toBeUndefined();
      else {
        const error = await f.runner.closeAndDrain().then(() => undefined, value => value);
        expect(error).toBeInstanceOf(AggregateError);
        expect(error.errors[0].message).toBe('hook_transport_failed');
        if (probe === 'EPERM') expect(error.errors[0].errors).toContain(failure);
        else expect(error.errors[0].errors.map((value: Error) => value.message)).toContain('hook_process_group_unconfirmed');
      }
    } finally { kill.mockRestore(); }
  });

  function posixProbe(probe: () => void) {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    return vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) probe();
      return true;
    });
  }
  function gone() { throw Object.assign(Error('original_group_absent'), { code: 'ESRCH' }); }

  it('joins transient post-close group presence without repeating termination or retargeting a reused PID', async () => {
    let present = true;
    const kill = posixProbe(() => { if (!present) gone(); });
    try {
      const f = start();await vi.advanceTimersByTimeAsync(50);
      f.child.emit('close', 1, null);f.child.pid = 54321;
      let settled = false;void f.running.then(() => { settled = true; });
      const closing = f.runner.closeAndDrain();
      expect(f.runner.closeAndDrain()).toBe(closing);
      await vi.advanceTimersByTimeAsync(9);expect(settled).toBe(false);
      present = false;await vi.advanceTimersByTimeAsync(1);
      expect(await f.running).toEqual({ ok: false, message: 'Error: hook timeout after 50ms' });
      await expect(closing).resolves.toBeUndefined();
      expect(kill.mock.calls.filter(([, signal]) => signal !== 0)).toEqual([[-43210, 'SIGTERM']]);
      expect(kill.mock.calls.every(([pid]) => pid === -43210)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { kill.mockRestore(); }
  });

  it.each([false, true])('expires permanent presence at the original absolute cleanup deadline despite owner abort: %s', async ownerAbort => {
    const kill = posixProbe(() => {});
    try {
      const f = start();await vi.advanceTimersByTimeAsync(50);f.child.emit('close', 1, null);
      let settled = false;void f.running.then(() => { settled = true; });
      const closing = ownerAbort ? f.runner.closeAndDrain().then(() => undefined, error => error) : undefined;
      await vi.advanceTimersByTimeAsync(249);expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);await f.running;
      const error = closing ? await closing : await f.runner.closeAndDrain().then(() => undefined, value => value);
      expect(error.errors[0].errors.map((value: Error) => value.message)).toEqual([
        'hook timeout after 50ms', 'hook_process_group_unconfirmed',
      ]);
      const calls = kill.mock.calls.length;
      await vi.advanceTimersByTimeAsync(1000);expect(kill).toHaveBeenCalledTimes(calls);
      expect(kill.mock.calls.filter(([, signal]) => signal !== 0)).toEqual([[-43210, 'SIGTERM']]);
      expect(vi.getTimerCount()).toBe(0);
    } finally { kill.mockRestore(); }
  });

  it.each(['EPERM', 'EIO'])('retains an original reprobe error immediately and clears both cleanup timers: %s', async code => {
    const failure = Object.assign(Error('original_reprobe_failure'), { code });
    let probes = 0;
    const kill = posixProbe(() => { if (++probes === 2) throw failure; });
    try {
      const f = start();await vi.advanceTimersByTimeAsync(50);f.child.emit('close', 1, null);
      await vi.advanceTimersByTimeAsync(10);await f.running;
      const error = await f.runner.closeAndDrain().then(() => undefined, value => value);
      expect(error.errors[0].errors).toContain(failure);
      expect(error.errors[0].errors).toHaveLength(2);
      expect(probes).toBe(2);expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(250);expect(probes).toBe(2);
    } finally { kill.mockRestore(); }
  });

  it.each([250, 251])('does not backdate an ESRCH syscall which completes at or beyond the deadline: %s', async elapsed => {
    let clock = 1000, probes = 0;
    vi.mocked(performance.now).mockImplementation(() => clock);
    const kill = posixProbe(() => { if (++probes === 2) { clock = 1000 + elapsed;gone(); } });
    try {
      const f = start();await vi.advanceTimersByTimeAsync(50);f.child.emit('close', 1, null);
      await vi.advanceTimersByTimeAsync(10);await f.running;
      const error = await f.runner.closeAndDrain().then(() => undefined, value => value);
      expect(error.errors[0].errors.map((value: Error) => value.message)).toContain('hook_process_group_unconfirmed');
      expect(probes).toBe(2);expect(vi.getTimerCount()).toBe(0);
    } finally { kill.mockRestore(); }
  });

  it('does not probe or accept absence when a delayed reprobe starts at the deadline', async () => {
    let clock = 1000, probes = 0;
    vi.mocked(performance.now).mockImplementation(() => clock);
    const kill = posixProbe(() => { if (++probes > 1) gone(); });
    try {
      const f = start();await vi.advanceTimersByTimeAsync(50);f.child.emit('close', 1, null);
      clock = 1250;await vi.advanceTimersByTimeAsync(10);await f.running;
      const error = await f.runner.closeAndDrain().then(() => undefined, value => value);
      expect(error.errors[0].errors.map((value: Error) => value.message)).toContain('hook_process_group_unconfirmed');
      expect(probes).toBe(1);expect(vi.getTimerCount()).toBe(0);
    } finally { kill.mockRestore(); }
  });

  it.each([NaN, Infinity, -1, Number.MAX_SAFE_INTEGER])('fails closed on an invalid cleanup clock without probing: %s', async value => {
    vi.mocked(performance.now).mockReturnValue(value);
    const kill = posixProbe(gone);
    try {
      const f = start();await vi.advanceTimersByTimeAsync(50);f.child.emit('close', 1, null);await f.running;
      const error = await f.runner.closeAndDrain().then(() => undefined, result => result);
      expect(error.errors[0].errors.map((item: Error) => item.message)).toContain('hook_process_group_clock_invalid');
      expect(kill.mock.calls.filter(([, signal]) => signal === 0)).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally { kill.mockRestore(); }
  });

  it('retains a thrown clock error by identity without claiming absence', async () => {
    const failure = Error('original_monotonic_clock_failure');
    vi.mocked(performance.now).mockImplementation(() => { throw failure; });
    const kill = posixProbe(gone);
    try {
      const f = start();await vi.advanceTimersByTimeAsync(50);f.child.emit('close', 1, null);await f.running;
      const error = await f.runner.closeAndDrain().then(() => undefined, result => result);
      expect(error.errors[0].errors).toContain(failure);
      expect(kill.mock.calls.filter(([, signal]) => signal === 0)).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally { kill.mockRestore(); }
  });

  it('rejects a clock rollback on reprobe rather than extending the cleanup window', async () => {
    let clock = 1000;
    vi.mocked(performance.now).mockImplementation(() => clock);
    const kill = posixProbe(() => {});
    try {
      const f = start();await vi.advanceTimersByTimeAsync(50);f.child.emit('close', 1, null);
      clock = 999;await vi.advanceTimersByTimeAsync(10);await f.running;
      const error = await f.runner.closeAndDrain().then(() => undefined, value => value);
      expect(error.errors[0].errors.map((value: Error) => value.message)).toContain('hook_process_group_clock_invalid');
      expect(kill.mock.calls.filter(([, signal]) => signal === 0)).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally { kill.mockRestore(); }
  });

  it('bounds permanent presence with the independent hard stop even if the clock is frozen', async () => {
    vi.mocked(performance.now).mockReturnValue(1000);
    const kill = posixProbe(() => {});
    try {
      const f = start();await vi.advanceTimersByTimeAsync(50);f.child.emit('close', 1, null);
      let settled = false;void f.running.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(249);expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);await f.running;
      const error = await f.runner.closeAndDrain().then(() => undefined, value => value);
      expect(error.errors[0].errors.map((value: Error) => value.message)).toContain('hook_process_group_unconfirmed');
      expect(vi.getTimerCount()).toBe(0);
    } finally { kill.mockRestore(); }
  });

  it('removes the original abort listener and business timer at close and screens an already queued abort', async () => {
    const captured: { listener?: EventListenerOrEventListenerObject | null; signal?: AbortSignal } = {};
    const originalAdd = AbortSignal.prototype.addEventListener;
    const add = vi.spyOn(AbortSignal.prototype, 'addEventListener').mockImplementation(function(this: AbortSignal, type, listener, options) {
      if (type === 'abort') { captured.listener = listener; captured.signal = this; }
      originalAdd.call(this, type, listener, options);
    });
    const remove = vi.spyOn(AbortSignal.prototype, 'removeEventListener');
    let present = true;
    const kill = posixProbe(() => { if (!present) gone(); });
    try {
      const f = start();await vi.advanceTimersByTimeAsync(0);
      const { listener: capturedAbort, signal: originalSignal } = captured;
      if (!capturedAbort || !originalSignal) throw Error('original_abort_listener_not_observed');
      f.child.emit('close', 0, null);f.child.pid = 54321;
      expect(remove).toHaveBeenCalledWith('abort', capturedAbort);
      const closing = f.runner.closeAndDrain();
      // Exercise even an already queued callback, after listener removal.
      if (typeof capturedAbort === 'function') capturedAbort.call(originalSignal, new Event('abort'));
      else capturedAbort.handleEvent(new Event('abort'));
      await vi.advanceTimersByTimeAsync(60); // Past the original 50ms business timeout.
      expect(kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true);
      expect(kill.mock.calls.every(([pid]) => pid === -43210)).toBe(true);
      present = false;await vi.advanceTimersByTimeAsync(10);
      await f.running;await expect(closing).resolves.toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally { kill.mockRestore(); remove.mockRestore(); add.mockRestore(); }
  });

  it('does not qualify another transport error merely because the original group eventually disappears', async () => {
    let present = true;
    const failure = Error('original_pipe_failure');
    const kill = posixProbe(() => { if (!present) gone(); });
    try {
      const f = start();await vi.advanceTimersByTimeAsync(50);
      f.child.emit('error', failure);f.child.emit('close', 1, null);
      present = false;await vi.advanceTimersByTimeAsync(10);await f.running;
      const error = await f.runner.closeAndDrain().then(() => undefined, value => value);
      expect(error.errors[0].errors).toContain(failure);
      expect(error.errors[0].errors.map((value: Error) => value.message)).toContain('hook timeout after 50ms');
      expect(vi.getTimerCount()).toBe(0);
    } finally { kill.mockRestore(); }
  });

  it('does not invent a process group or timeout closure fact when the original spawn had no PID', async () => {
    const kill = posixProbe(gone);
    try {
      const child = createMockChild({ noExit: true });
      const spawnMock = vi.mocked(spawn) as any;spawnMock.mockReturnValueOnce(child);
      const runner = createHooksRunner({ pre: [{ command: 'owned-hook', tools: ['write'] }], timeoutMs: 50 });
      const running = runner.runPreHooks('write', {});
      await vi.advanceTimersByTimeAsync(50);await running;
      const error = await runner.closeAndDrain().then(() => undefined, value => value);
      expect(error.errors[0].message).toBe('hook timeout after 50ms');
      expect(kill).not.toHaveBeenCalled();expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(vi.getTimerCount()).toBe(0);
    } finally { kill.mockRestore(); }
  });

  it.each(['command', 'prompt'] as const)('does not transfer timeout diagnostics with a reused aggregate to another %s producer', async producer => {
    const first = start(), failure = Error('original_helper_failure');
    await vi.advanceTimersByTimeAsync(50);
    first.killer.emit('error', failure);first.killer.emit('close', 0, null);first.child.emit('close', 1, null);
    expect(await first.running).toEqual({ ok: false, message: 'AggregateError: hook_transport_failed; hook timeout after 50ms' });
    const closing = await first.runner.closeAndDrain().then(() => undefined, value => value);
    const aggregate = closing.errors[0];
    expect(aggregate).toBeInstanceOf(AggregateError);expect(aggregate.errors).toContain(failure);
    if (producer === 'command') {
      const second = start();await vi.advanceTimersByTimeAsync(0);
      second.child.emit('error', aggregate);second.child.emit('close', 1, null);
      expect(await second.running).toEqual({ ok: false, message: 'AggregateError: hook_transport_failed' });
      const error = await second.runner.closeAndDrain().then(() => undefined, value => value);
      expect(error.errors).toEqual([aggregate]);expect(error.errors[0]).toBe(aggregate);
    } else {
      const runner = createHooksRunner({ hooks: [{ type: 'prompt', events: ['SessionStart'], prompt: '$ARGUMENTS' }],
        promptExecutor: async () => { throw aggregate; } });
      expect((await runner.runHooks('SessionStart', {})).message).toBe('AggregateError: hook_transport_failed');
      const error = await runner.closeAndDrain().then(() => undefined, value => value);
      expect(error.errors).toEqual([aggregate]);expect(error.errors[0]).toBe(aggregate);
    }
  });
});

describe('hooks runner unknown event handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('warns and ignores unknown event names rather than throwing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      createHooksRunner({
        hooks: [
          {
            type: 'command',
            command: 'echo deprecated',
            events: ['Notification', 'PreCompact', 'PreToolUse'] as any,
          },
        ],
      });
      expect(warnSpy).toHaveBeenCalled();
      const messages = warnSpy.mock.calls.map((args) => args.join(' '));
      expect(messages.some((m) => m.includes('Notification'))).toBe(true);
      expect(messages.some((m) => m.includes('PreCompact'))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not invoke hooks for deleted events', async () => {
    const mockExec = vi.mocked(spawn) as any;
    mockExec.mockImplementation(() => createMockChild({ exitCode: 0 }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const runner = createHooksRunner({
        hooks: [
          {
            type: 'command',
            command: 'echo never',
            events: ['Notification'] as any,
          },
        ],
      });
      await runner.runHooks('Notification' as any, {});
      expect(mockExec).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
