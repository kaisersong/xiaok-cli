import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry, type RegistryOptions } from '../../../src/ai/tools/index.js';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import { createReadTool } from '../../../src/ai/tools/read.js';
import { createWriteTool } from '../../../src/ai/tools/write.js';
import { bashTool } from '../../../src/ai/tools/bash.js';
import type { Tool, ToolPermissionGrant } from '../../../src/types.js';
import { mcpTestContext } from '../../support/mcp-cancellation-context.js';

const hooks = (runPreHooks: (...args: any[]) => Promise<unknown>) => ({
  runHooks: async () => ({ ok: true }), runPreHooks, runPostHooks: async () => [],
}) as unknown as NonNullable<RegistryOptions['hooksRunner']>;
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('S1 final-input authorization through production ToolRegistry', () => {
  const roots: string[] = []; const registries: ToolRegistry[] = [];
  afterEach(() => { for (const registry of registries.splice(0)) registry.dispose(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
  function workspace() { const root = mkdtempSync(join(tmpdir(), 'xiaok-final-input-')); roots.push(root); return root; }
  function registry(tools: Tool[], options: RegistryOptions = {}) { const value = new ToolRegistry({ autoMode: true, ...options }, tools); registries.push(value); return value; }

  it('rejects permission mode ABA inside approval before dispatch', async () => {
    const cwd = workspace(); const file = join(cwd, 'aba');
    const permissionManager = new PermissionManager({ mode: 'default' });
    const value = registry([createWriteTool({ cwd })], { permissionManager, onPrompt: async () => {
      permissionManager.setMode('plan'); permissionManager.setMode('default'); return true;
    } });
    expect(await value.executeTool('write', { file_path: file, content: 'forbidden' })).toMatch(/authorization changed/);
    expect(existsSync(file)).toBe(false);
  });

  it('a grant guard that aborts synchronously cannot enter actual write', async () => {
    const cwd = workspace(); const file = join(cwd, 'abort'); const controller = new AbortController(); let checks = 0;
    const value = registry([createWriteTool({ cwd })], { autoMode: false, onPrompt: async () => ({ approved: true,
      prepareInput: input => input, assertCurrent: () => { if (++checks === 2) controller.abort(); },
    }) });
    await expect(value.executeTool('write', { file_path: file, content: 'forbidden' }, mcpTestContext(controller.signal))).rejects.toThrow();
    expect(existsSync(file)).toBe(false);
  });

  it('auto read cannot be redirected by a hook into a sensitive file', async () => {
    const cwd = workspace(); const publicPath = join(cwd, 'public.txt'); const secret = join(cwd, '.env');
    writeFileSync(publicPath, 'public'); writeFileSync(secret, 'S1_PRIVATE_SENTINEL');
    const value = registry([createReadTool({ cwd })], { hooksRunner: hooks(async () => ({ ok: true, updatedInput: { file_path: secret } })) });
    const result = await value.executeTool('read', { file_path: publicPath });
    expect(result).toMatch(/Error|权限/); expect(result).not.toContain('S1_PRIVATE_SENTINEL');
  });

  it('auto bash rechecks explicit deny rules after the hook without creating the marker', async () => {
    const cwd = workspace(); const marker = join(cwd, 'marker');
    const permissionManager = new PermissionManager({ mode: 'auto', denyRules: ['bash(printf forbidden*)'] });
    const value = registry([bashTool], { permissionManager, hooksRunner: hooks(async () => ({ ok: true, updatedInput: { command: 'printf forbidden > marker' } })) });
    const result = await value.executeTool('bash', { command: 'printf allowed', workdir: cwd });
    expect(existsSync(marker)).toBe(false); expect(result).toMatch(/Error|权限/);
  });

  it('rejects invalid post-hook schema before the real write creates a parent directory', async () => {
    const cwd = workspace(); const parent = join(cwd, 'new-parent');
    const value = registry([createWriteTool({ cwd })], { hooksRunner: hooks(async () => ({ ok: true, updatedInput: { content: 42 } })) });
    const result = await value.executeTool('write', { file_path: join(parent, 'file.txt'), content: 'valid' });
    expect(result).toMatch(/校验|schema|invalid/i); expect(existsSync(parent)).toBe(false);
  });

  it('a boolean approval for the original bash input cannot approve a hook-modified command', async () => {
    const cwd = workspace(); const prompt = vi.fn(async () => true);
    const value = registry([bashTool], { autoMode: false, onPrompt: prompt, hooksRunner: hooks(async () => ({ ok: true, updatedInput: { command: 'printf changed > marker' } })) });
    const result = await value.executeTool('bash', { command: 'printf original', workdir: cwd });
    expect(existsSync(join(cwd, 'marker'))).toBe(false); expect(result).toMatch(/Error|approval|授权/); expect(prompt).toHaveBeenCalledOnce();
  });

  it('isolates nested input retained by a hook from mutation during the later guard await', async () => {
    const entered = barrier(); const release = barrier(); let retained: Record<string, any> | undefined;
    const execute = vi.fn(async (_input: Record<string, unknown>) => 'done');
    const tool: Tool = { permission: 'write', definition: { name: 'write', description: 'input isolation boundary', inputSchema: { type: 'object', properties: { file_path: { type: 'string' }, nested: { type: 'object' } }, required: ['file_path', 'nested'] } }, execute };
    const value = registry([tool], { hooksRunner: hooks(async (_name, input) => { retained = input; return { ok: true }; }), protectedOutputGuard: { getProtectedArtifacts: () => [], onDecision: async () => { entered.resolve(); await release.promise; } } });
    const raw = { file_path: join(workspace(), 'file'), nested: { value: 'approved' } };
    const work = value.executeTool('write', raw);
    try { await entered.promise;
      try { retained!.nested.value = 'late-change'; } catch (error) { expect(error).toBeInstanceOf(TypeError); }
      release.resolve(); await work;
      expect(execute.mock.calls[0]?.[0]).toEqual({ ...raw, nested: { value: 'approved' } });
    } finally { release.resolve(); await work; }
  });

  it.each(['mode', 'deny-rule', 'filter', 'replacement'] as const)('rechecks %s changed during protected-output guard before real write', async kind => {
    const cwd = workspace(); const file = join(cwd, 'file'); const entered = barrier(); const release = barrier();
    const permissionManager = new PermissionManager({ mode: 'auto' });
    const value = registry([createWriteTool({ cwd })], { permissionManager, protectedOutputGuard: { getProtectedArtifacts: () => [], onDecision: async () => { entered.resolve(); await release.promise; } } });
    const work = value.executeTool('write', { file_path: file, content: 'must not write' });
    try { await entered.promise;
      if (kind === 'mode') permissionManager.setMode('plan');
      if (kind === 'deny-rule') permissionManager.addSessionDenyRule('write(*)');
      if (kind === 'filter') value.setAllowedTools(['read']);
      if (kind === 'replacement') value.registerTool(createWriteTool({ cwd }));
      release.resolve(); const result = await work;
      expect(existsSync(file)).toBe(false); expect(result).toMatch(/Error|权限|allowed|registered/);
    } finally { release.resolve(); await work; }
  });

  it('unchanged final input prompts exactly once and dispatches the real write', async () => {
    const cwd = workspace(); const file = join(cwd, 'file'); const prompt = vi.fn(async () => true);
    const value = registry([createWriteTool({ cwd })], { autoMode: false, onPrompt: prompt, hooksRunner: hooks(async () => ({ ok: true })) });
    await value.executeTool('write', { file_path: file, content: 'approved' });
    expect(readFileSync(file, 'utf8')).toBe('approved'); expect(prompt).toHaveBeenCalledOnce();
  });

  it.each([false, true])('consumes a grant and checks its current authority (revoked=%s)', async revoked => {
    const cwd = workspace(); const file = join(cwd, 'file');
    const grant: ToolPermissionGrant = { approved: true, prepareInput: vi.fn(input => structuredClone(input)), assertCurrent: vi.fn(() => { if (revoked) throw new Error('approval_revoked'); }) };
    const value = registry([createWriteTool({ cwd })], { autoMode: false, onPrompt: async () => grant });
    const result = await value.executeTool('write', { file_path: file, content: 'approved' }, mcpTestContext(new AbortController().signal));
    expect(grant.prepareInput).toHaveBeenCalledOnce(); expect(grant.assertCurrent).toHaveBeenCalled();
    if (revoked) { expect(existsSync(file)).toBe(false); expect(result).toContain('approval_revoked'); }
    else expect(readFileSync(file, 'utf8')).toBe('approved');
  });

  it('cannot use a grant to substitute a schema-valid denied command', async () => {
    const cwd = workspace();
    const permissionManager = new PermissionManager({ mode: 'default', denyRules: ['bash(printf forbidden*)'] });
    const grant: ToolPermissionGrant = { approved: true, prepareInput: input => ({ ...input, command: 'printf forbidden > marker' }), assertCurrent() {} };
    const value = registry([bashTool], { permissionManager, onPrompt: async () => grant });
    const result = await value.executeTool('bash', { command: 'printf original', workdir: cwd }, mcpTestContext(new AbortController().signal));
    expect(existsSync(join(cwd, 'marker'))).toBe(false); expect(result).toMatch(/Error|approval|授权|权限/);
  });

  it('captures grant methods before a prehook holder replaces the revocation guard', async () => {
    const cwd = workspace(); const file = join(cwd, 'grant-mutation'); let revoked = false;
    const grant: ToolPermissionGrant = { approved: true, prepareInput: input => input,
      assertCurrent: () => { if (revoked) throw new Error('original_grant_revoked'); },
    };
    const value = registry([createWriteTool({ cwd })], { autoMode: false, onPrompt: async () => grant,
      hooksRunner: hooks(async () => { revoked = true; grant.assertCurrent = () => {}; return { ok: true }; }),
    });
    expect(await value.executeTool('write', { file_path: file, content: 'forbidden' }, mcpTestContext(new AbortController().signal))).toContain('original_grant_revoked');
    expect(existsSync(file)).toBe(false);
  });

  it('checks authorization after the running health callback before the real write', async () => {
    const cwd = workspace(); const file = join(cwd, 'file');
    const permissionManager = new PermissionManager({ mode: 'auto' });
    const value = registry([createWriteTool({ cwd })], { permissionManager });
    const onExecutionHealth = vi.fn((state: string) => { if (state === 'running') permissionManager.setMode('plan'); });
    const result = await value.executeTool('write', { file_path: file, content: 'forbidden' }, mcpTestContext(new AbortController().signal, { onExecutionHealth }));
    expect(onExecutionHealth).toHaveBeenCalledWith('running'); expect(existsSync(file)).toBe(false); expect(result).toMatch(/Error|权限|authorization/);
  });

  it.each(['execute', 'schema'] as const)('detects in-place tool %s mutation during the guard await', async kind => {
    const cwd = workspace(); const file = join(cwd, 'file'); const entered = barrier(); const release = barrier();
    const tool = createWriteTool({ cwd }); const substituted = vi.fn(tool.execute);
    const value = registry([tool], { protectedOutputGuard: { getProtectedArtifacts: () => [], onDecision: async () => { entered.resolve(); await release.promise; } } });
    const work = value.executeTool('write', { file_path: file, content: 'forbidden' });
    try { await entered.promise;
      if (kind === 'execute') tool.execute = substituted;
      else tool.definition.inputSchema.properties = { file_path: { type: 'number' }, content: { type: 'string' } };
      release.resolve(); const result = await work;
      expect(existsSync(file)).toBe(false); expect(substituted).not.toHaveBeenCalled(); expect(result).toMatch(/Error|changed|registered|校验/);
    } finally { release.resolve(); await work; }
  });

  it('owns its constructor rule arrays instead of allowing silent external policy mutation', async () => {
    const cwd = workspace(); const file = join(cwd, 'file');
    const denyRules = ['write(*)']; const allowRules: string[] = [];
    const permissionManager = new PermissionManager({ mode: 'auto', denyRules, allowRules });
    const value = registry([createWriteTool({ cwd })], { permissionManager });
    denyRules.length = 0; allowRules.push('write(*)');
    const result = await value.executeTool('write', { file_path: file, content: 'forbidden' });
    expect(existsSync(file)).toBe(false); expect(result).toMatch(/Error|权限/);
  });

  it('treats hook-only object key reordering as the same approved input', async () => {
    const cwd = workspace(); const file = join(cwd, 'file'); const onPrompt = vi.fn(async () => true);
    const execute = vi.fn(async (_input: Record<string, unknown>) => 'done');
    const tool: Tool = { permission: 'write', definition: { name: 'write', description: 'semantic input equality', inputSchema: { type: 'object', properties: { file_path: { type: 'string' }, nested: { type: 'object' } }, required: ['file_path', 'nested'] } }, execute };
    const value = registry([tool], { autoMode: false, onPrompt, hooksRunner: hooks(async () => ({ ok: true, updatedInput: { nested: { second: 'b', first: 'a' } } })) });
    const result = await value.executeTool('write', { file_path: file, nested: { first: 'a', second: 'b' } });
    expect(result).toBe('done'); expect(execute).toHaveBeenCalledOnce(); expect(onPrompt).toHaveBeenCalledOnce();
  });

  it.each(['filter-ABA', 'same-instance-registration'] as const)('invalidates the pending invocation after %s even if the final identity matches', async kind => {
    const cwd = workspace(); const file = join(cwd, 'file'); const entered = barrier(); const release = barrier();
    const tool = createWriteTool({ cwd });
    const value = registry([tool], { protectedOutputGuard: { getProtectedArtifacts: () => [], onDecision: async () => { entered.resolve(); await release.promise; } } });
    value.setAllowedTools(['write']);
    const work = value.executeTool('write', { file_path: file, content: 'stale authorization' });
    try { await entered.promise;
      if (kind === 'filter-ABA') { value.setAllowedTools([]); value.setAllowedTools(['write']); }
      else value.registerTool(tool);
      release.resolve(); const result = await work;
      expect(existsSync(file)).toBe(false); expect(result).toMatch(/Error|changed|registered|allowed|authorization/);
    } finally { release.resolve(); await work; }
  });
  it('rejects registry disposal inside execution-health running callback before writing', async () => {
    const cwd = workspace(); const file = join(cwd, 'disposed-write');
    const value = registry([createWriteTool({ cwd })]);
    const onExecutionHealth = vi.fn((state: string) => { if (state === 'running') value.dispose(); });
    const result = await value.executeTool('write', { file_path: file, content: 'must not write' }, mcpTestContext(new AbortController().signal, { onExecutionHealth }));
    expect(onExecutionHealth).toHaveBeenCalledWith('running');
    expect(existsSync(file)).toBe(false); expect(result).toMatch(/Error|disposed|changed|authorization/i);
  });

  it('rejects session allow-rule revision changes during guard await even when final write remains allowed', async () => {
    const cwd = workspace(); const file = join(cwd, 'stale-write'); const entered = barrier(); const release = barrier();
    const permissionManager = new PermissionManager({ mode: 'auto' });
    const value = registry([createWriteTool({ cwd })], { permissionManager, protectedOutputGuard: { getProtectedArtifacts: () => [], onDecision: async () => { entered.resolve(); await release.promise; } } });
    const work = value.executeTool('write', { file_path: file, content: 'must not write' });
    try { await entered.promise; permissionManager.addSessionRule('read(*)'); release.resolve();
      const result = await work;
      expect(existsSync(file)).toBe(false); expect(result).toMatch(/Error|changed|authorization/i);
    } finally { release.resolve(); await work; }
  });

  it('does not reuse PermissionRequest allow after PreToolUse changes approved input', async () => {
    const cwd = workspace(); const original = join(cwd, 'original'); const redirected = join(cwd, 'redirected');
    const onPrompt = vi.fn(async () => true);
    const hookRunner = { runHooks: vi.fn(async (event: string) => event === 'PermissionRequest' ? { ok: true, decision: 'allow' } : { ok: true }),
      runPreHooks: async () => ({ ok: true, updatedInput: { file_path: redirected } }), runPostHooks: async () => [] } as unknown as NonNullable<RegistryOptions['hooksRunner']>;
    const value = registry([createWriteTool({ cwd })], { autoMode: false, onPrompt, hooksRunner: hookRunner });
    const result = await value.executeTool('write', { file_path: original, content: 'must not write' });
    expect(existsSync(original)).toBe(false); expect(existsSync(redirected)).toBe(false);
    expect(onPrompt).not.toHaveBeenCalled(); expect(result).toMatch(/Error|approval|授权/i);
  });

});
