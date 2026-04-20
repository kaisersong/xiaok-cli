import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exec } from 'child_process';
import { EventEmitter } from 'events';

vi.mock('child_process', () => ({
  exec: vi.fn(),
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
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
    unref: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.kill = vi.fn(() => { child.emit('exit', 1); });
  child.unref = vi.fn();

  if (!opts.noExit) {
    setTimeout(() => {
      if (opts.stdout) child.stdout.emit('data', opts.stdout);
      if (opts.stderr) child.stderr.emit('data', opts.stderr);
      child.emit('exit', opts.exitCode ?? 0);
    }, opts.delay ?? 0);
  }

  return child;
}

describe('hooks runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks tool execution when a matching pre hook fails (exit code 2)', async () => {
    const mockExec = vi.mocked(exec) as any;
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
    const mockExec = vi.mocked(exec) as any;
    const runner = createHooksRunner({
      pre: [{ command: 'echo pre', tools: ['bash'] }],
      timeoutMs: 500,
    });

    const result = await runner.runPreHooks('write', { file_path: '/tmp/x' });

    expect(result.ok).toBe(true);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('returns a warning when a post hook fails (non-zero exit)', async () => {
    const mockExec = vi.mocked(exec) as any;
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
    const mockExec = vi.mocked(exec) as any;
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
    const mockExec = vi.mocked(exec) as any;
    const child = createMockChild({ exitCode: 0 });
    mockExec.mockImplementation(() => child);

    const runner = createHooksRunner({
      pre: [{ command: 'cat', tools: ['write'] }],
      context: { session_id: 'test-session', cwd: '/tmp' },
    });

    await runner.runPreHooks('write', { file_path: '/tmp/x' });

    expect(child.stdin.write).toHaveBeenCalled();
    const payload = JSON.parse(child.stdin.write.mock.calls[0][0]);
    expect(payload.hook_event_name).toBe('PreToolUse');
    expect(payload.session_id).toBe('test-session');
    expect(payload.tool_name).toBe('write');
  });

  it('parses structured JSON output from hook stdout', async () => {
    const mockExec = vi.mocked(exec) as any;
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
    const mockExec = vi.mocked(exec) as any;
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
    const mockExec = vi.mocked(exec) as any;
    mockExec.mockImplementation(() => createMockChild({ exitCode: 0 }));

    const runner = createHooksRunner({
      hooks: [{ type: 'command', command: 'echo once', events: ['PreToolUse'], once: true }],
    });

    await runner.runPreHooks('write', {});
    await runner.runPreHooks('write', {});

    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it('runs async hooks without blocking', async () => {
    const mockExec = vi.mocked(exec) as any;
    const child = createMockChild({ noExit: true });
    mockExec.mockImplementation(() => child);

    const runner = createHooksRunner({
      hooks: [{ type: 'command', command: 'slow-task', events: ['PostToolUse'], async: true }],
    });

    const result = await runner.runHooks('PostToolUse', { tool_name: 'Bash' });

    expect(result.ok).toBe(true);
    expect(result.async).toBe(true);
    expect(child.unref).toHaveBeenCalled();
  });

  it('parses structured allow decisions from PermissionRequest hook output', async () => {
    const mockExec = vi.mocked(exec) as any;
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
    const mockExec = vi.mocked(exec) as any;
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
