import { afterEach, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry, createToolInputAdmissionGuard, type RegistryOptions } from '../../../src/ai/tools/index.js';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import { createWriteTool } from '../../../src/ai/tools/write.js';
import { mcpTestContext } from '../../support/mcp-cancellation-context.js';
const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'xiaok-producer-admission-'));
  cleanup.push(() => rmSync(cwd, { recursive: true, force: true }));
  const input = { file_path: join(cwd, 'effect.txt'), content: 'ORIGINAL_APPROVAL' };
  const guard = vi.fn(createToolInputAdmissionGuard(input));
  const context = Object.freeze(mcpTestContext(new AbortController().signal, { assertToolInputApprovalAdmission: guard }));
  return { cwd, input, guard, context };
}
it.each(['boolean', 'grant', 'hook'] as const)('actual %s approval denies changed producer input without an effect', async mode => {
  const f = fixture(); const consume = vi.fn((value: Record<string, unknown>) => value);
  const mutate = () => { f.input.content = 'NOT_APPROVED'; };
  const hooksRunner = mode === 'hook' ? { runHooks: async (event: string) => {
    if (event === 'PermissionRequest') { mutate(); return { ok: true, decision: 'allow' }; }
    return { ok: true };
  }, runPreHooks: async () => ({ ok: true }), runPostHooks: async () => [] } as unknown as RegistryOptions['hooksRunner'] : undefined;
  const registry = new ToolRegistry({ hooksRunner, onPrompt: async () => {
    mutate(); return mode === 'grant' ? { approved: true, assertCurrent() {}, prepareInput: consume } : true;
  } }, [createWriteTool({ cwd: f.cwd })]); cleanup.push(() => registry.dispose());
  expect(await registry.executeTool('write', f.input, f.context)).toMatch(/ingress input changed/);
  expect(existsSync(f.input.file_path)).toBe(false); expect(f.guard).toHaveBeenCalledTimes(1);
  expect(consume).toHaveBeenCalledTimes(mode === 'grant' ? 1 : 0);
});
it.each(['boolean', 'grant'] as const)('after %s preparation the private approved snapshot executes once', async mode => {
  const f = fixture(); const registry = new ToolRegistry({ onPrompt: async () => mode === 'grant'
    ? { approved: true, assertCurrent() {}, prepareInput: value => value } : true }, [createWriteTool({ cwd: f.cwd })]);
  cleanup.push(() => registry.dispose());
  const prepared = await registry.prepareToolInvocation('write', f.input, f.context);
  expect(typeof prepared).not.toBe('string'); f.input.content = 'NOT_APPROVED';
  if (typeof prepared !== 'string') {
    await registry.executePreparedTool(prepared);
    expect(readFileSync(f.input.file_path, 'utf8')).toBe('ORIGINAL_APPROVAL');
    await expect(registry.executePreparedTool(prepared)).rejects.toThrow(/invalid|consumed/);
  }
  expect(f.guard).toHaveBeenCalledTimes(1); expect(Object.isFrozen(f.context)).toBe(true);
});
it.each(['auto', 'safe'] as const)('%s retains the original private snapshot and never calls the approval admission callback', async mode => {
  const f = fixture(); const tool = createWriteTool({ cwd: f.cwd });
  if (mode === 'safe') tool.permission = 'safe';
  const policy = new PermissionManager({ mode: mode === 'auto' ? 'auto' : 'default' });
  const registry = new ToolRegistry({ permissionManager: policy }, [tool]); cleanup.push(() => registry.dispose()); const original = policy.check.bind(policy);
  vi.spyOn(policy, 'check').mockImplementation(async (...args) => { f.input.content = 'NOT_APPROVED'; return original(...args); });
  await registry.executeTool('write', f.input, f.context);
  expect(readFileSync(f.input.file_path, 'utf8')).toBe('ORIGINAL_APPROVAL'); expect(f.guard).not.toHaveBeenCalled();
});
it.each(['accessor', 'cycle'] as const)('initial %s admission capture is nonthrowing and the original Registry rejects invalid data', async mode => {
  const f = fixture(); let getters = 0;
  if (mode === 'accessor') Object.defineProperty(f.input, 'content', { enumerable: true, get() { getters++; return 'BAD'; } });
  else Object.assign(f.input, { cycle: f.input });
  let guard!: () => void; expect(() => { guard = createToolInputAdmissionGuard(f.input); }).not.toThrow();
  const registry = new ToolRegistry({ autoMode: true }, [createWriteTool({ cwd: f.cwd })]); cleanup.push(() => registry.dispose());
  expect(await registry.executeTool('write', f.input, { ...f.context, assertToolInputApprovalAdmission: guard })).toBe('Error: invalid tool input snapshot');
  expect(getters).toBe(0); expect(existsSync(f.input.file_path)).toBe(false);
});
it('original cancellation reason has priority over the producer admission callback', async () => {
  const f = fixture(); const abort = new AbortController(); const reason = { original: 'cancel' };
  const registry = new ToolRegistry({ onPrompt: async () => { f.input.content = 'NOT_APPROVED'; abort.abort(reason); return true; } }, [createWriteTool({ cwd: f.cwd })]);
  cleanup.push(() => registry.dispose());
  await expect(registry.executeTool('write', f.input, { ...f.context, signal: abort.signal })).rejects.toBe(reason);
  expect(f.guard).not.toHaveBeenCalled(); expect(existsSync(f.input.file_path)).toBe(false);
});
it('the original permission authority guard runs before the new admission callback', async () => {
  const f = fixture(); const fault = new Error('original authority failed');
  const registry = new ToolRegistry({ onPrompt: async () => true }, [createWriteTool({ cwd: f.cwd })]); cleanup.push(() => registry.dispose());
  expect(await registry.executeTool('write', f.input, { ...f.context, assertPermissionApproval() { throw fault; } })).toMatch(/original authority failed/);
  expect(f.guard).not.toHaveBeenCalled(); expect(existsSync(f.input.file_path)).toBe(false);
});
