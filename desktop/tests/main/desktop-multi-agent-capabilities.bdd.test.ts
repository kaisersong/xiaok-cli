// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopCapabilityCatalog, type DesktopCapabilityEntry } from '../../electron/desktop-multi-agent-capabilities.js';
import { createWriteTool } from '../../../src/ai/tools/write.js';
import { createReadTool } from '../../../src/ai/tools/read.js';

describe('BDD: identity-based capability policy and real scoped ToolRegistry', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const action of cleanup.splice(0).reverse()) action(); });
  const scope = { workspaceId: 'w1', materialIds: [], permissions: ['safe', 'write', 'bash'] as const };
  const entry = (name: string, invoke: ReturnType<DesktopCapabilityEntry['bindInvocation']> = vi.fn(async () => 'ok')): DesktopCapabilityEntry => ({
    definition: { name, description: 'fixture capability', inputSchema: { type: 'object', properties: {} } },
    aliases: [], permission: 'safe', scope, bindInvocation: () => invoke,
  });
  function scoped(catalog: DesktopCapabilityCatalog, policy = catalog.snapshotPolicy(), options = {}) {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-capability-')); cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const controller = new AbortController();
    const handle = catalog.createScopedRegistry(policy, { groupId: 'g1', agentId: 'a1', turnId: 'turn-1', cwd: root,
      workspaceId: 'w1', materialIds: [], permissionRevision: 0, signal: controller.signal, deadlineAt: Date.now() + 60_000,
    }, { autoMode: true, ...options });
    cleanup.push(() => handle.dispose());
    return { ...handle, root, controller };
  }
  function publish(catalog: DesktopCapabilityCatalog, ownerId: string, item: DesktopCapabilityEntry, slotId?: string) {
    const descriptor = catalog.publish({ requestSource: 'scheduler', ownerId, slotId, entry: item });
    catalog.authorize({ requestSource: 'user', capabilityId: descriptor.capabilityId });
    return descriptor;
  }

  it('A38 Given a frozen child policy, When another owner replaces a revoked name, Then it cannot inherit the old slot grant', async () => {
    const catalog = new DesktopCapabilityCatalog();
    const first = publish(catalog, 'owner-a', entry('cap'));
    const child = scoped(catalog);
    expect(await child.registry.executeTool('cap', {})).toBe('ok');
    catalog.revoke({ requestSource: 'scheduler', ownerId: 'owner-a', slotId: first.slotId });
    const foreign = vi.fn(async () => 'foreign');
    publish(catalog, 'owner-b', entry('cap', foreign));
    expect(await child.registry.executeTool('cap', {})).toMatch(/Error|not allowed|revoked/);
    expect(foreign).not.toHaveBeenCalled();
  });

  it('A13 Given two disjoint allowlists, When their explicit intersection is empty, Then it denies all rather than falling back to a full registry', async () => {
    const catalog = new DesktopCapabilityCatalog();
    publish(catalog, 'builtin', entry('cap'));
    const denied = scoped(catalog, catalog.forkPolicy(catalog.snapshotPolicy(), []));
    expect(await denied.registry.executeTool('cap', {})).toMatch(/Error/);
  });

  it('A30 Given opaque capabilities and their aliases, When invoked, Then durable manual marking runs before either side effect and a failed mark blocks execution', async () => {
    const catalog = new DesktopCapabilityCatalog(); const order: string[] = [];
    publish(catalog, 'mcp', { ...entry('opaque', async () => { order.push('effect'); return 'ok'; }), aliases: ['opaque_alias'] });
    const marker = vi.fn(() => { order.push('journal'); });
    const handle = catalog.createScopedRegistry(catalog.snapshotPolicy(), { groupId: 'g', agentId: 'a', turnId: 't', cwd: process.cwd(),
      workspaceId: 'w1', materialIds: [], permissionRevision: 0, signal: new AbortController().signal, deadlineAt: Date.now() + 10_000,
      beforeOpaqueInvocation: marker,
    }, { autoMode: true });
    try {
      await handle.registry.executeTool('opaque', {}); await handle.registry.executeTool('opaque_alias', {});
      expect(order).toEqual(['journal', 'effect', 'journal', 'effect']);
      marker.mockImplementation(() => { throw new Error('SQLITE_FULL'); });
      expect(await handle.registry.executeTool('opaque_alias', {})).toContain('SQLITE_FULL');
      expect(order).toHaveLength(4);
    } finally { handle.dispose(); }
  });

  it('A38 Given the same owner but a new slot, When it adopts a revoked name, Then child authority is still not inherited', async () => {
    const catalog = new DesktopCapabilityCatalog();
    const first = publish(catalog, 'owner-a', entry('cap'));
    const child = scoped(catalog);
    catalog.revoke({ requestSource: 'scheduler', ownerId: 'owner-a', slotId: first.slotId });
    const second = publish(catalog, 'owner-a', entry('cap'));
    expect(second.slotId).not.toBe(first.slotId);
    expect(await child.registry.executeTool('cap', {})).toMatch(/Error/);
  });

  it('A38 Given a same-slot new revision, When root reauthorizes it within the original scope, Then renamed tools and aliases become callable', async () => {
    const catalog = new DesktopCapabilityCatalog();
    const first = publish(catalog, 'owner-a', entry('cap'));
    const child = scoped(catalog);
    const next = catalog.publish({ requestSource: 'scheduler', ownerId: first.ownerId, slotId: first.slotId,
      entry: { ...entry('renamed'), aliases: ['alias'] } });
    expect(await child.registry.executeTool('renamed', {})).toMatch(/Error/);
    catalog.authorize({ requestSource: 'user', capabilityId: next.capabilityId });
    expect(next.revision).toBe(first.revision + 1);
    expect(await child.registry.executeTool('alias', {})).toBe('ok');
    expect(await child.registry.executeTool('cap', {})).toMatch(/Error/);
  });

  it('A38 Given a frozen narrow material scope, When a replacement expands it, Then root reauthorization cannot widen the existing child ceiling', async () => {
    const catalog = new DesktopCapabilityCatalog();
    const first = publish(catalog, 'owner-a', entry('cap'));
    const child = scoped(catalog);
    publish(catalog, first.ownerId, { ...entry('cap'), scope: { ...scope, materialIds: ['new-material'] } }, first.slotId);
    expect(await child.registry.executeTool('cap', {})).toMatch(/Error/);
  });

  it('A38 Given approval is pending, When its descriptor revision changes, Then approving the old request cannot invoke either generation', async () => {
    const catalog = new DesktopCapabilityCatalog();
    let approve!: (value: boolean) => void;
    const approval = new Promise<boolean>(resolve => { approve = resolve; });
    const onPrompt = vi.fn(() => approval);
    const oldInvoke = vi.fn(async () => 'old'); const newInvoke = vi.fn(async () => 'new');
    const first = publish(catalog, 'owner-a', { ...entry('write', oldInvoke), permission: 'write' });
    const child = scoped(catalog, catalog.snapshotPolicy(), { autoMode: false, onPrompt });
    const execution = child.registry.executeTool('write', {});
    try {
      await vi.waitFor(() => expect(onPrompt).toHaveBeenCalledOnce());
      publish(catalog, first.ownerId, { ...entry('write', newInvoke), permission: 'write' }, first.slotId);
    } finally { approve(true); }
    expect(await execution).toMatch(/Error|registered|revoked/);
    expect(oldInvoke).not.toHaveBeenCalled(); expect(newInvoke).not.toHaveBeenCalled();
  });

  it('A24 Given different child cwd bindings, When production read/write tools execute, Then each uses its own directory', async () => {
    const catalog = new DesktopCapabilityCatalog();
    publish(catalog, 'builtin', { ...entry('write'), permission: 'write', definition: createWriteTool().definition,
      bindInvocation: authority => createWriteTool({ cwd: authority.cwd }).execute });
    publish(catalog, 'builtin', { ...entry('read'), definition: createReadTool().definition,
      bindInvocation: authority => createReadTool({ cwd: authority.cwd }).execute });
    const a = scoped(catalog); const b = scoped(catalog);
    // Production read/write explicitly take absolute file_path, not a shell cwd
    // relative path. The binding must accept its own directory and reject B's.
    expect(await a.registry.executeTool('write', { file_path: join(a.root, 'sentinel.txt'), content: 'A sentinel' })).not.toMatch(/Error/);
    expect(await b.registry.executeTool('write', { file_path: join(b.root, 'sentinel.txt'), content: 'B sentinel' })).not.toMatch(/Error/);
    expect(readFileSync(join(a.root, 'sentinel.txt'), 'utf8')).toBe('A sentinel');
    expect(await b.registry.executeTool('read', { file_path: join(b.root, 'sentinel.txt') })).toContain('B sentinel');
    expect(await a.registry.executeTool('write', { file_path: join(b.root, 'sentinel.txt'), content: 'forbidden' })).toMatch(/Error.*outside workspace/);
    expect(readFileSync(join(b.root, 'sentinel.txt'), 'utf8')).toBe('B sentinel');
  });

  it('A22 Given workspace permission is revoked, When old root/child registries invoke, Then both fail and their invocation signals abort', async () => {
    const catalog = new DesktopCapabilityCatalog(); const invoke = vi.fn(async () => 'ok');
    publish(catalog, 'builtin', entry('cap', invoke));
    const a = scoped(catalog); const b = scoped(catalog);
    catalog.revokeWorkspace({ requestSource: 'user', workspaceId: 'w1' });
    expect(a.authority.signal.aborted).toBe(true); expect(b.authority.signal.aborted).toBe(true);
    expect(await a.registry.executeTool('cap', {})).toMatch(/Error/);
    expect(await b.registry.executeTool('cap', {})).toMatch(/Error/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('A13 Given the built-in control namespace, When MCP tries a direct or alias collision, Then publication is rejected atomically', () => {
    const catalog = new DesktopCapabilityCatalog();
    expect(() => publish(catalog, 'mcp-a', entry('spawn_agent'))).toThrow(/reserved|control/);
    expect(() => publish(catalog, 'mcp-a', { ...entry('innocent'), aliases: ['spawn_agent'] })).toThrow(/reserved|control/);
    expect(catalog.snapshotDescriptors()).toEqual([]);
  });

  it('A38 Given an agent asks to authorize itself, When the catalog mutation is called, Then default-deny remains in the service layer', () => {
    const catalog = new DesktopCapabilityCatalog();
    const descriptor = catalog.publish({ requestSource: 'scheduler', ownerId: 'builtin', entry: entry('cap') });
    expect(() => catalog.authorize({ requestSource: 'agent', capabilityId: descriptor.capabilityId })).toThrow(/permitted/);
  });
});
