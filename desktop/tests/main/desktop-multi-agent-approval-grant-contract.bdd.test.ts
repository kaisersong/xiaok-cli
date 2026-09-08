// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolRegistry, type RegistryOptions } from '../../../src/ai/tools/index.js';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import type { Tool, ToolExecutionContext } from '../../../src/types.js';
import { mcpTestContext } from '../../../tests/support/mcp-cancellation-context.js';
import { DesktopCapabilityCatalog, type DesktopInvocationAuthority } from '../../electron/desktop-multi-agent-capabilities.js';
import { bounded, deferred } from '../fixtures/desktop-post-seal-harness.js';

// Port-contract doubles only. The assertions exercise real Registry/Catalog
// dispatch; these tests do not implement the transport's digest/receipt owner.
interface Grant {
  approved: true;
  prepareInput(input: Record<string, unknown>): Record<string, unknown>;
  assertCurrent(): void;
}
const returning = (value: unknown) => (async () => value) as unknown as NonNullable<RegistryOptions['onPrompt']>;
const context = () => mcpTestContext(new AbortController().signal, { taskId: 'actual-approval-child' });
const writable = (execute: Tool['execute'] = vi.fn(async () => 'effect'), permission: Tool['permission'] = 'write'): Tool => ({
  definition: { name: 'write', description: 'approval dispatch contract', inputSchema: { type: 'object', properties: {} } }, permission, execute,
});
const validGrant = (): Grant => ({ approved: true, prepareInput: vi.fn(input => structuredClone(input)), assertCurrent: vi.fn() });

