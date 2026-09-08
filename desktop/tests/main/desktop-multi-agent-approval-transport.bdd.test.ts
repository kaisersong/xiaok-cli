// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolRegistry, type RegistryOptions } from '../../../src/ai/tools/index.js';
import type { Tool, ToolExecutionContext } from '../../../src/types.js';
import { DesktopCapabilityCatalog } from '../../electron/desktop-multi-agent-capabilities.js';
import { mcpTestContext } from '../../../tests/support/mcp-cancellation-context.js';

// These tests invoke the existing production Registry/Catalog, not a replacement
// approval map. Stub receipts model the approved port contract; no input-digest
// or permission implementation is reproduced here. Formal factory tests follow.
type ProposedGrant = {
  approved: true;
  prepareInput(input: Record<string, unknown>): Record<string, unknown>;
  assertCurrent(): void;
};
const returning = (value: unknown) => (async () => value) as unknown as NonNullable<RegistryOptions['onPrompt']>;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

describe('BDD AP2/AP3: production approval receipt and final invocation boundaries', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });
  const writable = (execute = vi.fn(async (_input: Record<string, unknown>) => 'executed')): Tool => ({
    permission: 'write', definition: { name: 'write', description: 'bounded approval fixture', inputSchema: { type: 'object', properties: {} } }, execute,
  });
  function registry(tool: Tool, options: RegistryOptions) {
    const result = new ToolRegistry({ autoMode: false, ...options }, [tool]);
    cleanup.push(() => result.dispose()); return result;
  }
  function scoped(tool: Tool, options: RegistryOptions, extras: { getApprovalDeadline?(): number; beforeOpaqueInvocation?(): void | Promise<void> } = {}) {
    const catalog = new DesktopCapabilityCatalog();
    const descriptor = catalog.publish({ requestSource: 'scheduler', ownerId: 'approval-fixture', entry: {
      definition: tool.definition, aliases: [], permission: tool.permission,
      scope: { workspaceId: 'approval-workspace', materialIds: [], permissions: ['safe', 'write'] },
      bindInvocation: () => tool.execute,
    } });
    catalog.authorize({ requestSource: 'user', capabilityId: descriptor.capabilityId });
    const controller = new AbortController();
    const handle = catalog.createScopedRegistry(catalog.snapshotPolicy(), {
      groupId: 'group', agentId: 'child', turnId: 'turn', cwd: process.cwd(), workspaceId: 'approval-workspace', materialIds: [],
      permissionRevision: 0, signal: controller.signal, deadlineAt: Date.now() + 60_000, ...extras,
    }, { autoMode: false, ...options });
    cleanup.push(() => handle.dispose());
    return { catalog, descriptor, controller, ...handle };
  }

  it('AP2 Given the real resolved tool/context, When prompting, Then the port receives those exact objects, not a captured root', async () => {
    const execute = vi.fn(async () => 'written'); const tool = writable(execute);
    const onPrompt = vi.fn(async () => false);
    const scope = registry(tool, { onPrompt });
    const context = { taskId: 'actual-child', signal: new AbortController().signal } as ToolExecutionContext;
    await scope.executeTool('write', { content: 'original' }, context);
    const args = onPrompt.mock.calls[0] as unknown[];
    expect(args?.[2], 'the production onPrompt call must bind the resolved tool and actual caller').toEqual({ tool, context });
    expect(execute).not.toHaveBeenCalled();
  });

  it('AP2 Given a one-invocation grant, When the pre-hook changes input, Then prepareInput rejection prevents the real tool effect', async () => {
    const execute = vi.fn(async () => 'unexpected effect');
    const prepareInput = vi.fn(() => { throw new Error('approval_input_changed'); });
    const grant: ProposedGrant = { approved: true, prepareInput, assertCurrent: vi.fn() };
    const scope = registry(writable(execute), {
      onPrompt: returning(grant),
      hooksRunner: {
        runHooks: async () => ({ ok: true }),
        runPreHooks: async () => ({ ok: true, updatedInput: { content: 'changed-after-approval' } }),
        runPostHooks: async () => [],
      } as unknown as NonNullable<RegistryOptions['hooksRunner']>,
    });
    const result = await scope.executeTool('write', { content: 'approved-input' }, mcpTestContext(new AbortController().signal));
    expect(execute, 'truthy receipt is not permission to skip its input guard').not.toHaveBeenCalled();
    expect(prepareInput).toHaveBeenCalledWith({ content: 'changed-after-approval' });
    expect(result).toContain('approval_input_changed');
  });

  it('AP2 Given an object without approved:true, Then truthiness cannot authorize an invocation', async () => {
    const execute = vi.fn(async () => 'unexpected effect');
    const scope = registry(writable(execute), { onPrompt: returning({ approved: false }) });
    await scope.executeTool('write', {});
    expect(execute).not.toHaveBeenCalled();
  });

  it('AP2 Given a legal receipt through the real Catalog, Then it survives the approval timer wrapper and prepares the actual input', async () => {
    const execute = vi.fn(async (_input: Record<string, unknown>) => 'written');
    const prepareInput = vi.fn(() => ({ content: 'private-approved-copy' }));
    const assertCurrent = vi.fn();
    const handle = scoped(writable(execute), { onPrompt: returning({ approved: true, prepareInput, assertCurrent } satisfies ProposedGrant) });
    await handle.registry.executeTool('write', { content: 'public-reference' }, mcpTestContext(new AbortController().signal));
    expect(prepareInput, 'Catalog must not reduce a grant object to a boolean').toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toEqual({ content: 'private-approved-copy' });
    expect(assertCurrent).toHaveBeenCalled();
  });

  it('AP3 Given the child short deadline has passed but its timer has not run, Then a late approve has zero effect', async () => {
    let now = Date.now(); const shortDeadline = now + 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const decision = deferred<boolean>(); const onPrompt = vi.fn(() => decision.promise);
    const execute = vi.fn(async () => 'unexpected late effect');
    const handle = scoped(writable(execute), { onPrompt }, { getApprovalDeadline: () => shortDeadline });
    const invocation = handle.registry.executeTool('write', {});
    try {
      for (let tick = 0; tick < 20 && !onPrompt.mock.calls.length; tick++) await Promise.resolve();
      expect(onPrompt).toHaveBeenCalledOnce();
      now = shortDeadline + 1; // Changes clock only; no timer callback is run.
      decision.resolve(true);
      await invocation;
      expect(execute, 'effective approval minDeadline, not only the longer authority deadline').not.toHaveBeenCalled();
    } finally { decision.resolve(false); await invocation.catch(() => undefined); }
  });

  it('AP3 Given opaque journaling completes after approval becomes invalid, Then its final grant guard runs after that await', async () => {
    const journalEntered = deferred<void>(), journalReleased = deferred<void>();
    const execute = vi.fn(async () => 'unexpected post-journal effect');
    const assertCurrent = vi.fn();
    const grant: ProposedGrant = { approved: true, prepareInput: input => ({ ...input }), assertCurrent };
    const handle = scoped(writable(execute), { onPrompt: returning(grant) }, {
      beforeOpaqueInvocation: async () => { journalEntered.resolve(); await journalReleased.promise; },
    });
    const invocation = handle.registry.executeTool('write', { content: 'approved' }, mcpTestContext(new AbortController().signal));
    try {
      await journalEntered.promise;
      assertCurrent.mockImplementation(() => { throw new Error('approval_expired'); });
      journalReleased.resolve(); await invocation;
      expect(execute).not.toHaveBeenCalled();
      expect(assertCurrent).toHaveBeenCalled();
    } finally { journalReleased.resolve(); await invocation.catch(() => undefined); }
  });

  it('AP2 compatibility Given the existing CLI boolean prompt, Then true and false retain their existing meanings', async () => {
    for (const approved of [true, false]) {
      const execute = vi.fn(async () => 'legacy');
      const scope = registry(writable(execute), { onPrompt: async () => approved });
      await scope.executeTool('write', {});
      expect(execute).toHaveBeenCalledTimes(approved ? 1 : 0);
    }
  });
});
