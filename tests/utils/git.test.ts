import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFile } from 'child_process';

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('util', () => ({
  promisify: (fn: any) => fn,
}));

import { getCurrentBranch } from '../../src/utils/git.js';

describe('getCurrentBranch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return branch name on success', async () => {
    const mockExecFile = vi.mocked(execFile) as any;
    mockExecFile.mockResolvedValue({ stdout: 'main\n', stderr: '' });

    const branch = await getCurrentBranch('/some/path');
    expect(branch).toBe('main');
  });

  it('should trim whitespace from branch name', async () => {
    const mockExecFile = vi.mocked(execFile) as any;
    mockExecFile.mockResolvedValue({ stdout: '  feature/my-branch  \n', stderr: '' });

    const branch = await getCurrentBranch('/some/path');
    expect(branch).toBe('feature/my-branch');
  });

  it('should return empty string when not in a git repo', async () => {
    const mockExecFile = vi.mocked(execFile) as any;
    mockExecFile.mockRejectedValue(new Error('not a git repository'));

    const branch = await getCurrentBranch('/some/path');
    expect(branch).toBe('');
  });

  it('should return empty string on any error', async () => {
    const mockExecFile = vi.mocked(execFile) as any;
    mockExecFile.mockRejectedValue(new Error('git not found'));

    const branch = await getCurrentBranch('/some/path');
    expect(branch).toBe('');
  });
});