describe('AP2/AP3 shared grant shape, consumption and actual async dispatch boundaries', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });
  function registry(tool: Tool, options: RegistryOptions) {
    const registry = new ToolRegistry({ autoMode: false, ...options }, [tool]); cleanup.push(() => registry.dispose()); return registry;
  }
  function scoped(tool: Tool, options: RegistryOptions, extra: Partial<DesktopInvocationAuthority> = {}) {
    const catalog = new DesktopCapabilityCatalog();
    const entry = { definition: tool.definition, aliases: ['approval_alias'], permission: tool.permission,
      scope: { workspaceId: 'grant-workspace', materialIds: [], permissions: ['safe', 'write', 'bash'] as const },
      bindInvocation: vi.fn(() => tool.execute) };
    const descriptor = catalog.publish({ requestSource: 'scheduler', ownerId: 'grant-owner', entry });
    catalog.authorize({ requestSource: 'user', capabilityId: descriptor.capabilityId });
    const controller = new AbortController();
    const handle = catalog.createScopedRegistry(catalog.snapshotPolicy(), { groupId: 'group', agentId: 'child', turnId: 'turn', cwd: process.cwd(),
      workspaceId: 'grant-workspace', materialIds: [], permissionRevision: 0, signal: controller.signal, deadlineAt: Date.now() + 60_000, ...extra,
    }, { autoMode: false, ...options });
    cleanup.push(() => handle.dispose()); return { ...handle, catalog, controller, descriptor, entry };
  }

  it.each([
    ['truthy number', 1], ['truthy string', 'approved'], ['array', []], ['boxed boolean', Object(true)],
    ['empty object', {}], ['false approved', { approved: false }], ['nonliteral approved', { ...validGrant(), approved: 1 }],
    ['missing prepare', { approved: true, assertCurrent() {} }], ['missing current', { approved: true, prepareInput: (input: unknown) => input }],
    ['nonfunction prepare', { approved: true, prepareInput: true, assertCurrent() {} }],
    ['nonfunction current', { approved: true, prepareInput: (input: unknown) => input, assertCurrent: true }],
  ])('rejects malformed prompt decision %s without executing or consuming it', async (_label, decision) => {
    const execute = vi.fn(async () => 'unexpected'); const tool = writable(execute);
    const result = await registry(tool, { onPrompt: returning(decision) }).executeTool('write', {}, context());
    expect(execute).not.toHaveBeenCalled(); expect(result).toMatch(/取消|approval|Error/);
  });

  it('uses the grant private clone after a hook retains and later mutates the original nested input', async () => {
    const entered = deferred(); const release = deferred(); cleanup.push(() => release.resolve());
    const raw = { nested: { value: 'approved' } };
    const privateCopy = structuredClone(raw); const execute = vi.fn(async (_input: Record<string, unknown>) => 'done');
    let retained: Record<string, unknown> | undefined;
    const prepareInput = vi.fn(() => structuredClone(privateCopy));
    const handle = scoped(writable(execute), { onPrompt: returning({ approved: true, prepareInput, assertCurrent() {} } satisfies Grant),
      hooksRunner: { runHooks: async () => ({ ok: true }), runPreHooks: async (_name: string, input: Record<string, unknown>) => {
        retained = input; return { ok: true };
      }, runPostHooks: async () => [] } as unknown as NonNullable<RegistryOptions['hooksRunner']>,
    }, { beforeOpaqueInvocation: async () => { entered.resolve(); await release.promise; } });
    const work = handle.registry.executeTool('write', raw, context());
    try {
      await bounded(entered.promise); expect(retained).toBe(raw);
      (retained!.nested as { value: string }).value = 'mutated-after-prepare'; release.resolve(); await work;
      expect(prepareInput).toHaveBeenCalledOnce(); expect(execute.mock.calls[0]?.[0]).toEqual(privateCopy);
      expect(execute.mock.calls[0]?.[0]).not.toBe(raw);
    } finally { release.resolve(); await work.catch(() => undefined); }
  });

  it('passes the resolved alias tool and actual caller identity through Catalog into the prompt port', async () => {
    const onPrompt = vi.fn(async () => false); const handle = scoped(writable(), { onPrompt }); const caller = context();
    const tool = handle.registry.getRegisteredTool('approval_alias');
    await handle.registry.executeTool('approval_alias', {}, caller);
    const args = onPrompt.mock.calls[0] as unknown[];
    expect(args[0]).toBe('approval_alias'); expect(args[2]).toEqual({ tool, context: caller });
  });

  it('two independent identical calls obtain and consume two invocation grants, never a name/input cache', async () => {
    const execute = vi.fn(async () => 'done'); const grants = [validGrant(), validGrant()]; let ordinal = 0;
    const onPrompt = vi.fn(async () => grants[ordinal++]) as unknown as NonNullable<RegistryOptions['onPrompt']>;
    const tool = registry(writable(execute), { onPrompt });
    await tool.executeTool('write', { content: 'same' }, context()); await tool.executeTool('write', { content: 'same' }, context());
    expect(onPrompt).toHaveBeenCalledTimes(2); expect(execute).toHaveBeenCalledTimes(2);
    for (const grant of grants) expect(grant.prepareInput).toHaveBeenCalledOnce();
  });

  it('a rejecting consumption guard prevents dispatch and is not retried or replaced with another prompt', async () => {
    const execute = vi.fn(async () => 'unexpected'); const failure = new Error('approval_already_consumed');
    const grant = validGrant(); vi.mocked(grant.prepareInput).mockImplementation(() => { throw failure; });
    const onPrompt = vi.fn(returning(grant));
    const result = await registry(writable(execute), { onPrompt }).executeTool('write', {}, context());
    expect(result).toContain('approval_already_consumed'); expect(execute).not.toHaveBeenCalled();
    expect(onPrompt).toHaveBeenCalledOnce(); expect(grant.prepareInput).toHaveBeenCalledOnce();
  });

  it.each(['write', 'approval_alias'])('runs grant current guard after real opaque await for %s, before bindInvocation/effect', async name => {
    const entered = deferred(); const release = deferred(); cleanup.push(() => release.resolve());
    const execute = vi.fn(async () => 'unexpected'); const grant = validGrant();
    const handle = scoped(writable(execute), { onPrompt: returning(grant) }, { beforeOpaqueInvocation: async () => { entered.resolve(); await release.promise; } });
    const bind = handle.entry.bindInvocation;
    const work = handle.registry.executeTool(name, {}, context());
    try {
      await bounded(entered.promise); vi.mocked(grant.assertCurrent).mockImplementation(() => { throw new Error('approval_invalidated'); });
      release.resolve(); expect(await work).toContain('approval_invalidated');
      expect(execute).not.toHaveBeenCalled(); expect(bind).not.toHaveBeenCalled();
    } finally { release.resolve(); await work.catch(() => undefined); }
  });

  it.each(['removed', 'new-owner', 'same-slot'])('existing instance guards still deny %s after opaque await', async replacement => {
    const entered = deferred(); const release = deferred(); cleanup.push(() => release.resolve());
    const execute = vi.fn(async () => 'old'); const nextExecute = vi.fn(async () => 'new');
    const handle = scoped(writable(execute), { onPrompt: returning(validGrant()) }, { beforeOpaqueInvocation: async () => { entered.resolve(); await release.promise; } });
    const work = handle.registry.executeTool('approval_alias', {}, context());
    try {
      await bounded(entered.promise);
      if (replacement !== 'same-slot') handle.catalog.revoke({ requestSource: 'scheduler', ownerId: handle.descriptor.ownerId });
      if (replacement !== 'removed') {
        const next = handle.catalog.publish({ requestSource: 'scheduler', ownerId: replacement === 'new-owner' ? 'new-owner' : handle.descriptor.ownerId,
          ...(replacement === 'same-slot' ? { slotId: handle.descriptor.slotId } : {}), entry: { ...handle.entry, bindInvocation: () => nextExecute } });
        handle.catalog.authorize({ requestSource: 'user', capabilityId: next.capabilityId });
      }
      release.resolve(); expect(await work).toMatch(/Error|revoked|registered/);
      expect(execute).not.toHaveBeenCalled(); expect(nextExecute).not.toHaveBeenCalled();
    } finally { release.resolve(); await work.catch(() => undefined); }
  });

  it('preserves the original non-Error cancellation reason after opaque await through both real wrappers', async () => {
    const entered = deferred(); const release = deferred(); cleanup.push(() => release.resolve());
    const controller = new AbortController(); const reason = Object.freeze({ code: 'actual-owner-abort' });
    const execute = vi.fn(async () => 'unexpected');
    const handle = scoped(writable(execute), { onPrompt: returning(validGrant()) }, { beforeOpaqueInvocation: async () => { entered.resolve(); await release.promise; } });
    const work = handle.registry.executeTool('write', {}, mcpTestContext(controller.signal));
    try {
      await bounded(entered.promise); controller.abort(reason); release.resolve();
      await expect(work).rejects.toBe(reason); expect(execute).not.toHaveBeenCalled();
    } finally { release.resolve(); await work.catch(() => undefined); }
  });

  it('rejects a grant without actual internal tool context and does not fabricate caller fields', async () => {
    const grant = validGrant(); const execute = vi.fn(async () => 'unexpected');
    const result = await registry(writable(execute), { onPrompt: returning(grant) }).executeTool('write', {});
    expect(result).toContain('approval_context_unavailable'); expect(execute).not.toHaveBeenCalled();
    expect(grant.prepareInput).not.toHaveBeenCalled();
  });

  it.each(['prepareInput', 'assertCurrent'] as const)('does not dispatch when a purported synchronous %s returns a Promise', async field => {
    const grant = validGrant(); const execute = vi.fn(async () => 'unexpected');
    const invalid = { ...grant, [field]: async () => { throw new Error('asynchronous-grant-is-not-a-synchronous-guard'); } };
    const result = await registry(writable(execute), { onPrompt: returning(invalid) }).executeTool('write', {}, context());
    expect(result).toContain('approval_grant_invalid'); expect(execute).not.toHaveBeenCalled();
  });

  it('captures the shorter approval deadline and denies after opaque journal even if its timer never ran', async () => {
    let now = Date.now(); const deadline = now + 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const entered = deferred(); const release = deferred(); cleanup.push(() => release.resolve());
    const execute = vi.fn(async () => 'unexpected'); const handle = scoped(writable(execute), { onPrompt: returning(validGrant()) }, {
      getApprovalDeadline: () => deadline, beforeOpaqueInvocation: async () => { entered.resolve(); await release.promise; },
    });
    const work = handle.registry.executeTool('write', {}, context());
    try {
      await bounded(entered.promise); now = deadline + 1; release.resolve();
      expect(await work).toMatch(/approval.*expir|deadline/); expect(execute).not.toHaveBeenCalled();
    } finally { release.resolve(); await work.catch(() => undefined); }
  });

  it.each(['safe', 'auto', 'plan', 'hook-allow'] as const)('preserves existing %s policy without asking for or consuming a grant', async mode => {
    const execute = vi.fn(async () => 'done'); const onPrompt = vi.fn(returning(validGrant()));
    const options: RegistryOptions = { onPrompt, permissionManager: new PermissionManager({ mode: mode === 'auto' ? 'auto' : mode === 'plan' ? 'plan' : 'default' }) };
    if (mode === 'hook-allow') options.hooksRunner = { runHooks: async () => ({ ok: true, decision: 'allow' }),
      runPreHooks: async () => ({ ok: true }), runPostHooks: async () => [] } as unknown as NonNullable<RegistryOptions['hooksRunner']>;
    await registry(writable(execute, mode === 'safe' ? 'safe' : 'write'), options).executeTool('write', {}, context());
    expect(onPrompt).not.toHaveBeenCalled(); expect(execute).toHaveBeenCalledTimes(mode === 'plan' ? 0 : 1);
  });
});
