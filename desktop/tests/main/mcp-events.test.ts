import { describe, expect, it, vi } from 'vitest';
import { DesktopMcpCatalogRegistration } from '../../electron/desktop-mcp-catalog-registration.js';
import { DesktopOwnedToolRegistry } from '../../electron/desktop-multi-agent-catalog-bridge.js';
import type { Tool } from '../../../src/types.js';

const tool = (name: string): Tool => ({ permission: 'safe', definition: { name, description: name, inputSchema: { type: 'object' } }, execute: async () => name });
describe('Desktop MCP event lifetime', () => {
  it('opens listen before discovery, refreshes changes and revokes on stream termination', async () => {
    let notify!: () => Promise<void>;
    let end!: (reason: 'remote') => void;
    const close = vi.fn(async () => {});
    const closed = new Promise<'remote'>(resolve => { end = resolve; });
    const client = { onclose: undefined, getServerCapabilities: () => ({ tools: { listChanged: true } }),
      setNotificationHandler: (_name: string, handler: () => Promise<void>) => { notify = handler; },
      listen: vi.fn(async () => ({ honoredFilter: { toolsListChanged: true }, close, closed })) };
    const registry = new DesktopOwnedToolRegistry({ mode: 'auto', confirm: async () => true }, []);
    const list = vi.fn(async () => ['initial']);
    const onDisconnected = vi.fn();
    const registration = new DesktopMcpCatalogRegistration({ registry, ownerId: 'events',
      connection: { client, protocolEra: 'modern' } as any, listSchemas: list, buildTools: names => names.map(tool), onDisconnected });
    expect(list).not.toHaveBeenCalled();
    await registration.initialize(100);
    expect(client.listen).toHaveBeenCalledOnce();
    expect(registry.getRegisteredTool('initial')).toBeDefined();
    list.mockResolvedValueOnce(['replacement']); await notify();
    expect(registry.getRegisteredTool('initial')).toBeUndefined();
    expect(registry.getRegisteredTool('replacement')).toBeDefined();
    end('remote'); await vi.waitFor(() => expect(onDisconnected).toHaveBeenCalledOnce());
    expect(registry.getRegisteredTool('replacement')).toBeUndefined();
    await notify(); expect(list).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
  });
  it('closes a late ACK after disposal without resurrecting the catalog', async () => {
    let ack!: (value: any) => void;
    const close = vi.fn(async () => {});
    const client = { onclose: undefined, getServerCapabilities: () => ({ tools: { listChanged: true } }), setNotificationHandler() {},
      listen: () => new Promise<any>(resolve => { ack = resolve; }) };
    const registry = new DesktopOwnedToolRegistry({ mode: 'auto', confirm: async () => true }, []);
    const listSchemas = vi.fn(async () => ['late']);
    const registration = new DesktopMcpCatalogRegistration({ registry, ownerId: 'events', connection: { client, protocolEra: 'modern' } as any, listSchemas, buildTools: names => names.map(tool) });
    const pending = registration.initialize(100); registration.dispose();
    ack({ honoredFilter: { toolsListChanged: true }, close, closed: new Promise(() => {}) }); expect(await pending).toBe(false);
    expect(close).toHaveBeenCalledOnce(); expect(listSchemas).not.toHaveBeenCalled();
    expect(registry.getRegisteredTool('late')).toBeUndefined();
  });
});
