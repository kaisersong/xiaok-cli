import { afterEach, expect, it } from 'vitest';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry, type CompoundRegistryExecutionPort, type RegistryOptions } from '../../../src/ai/tools/index.js';
import { createWriteTool } from '../../../src/ai/tools/write.js';
import { mcpTestContext } from '../../support/mcp-cancellation-context.js';
const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
const port: CompoundRegistryExecutionPort = { async execute({ name, input, native }) {
  const result = await native.prepare(name, input as Record<string, unknown>);
  return result.kind === 'prepared' ? native.execute(result.invocation) : result.message;
} };
it.each(['execute-boolean', 'execute-grant', 'split-boolean', 'split-grant', 'compound-boolean', 'compound-grant'] as const)(
  'keeps the original private input contract during actual %s approval', async mode => {
    const cwd = mkdtempSync(join(tmpdir(), 'xiaok-approval-ingress-'));
    cleanup.push(() => rmSync(cwd, { recursive: true, force: true }));
    const input = { file_path: join(cwd, 'effect.txt'), content: 'ORIGINAL_APPROVAL' };
    let prompts = 0;
    const registry = new ToolRegistry({ compoundExecution: mode.startsWith('compound') ? port : undefined,
      onPrompt: async () => { prompts++; input.content = 'NOT_APPROVED';
        return mode.endsWith('grant') ? { approved: true, assertCurrent() {}, prepareInput: value => value } : true;
      },
    }, [createWriteTool({ cwd })]);
    cleanup.push(() => registry.dispose());
    const context = mcpTestContext(new AbortController().signal);
    const result = mode.startsWith('split')
      ? await registry.prepareToolInvocation('write', input, context)
      : await registry.executeTool('write', input, context);
    expect(prompts).toBe(1);
    if (mode.startsWith('compound')) {
      expect(typeof result).toBe('string');expect(result).toMatch(/input.*(?:changed|approval)/);
      expect(existsSync(input.file_path)).toBe(false);
    } else {
      if (mode.startsWith('split')) {
        expect(typeof result).not.toBe('string');
        if (typeof result !== 'string') await registry.executePreparedTool(result);
      }
      expect(readFileSync(input.file_path,'utf8')).toBe('ORIGINAL_APPROVAL');
      expect(input.content).toBe('NOT_APPROVED');expect(prompts).toBe(1);
    }
  });
it('PermissionRequest allow executes its private original input when caller input changes during the hook', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'xiaok-approval-ingress-hook-'));
  cleanup.push(() => rmSync(cwd, { recursive: true, force: true }));
  const input = { file_path: join(cwd, 'effect.txt'), content: 'ORIGINAL_APPROVAL' };
  const hooksRunner = { runHooks: async (event: string) => {
    if (event === 'PermissionRequest') { input.content = 'NOT_APPROVED'; return { ok: true, decision: 'allow' }; }
    return { ok: true };
  }, runPreHooks: async () => ({ ok: true }), runPostHooks: async () => [] } as unknown as RegistryOptions['hooksRunner'];
  const registry = new ToolRegistry({ hooksRunner }, [createWriteTool({ cwd })]);
  cleanup.push(() => registry.dispose());
  const result=await registry.executeTool('write',input,mcpTestContext(new AbortController().signal));
  expect(result).not.toMatch(/input.*(?:changed|approval)/);
  expect(readFileSync(input.file_path,'utf8')).toBe('ORIGINAL_APPROVAL');
  expect(input.content).toBe('NOT_APPROVED');
});
