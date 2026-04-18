import { describe, expect, it } from 'vitest';
import { createSandboxPolicy } from '../../../src/platform/sandbox/policy.js';
import { createSandboxEnforcer } from '../../../src/platform/sandbox/enforcer.js';
import { applySandboxToTools, type SandboxDenialCallback } from '../../../src/platform/sandbox/tool-wrappers.js';
import type { Tool } from '../../../src/types.js';

/** 伪造一个 read 工具 */
function fakeReadTool(): Tool {
  return {
    definition: {
      name: 'read',
      description: 'Read a file',
      inputSchema: {
        type: 'object',
        properties: { file_path: { type: 'string' } },
        required: ['file_path'],
      },
    },
    permission: 'safe',
    execute: async (input: Record<string, unknown>) => `content of ${input.file_path}`,
  };
}

/** 伪造一个 bash 工具 */
function fakeBashTool(): Tool {
  return {
    definition: {
      name: 'bash',
      description: 'Run bash command',
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string' }, workdir: { type: 'string' } },
        required: ['command'],
      },
    },
    permission: 'unsafe',
    execute: async (input: Record<string, unknown>) => `executed: ${input.command} in ${input.workdir ?? '.'}`,
  };
}

describe('sandbox tool wrappers — denial callback flow', () => {
  it('calls onSandboxDenied when read is blocked and retries if shouldProceed=true', async () => {
    const policy = createSandboxPolicy({ allowedPaths: new Set(['/repo']) });
    const enforcer = createSandboxEnforcer(policy);

    const calls: string[] = [];
    const callback: SandboxDenialCallback = async (path, toolName) => {
      calls.push(`${toolName}:${path}`);
      // Expand allowlist and allow retry
      policy.expandAllowedPaths(['/external']);
      return { shouldProceed: true };
    };

    const wrapped = applySandboxToTools([fakeReadTool()], enforcer, callback);
    const result = await wrapped[0]!.execute({ file_path: '/external/docs/file.md' });

    expect(calls).toEqual(['read:/external/docs/file.md']);
    expect(result).toBe('content of /external/docs/file.md');
  });

  it('returns denial error when onSandboxDenied returns shouldProceed=false', async () => {
    const policy = createSandboxPolicy({ allowedPaths: new Set(['/repo']) });
    const enforcer = createSandboxEnforcer(policy);

    const callback: SandboxDenialCallback = async () => ({ shouldProceed: false });

    const wrapped = applySandboxToTools([fakeReadTool()], enforcer, callback);
    const result = await wrapped[0]!.execute({ file_path: '/external/docs/file.md' });

    expect(result).toContain('sandbox denied path');
  });

  it('returns denial error when expansion does not cover the specific path', async () => {
    const policy = createSandboxPolicy({ allowedPaths: new Set(['/repo']) });
    const enforcer = createSandboxEnforcer(policy);

    // Callback expands to /other, but the file is in /external — still blocked
    const callback: SandboxDenialCallback = async () => {
      policy.expandAllowedPaths(['/other']);
      return { shouldProceed: true };
    };

    const wrapped = applySandboxToTools([fakeReadTool()], enforcer, callback);
    const result = await wrapped[0]!.execute({ file_path: '/external/docs/file.md' });

    expect(result).toContain('sandbox denied path');
  });

  it('calls onSandboxDenied for bash workdir and retries', async () => {
    const policy = createSandboxPolicy({ allowedPaths: new Set(['/repo']) });
    const enforcer = createSandboxEnforcer(policy);

    const calls: string[] = [];
    const callback: SandboxDenialCallback = async (path, toolName) => {
      calls.push(`${toolName}:${path}`);
      policy.expandAllowedPaths(['/external']);
      return { shouldProceed: true };
    };

    const wrapped = applySandboxToTools([fakeBashTool()], enforcer, callback);
    const result = await wrapped[0]!.execute({ command: 'ls', workdir: '/external/work' });

    expect(calls).toEqual(['bash:/external/work']);
    expect(result).toBe('executed: ls in /external/work');
  });

  it('falls through to error when onSandboxDenied is not provided', async () => {
    const policy = createSandboxPolicy({ allowedPaths: new Set(['/repo']) });
    const enforcer = createSandboxEnforcer(policy);

    const wrapped = applySandboxToTools([fakeReadTool()], enforcer, undefined);
    const result = await wrapped[0]!.execute({ file_path: '/external/docs/file.md' });

    expect(result).toContain('sandbox denied path');
  });

  it('write and edit tools also trigger denial callback', async () => {
    const policy = createSandboxPolicy({ allowedPaths: new Set(['/repo']) });
    const enforcer = createSandboxEnforcer(policy);

    const calls: string[] = [];
    const callback: SandboxDenialCallback = async (path, toolName) => {
      calls.push(`${toolName}:${path}`);
      policy.expandAllowedPaths([path]); // expand exact file path only
      return { shouldProceed: true };
    };

    const writeTool: Tool = {
      definition: {
        name: 'write',
        description: 'Write a file',
        inputSchema: {
          type: 'object',
          properties: { file_path: { type: 'string' }, content: { type: 'string' } },
          required: ['file_path', 'content'],
        },
      },
      permission: 'unsafe',
      execute: async (input: Record<string, unknown>) => `wrote ${input.file_path}`,
    };

    const editTool: Tool = {
      definition: {
        name: 'edit',
        description: 'Edit a file',
        inputSchema: {
          type: 'object',
          properties: { file_path: { type: 'string' } },
          required: ['file_path'],
        },
      },
      permission: 'unsafe',
      execute: async (input: Record<string, unknown>) => `edited ${input.file_path}`,
    };

    const wrapped = applySandboxToTools([writeTool, editTool], enforcer, callback);

    const writeResult = await wrapped[0]!.execute({ file_path: '/external/new.md', content: 'hi' });
    const editResult = await wrapped[1]!.execute({ file_path: '/external/old.md' });

    expect(calls).toEqual(['write:/external/new.md', 'edit:/external/old.md']);
    expect(writeResult).toBe('wrote /external/new.md');
    expect(editResult).toBe('edited /external/old.md');
  });

  it('does not trigger callback for allowed paths', async () => {
    const policy = createSandboxPolicy({ allowedPaths: new Set(['/repo']) });
    const enforcer = createSandboxEnforcer(policy);

    let callbackInvoked = false;
    const callback: SandboxDenialCallback = async () => {
      callbackInvoked = true;
      return { shouldProceed: true };
    };

    const wrapped = applySandboxToTools([fakeReadTool()], enforcer, callback);
    const result = await wrapped[0]!.execute({ file_path: '/repo/src/index.ts' });

    expect(callbackInvoked).toBe(false);
    expect(result).toBe('content of /repo/src/index.ts');
  });
});
