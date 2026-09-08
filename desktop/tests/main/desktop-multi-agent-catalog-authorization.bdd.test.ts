// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopCapabilityCatalog, type DesktopScopedRegistry } from '../../electron/desktop-multi-agent-capabilities.js';

// Frozen R5-joint2 internal port candidate. No snapshot reducer is implemented
// here: every transition, admission and invocation goes through the real catalog.
type Snapshot = { bootId: string; permissionRevision: number; executionAllowed: boolean; persistenceState: 'confirmed' | 'unknown' };
type SnapshotPort = { applyWorkspaceAuthorization(input: { workspaceId: string; snapshot: Snapshot }): void };

describe('BDD W12-joint2: the real catalog consumes the complete owner snapshot', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const action of cleanup.splice(0).reverse()) action(); });
  function setup() {
    const catalog = new DesktopCapabilityCatalog();
    const invoke = vi.fn(async () => 'real-bound-effect');
    for (const workspaceId of ['workspace-a', 'workspace-b']) {
      const descriptor = catalog.publish({ requestSource: 'scheduler', ownerId: workspaceId, entry: {
        definition: { name: `read_${workspaceId}`, description: 'snapshot admission fixture', inputSchema: { type: 'object', properties: {} } },
        aliases: [], permission: 'safe', verifiedReadOnly: true,
        scope: { workspaceId, materialIds: [], permissions: ['safe'] }, bindInvocation: () => invoke,
      } });
      catalog.authorize({ requestSource: 'user', capabilityId: descriptor.capabilityId });
    }
    const policy = catalog.snapshotPolicy();
    const deliver = (snapshot: Snapshot, workspaceId = 'workspace-a') => {
      const port = catalog as unknown as Partial<SnapshotPort>;
      expect(port.applyWorkspaceAuthorization, 'missing complete owner-snapshot port; no test-side reducer substitutes for it').toBeTypeOf('function');
      port.applyWorkspaceAuthorization!.call(catalog, { workspaceId, snapshot });
    };
    const rejectedDelivery = (snapshot: Snapshot) => {
      // Both explicit rejection and ignoring stale notifications are legal;
      // the real revision/scope/effect below must remain unchanged either way.
      try { deliver(snapshot); } catch (error) {
        if (!(error instanceof Error) || /missing complete owner-snapshot/.test(error.message)) throw error;
      }
    };
    const scope = (permissionRevision: number, workspaceId = 'workspace-a'): DesktopScopedRegistry => {
      const handle = catalog.createScopedRegistry(policy, {
        groupId: `group-${permissionRevision}-${workspaceId}`, agentId: 'child', turnId: 'turn', cwd: process.cwd(),
        workspaceId, permissionRevision, materialIds: [], signal: new AbortController().signal, deadlineAt: Date.now() + 60_000,
      }, { autoMode: true });
      cleanup.push(() => handle.dispose()); return handle;
    };
    const allowed = async (revision: number, workspaceId = 'workspace-a') => {
      const handle = scope(revision, workspaceId);
      expect(await handle.registry.executeTool(`read_${workspaceId}`, {})).toBe('real-bound-effect');
      return handle;
    };
    const denied = async (revision: number) => {
      const before = invoke.mock.calls.length;
      let handle: DesktopScopedRegistry | undefined;
      try { handle = scope(revision); } catch { /* A denied owner snapshot may reject scope creation. */ }
      if (handle) await handle.registry.executeTool('read_workspace-a', {}).catch(() => undefined);
      expect(invoke).toHaveBeenCalledTimes(before);
    };
    return { catalog, invoke, deliver, rejectedDelivery, scope, allowed, denied };
  }
  const confirmed = (permissionRevision: number, executionAllowed: boolean): Snapshot => ({ bootId: 'boot-a', permissionRevision, executionAllowed, persistenceState: 'confirmed' });
  const unknown = (permissionRevision: number): Snapshot => ({ bootId: 'boot-a', permissionRevision, executionAllowed: false, persistenceState: 'unknown' });

  it('W12-joint2 initial connection adopts the actual current confirmed revision, not a catalog-generated zero', async () => {
    const f = setup(); f.deliver(confirmed(7, true));
    expect(f.catalog.permissionRevision('workspace-a')).toBe(7); await f.allowed(7); await f.denied(0);
  });
  it('W12-joint2 initial unknown does not issue an executable scope even with its exact revision', async () => {
    const f = setup(); f.deliver(unknown(7));
    expect(f.catalog.permissionRevision('workspace-a')).toBe(7); await f.denied(7);
  });
  it.each([
    { name: 'committed grant', beforeAllowed: false, afterAllowed: true },
    { name: 'uncommitted grant rejection settlement', beforeAllowed: false, afterAllowed: false },
    { name: 'revoke confirmation', beforeAllowed: true, afterAllowed: false },
  ])('W12-joint2 $name confirms the SAME unknown candidate without another revision', async ({ beforeAllowed, afterAllowed }) => {
    const f = setup(); f.deliver(confirmed(7, beforeAllowed)); f.deliver(unknown(8));
    await f.denied(8); f.deliver(confirmed(8, afterAllowed));
    expect(f.catalog.permissionRevision('workspace-a')).toBe(8);
    if (afterAllowed) await f.allowed(8); else await f.denied(8);
  });
  it('W12-joint2 late same-revision unknown cannot abort an already confirmed granted scope', async () => {
    const f = setup(); f.deliver(unknown(8)); f.deliver(confirmed(8, true)); const handle = await f.allowed(8);
    f.rejectedDelivery(unknown(8));
    expect(handle.authority.signal.aborted).toBe(false);
    expect(await handle.registry.executeTool('read_workspace-a', {})).toBe('real-bound-effect');
  });
  it.each([true, false])('W12-joint2 same-revision opposite confirmed cannot replace allowed=%s', async allowed => {
    const f = setup(); f.deliver(confirmed(8, allowed)); f.rejectedDelivery(confirmed(8, !allowed));
    expect(f.catalog.permissionRevision('workspace-a')).toBe(8);
    if (allowed) await f.allowed(8); else await f.denied(8);
  });
  it('W12-joint2 older granted revision cannot reopen a newer denied workspace', async () => {
    const f = setup(); f.deliver(confirmed(8, false)); f.rejectedDelivery(confirmed(7, true));
    expect(f.catalog.permissionRevision('workspace-a')).toBe(8); await f.denied(7); await f.denied(8);
  });
  it('W12-joint2 a repeated identical confirmed snapshot does not invalidate a live scope', async () => {
    const f = setup(); f.deliver(confirmed(8, true)); const handle = await f.allowed(8); f.deliver(confirmed(8, true));
    expect(handle.authority.signal.aborted).toBe(false); expect(f.catalog.permissionRevision('workspace-a')).toBe(8);
    expect(await handle.registry.executeTool('read_workspace-a', {})).toBe('real-bound-effect');
  });
  it('W12-joint2 a later legitimate grant permits a NEW scope but never revives the old revoked scope or retained Tool', async () => {
    const f = setup(); f.deliver(confirmed(7, true)); const old = await f.allowed(7);
    const retained = old.registry.getRegisteredTool('read_workspace-a')!;
    f.deliver(unknown(8)); expect(old.authority.signal.aborted).toBe(true);
    f.deliver(confirmed(8, false)); f.deliver(confirmed(9, true));
    expect(old.authority.permissionRevision).toBe(7);
    const before = f.invoke.mock.calls.length;
    await retained.execute({}).catch(() => undefined); expect(f.invoke).toHaveBeenCalledTimes(before);
    await f.denied(7); await f.allowed(9);
  });
  it('W12-joint2 a connected domain cannot use legacy revokeWorkspace to mint an owner-free revision', async () => {
    const f = setup(); f.deliver(confirmed(8, false));
    try { f.catalog.revokeWorkspace({ requestSource: 'user', workspaceId: 'workspace-a' }); } catch { /* Explicit refusal is valid. */ }
    expect(f.catalog.permissionRevision('workspace-a')).toBe(8); await f.denied(8); await f.denied(9);
  });
  it('W12-joint2 an old-boot notification cannot replace the bound owner even with a larger revision', async () => {
    const f = setup(); f.deliver(confirmed(8, false)); f.rejectedDelivery({ ...confirmed(99, true), bootId: 'stale-boot' });
    expect(f.catalog.permissionRevision('workspace-a')).toBe(8); await f.denied(8); await f.denied(99);
  });
  it('W12-joint2 workspace A unknown does not revoke workspace B and its independently bound snapshot', async () => {
    const f = setup(); f.deliver(confirmed(7, true)); f.deliver(confirmed(12, true), 'workspace-b');
    const sibling = await f.allowed(12, 'workspace-b'); f.deliver(unknown(8));
    expect(sibling.authority.signal.aborted).toBe(false); expect(f.catalog.permissionRevision('workspace-b')).toBe(12);
    expect(await sibling.registry.executeTool('read_workspace-b', {})).toBe('real-bound-effect'); await f.denied(8);
  });
});
