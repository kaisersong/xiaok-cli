import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createLoopCommandAllowlist,
  runAllowedLoopCommandCriterion,
} from '../../electron/loop-command-allowlist.js';

describe('loop command allowlist', () => {
  it('resolves exact commandId definitions into fixed spawn invocations', () => {
    const allowlist = createLoopCommandAllowlist([
      {
        commandId: 'npm-test',
        command: { default: 'npm', win32: 'npm.cmd' },
        args: ['test'],
        cwdPolicy: 'workspace',
      },
    ]);

    expect(allowlist.resolve({
      commandId: 'npm-test',
      args: [],
      cwdPolicy: 'workspace',
      workspaceRoot: join('tmp', 'workspace'),
    })).toEqual({
      ok: true,
      invocation: {
        command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
        args: ['test'],
        cwd: join('tmp', 'workspace'),
        shell: process.platform === 'win32',
      },
    });
  });

  it('rejects unknown commandIds and cwd policies before building an invocation', () => {
    const allowlist = createLoopCommandAllowlist([
      {
        commandId: 'npm-test',
        command: { default: 'npm', win32: 'npm.cmd' },
        args: ['test'],
        cwdPolicy: 'workspace',
      },
    ]);

    expect(allowlist.resolve({
      commandId: 'npm-test -- --watch',
      args: [],
      cwdPolicy: 'workspace',
      workspaceRoot: '/workspace',
    })).toEqual({
      ok: false,
      reason: 'command_not_allowlisted',
      message: 'Loop command is not allowlisted: npm-test -- --watch',
    });

    expect(allowlist.resolve({
      commandId: 'npm-test',
      args: [],
      cwdPolicy: 'output_dir',
      workspaceRoot: '/workspace',
      outputDirectory: '/workspace/out',
    })).toEqual({
      ok: false,
      reason: 'cwd_policy_not_allowed',
      message: 'Loop command npm-test does not allow cwd policy output_dir.',
    });
  });

  it('rejects unexpected or unsafe dynamic args', () => {
    const allowlist = createLoopCommandAllowlist([
      {
        commandId: 'pytest-file',
        command: 'python',
        args: ['-m', 'pytest'],
        cwdPolicy: 'workspace',
        dynamicArgs: { maxCount: 1, pattern: '^[A-Za-z0-9_./-]+$' },
      },
    ]);

    expect(allowlist.resolve({
      commandId: 'pytest-file',
      args: ['tests/main.test.py'],
      cwdPolicy: 'workspace',
      workspaceRoot: '/workspace',
    })).toMatchObject({
      ok: true,
      invocation: {
        command: 'python',
        args: ['-m', 'pytest', 'tests/main.test.py'],
      },
    });

    expect(allowlist.resolve({
      commandId: 'pytest-file',
      args: ['tests/main.test.py', 'tests/other.test.py'],
      cwdPolicy: 'workspace',
      workspaceRoot: '/workspace',
    })).toEqual({
      ok: false,
      reason: 'unexpected_command_args',
      message: 'Loop command pytest-file accepts at most 1 dynamic args.',
    });

    expect(allowlist.resolve({
      commandId: 'pytest-file',
      args: ['tests/main.test.py; rm -rf ~'],
      cwdPolicy: 'workspace',
      workspaceRoot: '/workspace',
    })).toEqual({
      ok: false,
      reason: 'unsafe_command_arg',
      message: 'Loop command pytest-file rejected unsafe arg at index 0.',
    });
  });

  it('runs command_exit_zero criteria through the allowlist and maps exit codes to evaluator verdicts', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'xiaok-loop-command-'));
    const allowlist = createLoopCommandAllowlist([
      {
        commandId: 'node-ok',
        command: process.execPath,
        args: ['--eval', 'process.exit(0)'],
        cwdPolicy: 'workspace',
      },
      {
        commandId: 'node-fail',
        command: process.execPath,
        args: ['--eval', 'process.exit(7)'],
        cwdPolicy: 'workspace',
      },
    ]);
    try {
      await expect(runAllowedLoopCommandCriterion({
        allowlist,
        criterion: { kind: 'command_exit_zero', commandId: 'node-ok', args: [], cwdPolicy: 'workspace' },
        workspaceRoot: workspace,
        timeoutMs: 15_000,
      })).resolves.toEqual({
        status: 'passed',
        evidenceIds: [],
        summary: 'Loop command node-ok exited with code 0.',
      });

      await expect(runAllowedLoopCommandCriterion({
        allowlist,
        criterion: { kind: 'command_exit_zero', commandId: 'node-fail', args: [], cwdPolicy: 'workspace' },
        workspaceRoot: workspace,
        timeoutMs: 15_000,
      })).resolves.toEqual({
        status: 'failed',
        evidenceIds: [],
        failureKind: 'validation_failed',
        message: 'Loop command node-fail exited with code 7.',
      });

      await expect(runAllowedLoopCommandCriterion({
        allowlist,
        criterion: { kind: 'command_exit_zero', commandId: 'node-missing', args: [], cwdPolicy: 'workspace' },
        workspaceRoot: workspace,
        timeoutMs: 15_000,
      })).resolves.toEqual({
        status: 'blocked',
        evidenceIds: [],
        nextActionKind: 'command_not_allowlisted',
        nextActionSummary: 'Loop command is not allowlisted: node-missing',
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
