import { describe, it, expect } from 'vitest';
import { bashTool } from '../../../src/ai/tools/bash.js';

describe('bashTool', () => {
  it('runs a command and returns stdout', async () => {
    const result = await bashTool.execute({ command: 'echo hello' });
    expect(result).toContain('hello');
  });

  it('returns stderr on failure', async () => {
    const result = await bashTool.execute({ command: 'ls /nonexistent_path_xyz_abc' });
    expect(result).toMatch(/Error|No such file|cannot access/i);
  });

  it('respects timeout and kills process', async () => {
    // Use platform-appropriate long-running command
    const command = process.platform === 'win32'
      ? 'ping -n 15 127.0.0.1'
      : 'sleep 10';
    const start = Date.now();
    const result = await bashTool.execute({ command, timeout_ms: 200 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
    expect(result).toContain('超时');
  }, 8000);

  it.runIf(process.platform === 'win32')('returns promptly when a command reports elevation is required', async () => {
    const command = 'echo Install requires administrator privileges; please run manually & ping -n 10 127.0.0.1 >nul';
    const start = Date.now();
    const result = await bashTool.execute({ command, timeout_ms: 1500 });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(result).toMatch(/administrator|管理员权限/i);
    expect(result).not.toContain('超时');
  }, 5000);
});
