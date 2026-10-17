import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHooksRunner, type HookConfig, type HookEventName } from '../../src/runtime/hooks-runner.js';
import { ToolRegistry } from '../../src/ai/tools/index.js';
import { PermissionManager } from '../../src/ai/permissions/manager.js';
import { mcpTestContext } from '../support/mcp-cancellation-context.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

function hook(code: string, event: HookEventName = 'PermissionRequest'): HookConfig {
  const root = mkdtempSync(join(tmpdir(), 'permission-hook-'));
  roots.push(root);
  const script = join(root, 'hook.cjs');
  writeFileSync(script, `process.stdin.resume();\n${code}`);
  return { command: `"${process.execPath}" "${script}"`, events: [event], timeoutMs: 3000 };
}

const allow = () => hook(`process.stdout.write(JSON.stringify({decision:'allow'}));`);
const deny = () => hook(`process.stdout.write(JSON.stringify({decision:'deny',message:'DENIED'}));`);
const timeout = (event: HookEventName = 'PermissionRequest') => ({ ...hook('setInterval(() => {}, 1000);', event), timeoutMs: 500 });

function registry(hooks: HookConfig[], approved = false, name = 'write', signal?: AbortSignal) {
  const onPrompt = vi.fn(async () => approved);
  const execute = vi.fn(async () => 'EXECUTED_ONCE');
  const runner = createHooksRunner({ hooks });
  const toolRegistry = new ToolRegistry({
    permissionManager: new PermissionManager({ mode: 'default' }),
    hooksRunner: runner,
    onPrompt,
  }, [{
    permission: 'write',
    definition: { name, description: 'permission probe', inputSchema: { type: 'object', properties: {} } },
    execute,
  }]);
  return { onPrompt, execute, runner, run: () => toolRegistry.executeTool(name,
    { command: 'permission_probe', file_path: join(tmpdir(), 'permission-probe'), content: 'probe' },
    signal ? mcpTestContext(signal) : undefined) };
}

describe('PermissionRequest operational failure through production hooks and registry', () => {
  it.each(['write', 'edit', 'bash'])('asks locally after %s hook timeout and obeys rejection', async name => {
    const probe = registry([timeout()], false, name);
    expect(await probe.run()).toContain('已取消');
    expect(probe.onPrompt).toHaveBeenCalledTimes(1);
    expect(probe.execute).not.toHaveBeenCalled();
  });

  it('executes exactly once only after local approval following timeout', async () => {
    const probe = registry([timeout()], true);
    expect(await probe.run()).toBe('EXECUTED_ONCE');
    expect(probe.onPrompt).toHaveBeenCalledTimes(1);
    expect(probe.execute).toHaveBeenCalledTimes(1);
  });

  it.each(['before', 'after'])('discards another allow %s a timeout', async order => {
    const probe = registry(order === 'before' ? [allow(), timeout()] : [timeout(), allow()]);
    expect(await probe.run()).toContain('已取消');
    expect(probe.onPrompt).toHaveBeenCalledTimes(1);
    expect(probe.execute).not.toHaveBeenCalled();
  });

  it.each(['before', 'after'])('preserves explicit deny %s a timeout', async order => {
    const probe = registry(order === 'before' ? [deny(), timeout(), allow()] : [timeout(), deny(), allow()], true);
    expect(await probe.run()).toContain('DENIED');
    expect(probe.onPrompt).not.toHaveBeenCalled();
    expect(probe.execute).not.toHaveBeenCalled();
  });

  it('preserves exit-code-2 denial', async () => {
    const probe = registry([hook(`process.stderr.write('DENIED'); process.exitCode = 2;`)], true);
    expect(await probe.run()).toContain('DENIED');
    expect(probe.onPrompt).not.toHaveBeenCalled();
    expect(probe.execute).not.toHaveBeenCalled();
  });

  it('does not let a later allow override an explicit JSON denial', async () => {
    const probe = registry([deny(), allow()], true);
    expect(await probe.run()).toContain('DENIED');
    expect(probe.onPrompt).not.toHaveBeenCalled();
    expect(probe.execute).not.toHaveBeenCalled();
  });

  it('does not let an earlier allow survive nonzero hook exit', async () => {
    const probe = registry([allow(), hook('process.exitCode = 1;')]);
    expect(await probe.run()).toContain('已取消');
    expect(probe.onPrompt).toHaveBeenCalledTimes(1);
    expect(probe.execute).not.toHaveBeenCalled();
  });

  it('falls back on command launch failure', async () => {
    const broken = { ...timeout(), shell: join(roots.at(-1)!, 'missing-shell') };
    const probe = registry([broken]);
    expect(await probe.run()).toContain('已取消');
    expect(probe.onPrompt).toHaveBeenCalledTimes(1);
    expect(probe.execute).not.toHaveBeenCalled();
  });

  it('keeps successful remote approval without a second local prompt', async () => {
    const probe = registry([allow()]);
    expect(await probe.run()).toBe('EXECUTED_ONCE');
    expect(probe.onPrompt).not.toHaveBeenCalled();
    expect(probe.execute).toHaveBeenCalledTimes(1);
  });

  it('keeps PreToolUse timeout blocking', async () => {
    const probe = registry([allow(), timeout('PreToolUse')], true);
    expect(await probe.run()).toContain('hook timeout');
    expect(probe.onPrompt).not.toHaveBeenCalled();
    expect(probe.execute).not.toHaveBeenCalled();
  });

  it('does not open a prompt or execute after cancellation during timeout', async () => {
    const controller = new AbortController();
    const probe = registry([timeout()], true, 'write', controller.signal);
    const pending = probe.run();
    const timer = setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    clearTimeout(timer);
    expect(probe.onPrompt).not.toHaveBeenCalled();
    expect(probe.execute).not.toHaveBeenCalled();
  });
});
