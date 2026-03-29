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
});
