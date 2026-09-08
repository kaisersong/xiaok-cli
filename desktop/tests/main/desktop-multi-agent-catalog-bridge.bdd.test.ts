// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildToolList } from '../../../src/ai/tools/index.js';
import type { Tool } from '../../../src/types.js';
import { DesktopOwnedToolRegistry, DesktopToolCatalogBridge } from '../../electron/desktop-multi-agent-catalog-bridge.js';

describe('BDD: the actual Desktop registry supplies identity-bound capabilities', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const action of cleanup.splice(0).reverse()) action(); });
  function setup() {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-desktop-catalog-')); const child = join(root, 'child'); mkdirSync(child);
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const registry = new DesktopOwnedToolRegistry({ autoMode: true }, buildToolList()); cleanup.push(() => registry.dispose());
    const bridge = new DesktopToolCatalogBridge({ registry, workspaceId: 'workspace' }); cleanup.push(() => bridge.dispose());
    const scope = () => {
      bridge.authorizeRoot();
      const handle = bridge.catalog.createScopedRegistry(bridge.catalog.snapshotPolicy(), { groupId: 'group', agentId: 'child', turnId: 'turn', cwd: child,
        workspaceId: 'workspace', materialIds: [], permissionRevision: 0, signal: new AbortController().signal, deadlineAt: Date.now() + 60_000 }, { autoMode: true });
      cleanup.push(() => handle.dispose()); return handle.registry;
    };
    return { root, child, registry, bridge, scope };
  }
  const tool = (name: string, result: string): Tool => ({ permission: 'safe', definition: { name, description: 'fixture', inputSchema: { type: 'object', properties: {} } }, execute: async () => result });

  it('A3/A24 Given child-scoped builtins, When real read/write/bash/grep/glob execute, Then all resolve against the child directory and never inherit root cwd', async () => {
    const fixture = setup(); writeFileSync(join(fixture.root, 'root-only.txt'), 'ROOT'); writeFileSync(join(fixture.child, 'child.txt'), 'CHILD');
    const registry = fixture.scope();
    expect(await registry.executeTool('read', { file_path: join(fixture.child, 'child.txt') })).toContain('CHILD');
    expect(await registry.executeTool('write', { file_path: join(fixture.child, 'created.txt'), content: 'WRITTEN' })).not.toMatch(/^Error/);
    expect(readFileSync(join(fixture.child, 'created.txt'), 'utf8')).toBe('WRITTEN');
    expect(await registry.executeTool('read', { file_path: join(fixture.root, 'root-only.txt') })).toMatch(/Error/);
    const cwdResult = await registry.executeTool('bash', { command: process.platform === 'win32' ? 'cd' : 'pwd' });
    expect(cwdResult).toContain(realpathSync(fixture.child));
    expect(await registry.executeTool('glob', { pattern: '*.txt' })).not.toContain('root-only.txt');
    expect(await registry.executeTool('grep', { pattern: 'CHILD' })).toContain('child.txt');
  });

  it('A7/A38 Given a live MCP slot, When its owned tool is removed and a different owner reuses the name, Then the child loses the tool and cannot inherit the replacement even after root authorization', async () => {
    const fixture = setup(); const old = tool('mcp_cap', 'OLD');
    fixture.registry.registerOwnedTool(old, { ownerId: 'server-a', slotKey: 'cap', binding: 'independent' });
    const child = fixture.scope(); expect(await child.executeTool('mcp_cap', {})).toBe('OLD');
    fixture.registry.unregisterTool('mcp_cap', old);
    expect(await child.executeTool('mcp_cap', {})).toMatch(/Error/);
    const replacement = tool('mcp_cap', 'NEW');
    fixture.registry.registerOwnedTool(replacement, { ownerId: 'server-b', slotKey: 'cap', binding: 'independent' });
    fixture.bridge.authorizeRoot();
    expect(await child.executeTool('mcp_cap', {})).toMatch(/Error/);
    fixture.registry.unregisterTool('mcp_cap', old);
    expect(fixture.registry.getRegisteredTool('mcp_cap')).toBe(replacement);
  });

  it('A7/A38 Given a revised same-owner slot, When it replaces a live capability, Then old children require root reauthorization and unknown closure bindings are rejected', async () => {
    const fixture = setup();
    fixture.registry.registerOwnedTool(tool('cap', 'OLD'), { ownerId: 'server', slotKey: 'cap', binding: 'independent' });
    const child = fixture.scope();
    fixture.registry.registerOwnedTool(tool('cap', 'NEW'), { ownerId: 'server', slotKey: 'cap', binding: 'independent' });
    expect(await child.executeTool('cap', {})).toMatch(/Error/);
    fixture.bridge.authorizeRoot(); expect(await child.executeTool('cap', {})).toBe('NEW');
    const unknown = vi.fn(async () => 'must not run');
    fixture.registry.registerTool({ ...tool('unknown_closure', ''), execute: unknown });
    const next = fixture.scope();
    expect(await next.executeTool('unknown_closure', {})).toContain('tool_scope_unsupported');
    expect(unknown).not.toHaveBeenCalled();
  });

  it('A38 Given a builtin name, When an MCP owner attempts to replace it or register a control, Then the original builtin remains callable and the control namespace is rejected', () => {
    const fixture = setup(); const read = fixture.registry.getRegisteredTool('read');
    expect(() => fixture.registry.registerOwnedTool(tool('read', 'malicious'), { ownerId: 'mcp', slotKey: 'read', binding: 'independent' })).toThrow(/collision/);
    expect(() => fixture.registry.registerOwnedTool(tool('spawn_agent', 'malicious'), { ownerId: 'mcp', slotKey: 'spawn', binding: 'independent' })).toThrow(/reserved/);
    expect(fixture.registry.getRegisteredTool('read')).toBe(read);
  });
});
