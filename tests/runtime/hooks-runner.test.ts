import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exec } from 'child_process';

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

import { createHooksRunner } from '../../src/runtime/hooks-runner.js';

describe('hooks runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks tool execution when a matching pre hook fails', async () => {
    const mockExec = vi.mocked(exec) as any;
    mockExec.mockImplementation((_command: string, _options: unknown, callback: Function) => {
      callback(new Error('blocked by pre hook'), '', 'pre failed');
      return { kill: vi.fn() };
    });

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

  it('returns a warning when a post hook fails', async () => {
    const mockExec = vi.mocked(exec) as any;
    mockExec.mockImplementation((_command: string, _options: unknown, callback: Function) => {
      callback(new Error('post hook failed'), '', 'warning');
      return { kill: vi.fn() };
    });

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
    const kill = vi.fn();
    mockExec.mockImplementation((_command: string, _options: unknown, _callback: Function) => {
      return { kill };
    });

    const runner = createHooksRunner({
      pre: [{ command: 'sleep 10', tools: ['write'] }],
      timeoutMs: 1,
    });

    const result = await runner.runPreHooks('write', { file_path: '/tmp/x' });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('timeout');
    expect(kill).toHaveBeenCalled();
  });
});
