import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'child_process';
import { Command } from 'commander';

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('util', () => ({
  promisify: (fn: any) => fn,
}));

import { runCommitCommand, registerCommitCommands } from '../../src/commands/commit.js';
import { runReviewCommand, registerReviewCommands } from '../../src/commands/review.js';
import { runPrCommand, registerPrCommands } from '../../src/commands/pr.js';

describe('git workflow commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers commit, review, and pr as top-level commands', () => {
    const program = new Command();

    registerCommitCommands(program);
    registerReviewCommands(program);
    registerPrCommands(program);

    const commandNames = program.commands.map((command) => command.name());

    expect(commandNames).toContain('commit');
    expect(commandNames).toContain('review');
    expect(commandNames).toContain('pr');
  });

  it('runCommitCommand should ask the user to stage files first when index is empty', async () => {
    const mockExecFile = vi.mocked(execFile) as any;
    mockExecFile.mockResolvedValueOnce({ stdout: '/repo\n', stderr: '' });
    mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await runCommitCommand('/repo');

    expect(result).toContain('没有已暂存的改动');
    expect(mockExecFile).toHaveBeenNthCalledWith(
      2,
      'git',
      ['diff', '--cached', '--name-only'],
      { cwd: '/repo' },
    );
  });

  it('runCommitCommand should commit with the provided message', async () => {
    const mockExecFile = vi.mocked(execFile) as any;
    mockExecFile.mockResolvedValueOnce({ stdout: '/repo\n', stderr: '' });
    mockExecFile.mockResolvedValueOnce({ stdout: 'src/commands/chat.ts\n', stderr: '' });
    mockExecFile.mockResolvedValueOnce({ stdout: '[master abc123] feat: wire workflow\n', stderr: '' });

    const result = await runCommitCommand('/repo', 'feat: wire workflow');

    expect(result).toContain('已创建提交');
    expect(result).toContain('feat: wire workflow');
    expect(mockExecFile).toHaveBeenNthCalledWith(
      3,
      'git',
      ['commit', '-m', 'feat: wire workflow'],
      { cwd: '/repo' },
    );
  });

  it('runReviewCommand should summarize staged and unstaged diff stats', async () => {
    const mockExecFile = vi.mocked(execFile) as any;
    mockExecFile.mockResolvedValueOnce({ stdout: '/repo\n', stderr: '' });
    mockExecFile.mockResolvedValueOnce({ stdout: 'M  src/commands/chat.ts\n?? tests/commands/git-workflow.test.ts\n', stderr: '' });
    mockExecFile.mockResolvedValueOnce({ stdout: ' src/commands/chat.ts | 12 +++++++-----\n 1 file changed, 7 insertions(+), 5 deletions(-)\n', stderr: '' });
    mockExecFile.mockResolvedValueOnce({ stdout: ' tests/commands/git-workflow.test.ts | 40 ++++++++++++++++++++++++++++++++\n 1 file changed, 40 insertions(+)\n', stderr: '' });

    const result = await runReviewCommand('/repo');

    expect(result).toContain('当前改动概览');
    expect(result).toContain('src/commands/chat.ts');
    expect(result).toContain('暂存改动');
    expect(result).toContain('未暂存改动');
  });

  it('runReviewCommand should explain when cwd is not a git repo', async () => {
    const mockExecFile = vi.mocked(execFile) as any;
    mockExecFile.mockRejectedValueOnce(new Error('not a git repo'));

    const result = await runReviewCommand('/repo');

    expect(result).toContain('当前目录不是 Git 仓库');
  });

  it('runPrCommand should generate a preview when gh is unavailable', async () => {
    const mockExecFile = vi.mocked(execFile) as any;
    mockExecFile.mockResolvedValueOnce({ stdout: '/repo\n', stderr: '' });
    mockExecFile.mockResolvedValueOnce({ stdout: 'feature/workflow\n', stderr: '' });
    mockExecFile.mockResolvedValueOnce({ stdout: 'feat: workflow support\nfix: polish output\n', stderr: '' });
    mockExecFile.mockResolvedValueOnce({ stdout: ' src/commands/chat.ts | 20 ++++++++++++++++\n 1 file changed, 20 insertions(+)\n', stderr: '' });
    mockExecFile.mockRejectedValueOnce(new Error('gh not found'));

    const result = await runPrCommand('/repo');

    expect(result).toContain('PR 预览');
    expect(result).toContain('feat: workflow support');
    expect(result).toContain('未检测到 gh');
  });

  it('runPrCommand should refuse to create a PR from the main branch', async () => {
    const mockExecFile = vi.mocked(execFile) as any;
    mockExecFile.mockResolvedValueOnce({ stdout: '/repo\n', stderr: '' });
    mockExecFile.mockResolvedValueOnce({ stdout: 'main\n', stderr: '' });

    const result = await runPrCommand('/repo');

    expect(result).toContain('主分支');
  });
});
