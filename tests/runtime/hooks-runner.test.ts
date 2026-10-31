import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { win32 } from 'node:path';

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
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(spawn).mockReset();
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.stubEnv('SystemRoot', 'C:\\Windows');
  });
  afterEach(() => {
    if (platform) Object.defineProperty(process, 'platform', platform);
    vi.mocked(spawn).mockReset();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });
  function start() {
    const child = Object.assign(createMockChild({ noExit: true }), { pid: 43210, exitCode: null, signalCode: null });
    const killer = createMockChild({ noExit: true });
    const spawnMock = vi.mocked(spawn) as any;
    spawnMock.mockReturnValueOnce(child).mockReturnValueOnce(killer);
    const runner = createHooksRunner({ pre: [{ command: 'owned-hook', tools: ['write'] }], timeoutMs: 50 });
    const running = runner.runPreHooks('write', {});
    return { child, killer, runner, running, spawnMock };
  }

  it('targets only the original live shell tree and joins the termination helper after hook pipes close', async () => {
    const f = start();
    let settled = false;void f.running.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(50);
    expect(f.spawnMock).toHaveBeenLastCalledWith(win32.join('C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', '43210', '/T', '/F'], { shell: false, stdio: 'ignore', windowsHide: true });
    expect(f.child.kill).not.toHaveBeenCalled();
    f.child.emit('exit', 1);f.child.emit('close', 1, null);
    const closing = f.runner.closeAndDrain().then(() => undefined, error => error);
    await vi.advanceTimersByTimeAsync(0);expect(settled).toBe(false);
    f.killer.emit('close', 0, null);
    expect(await f.running).toMatchObject({ ok: false });
    expect((await closing).message).toBe('hook_physical_drain_unconfirmed');
  });

  it('does not equate taskkill completion or shell exit with inherited pipe closure', async () => {
    const f = start();let settled = false;void f.running.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(50);
    f.child.emit('exit', 1);f.killer.emit('close', 0, null);
    await vi.advanceTimersByTimeAsync(0);expect(settled).toBe(false);
    f.child.emit('close', 1, null);
    expect(await f.running).toMatchObject({ ok: false });
    await expect(f.runner.closeAndDrain()).rejects.toThrow('hook_physical_drain_unconfirmed');
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
    await f.running;expect((await closing).message).toBe('hook_physical_drain_unconfirmed');
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
