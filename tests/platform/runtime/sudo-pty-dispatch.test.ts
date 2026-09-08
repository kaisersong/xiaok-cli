import { describe, it, expect, vi } from 'vitest';
import { createPlatformRegistryFactory } from '../../../src/platform/runtime/registry-factory.js';
import { CapabilityRegistry } from '../../../src/platform/runtime/capability-registry.js';

describe('sudo terminal host ownership', () => {
  it.each(['chat', 'desktop'])('only exposes the host to chat/main, source=%s', async source => {
    const runInteractiveBash = vi.fn(async () => 'HOST_EXECUTED');
    const platform = { customAgents: [], pluginRuntime: { hookConfigs: [] }, mcpTools: [],
      capabilityRegistry: new CapabilityRegistry(), createBackgroundRunner: () => ({ dispose: async () => ({ settled: true, pendingJobs: [] }) }),
      createReminderApi: () => undefined, onMcpToolsChanged: () => () => {},
    } as any;
    const factory = createPlatformRegistryFactory({ platform, source, sessionId: 'sudo-test', runInteractiveBash,
      adapter: () => ({ getModelName: () => 'test' } as any), buildSystemPrompt: async () => '',
      permissionManager: { getMode: () => 'auto', check: () => 'allow' } as any,
    });
    try {
      const main = factory.createRegistry(process.cwd());
      const child = factory.createRegistry(process.cwd(), ['bash'], 'child');
      expect(await child.executeTool('bash', { command: 'sudo id' })).toContain('交互终端');
      expect(runInteractiveBash).not.toHaveBeenCalled();
      const result = await main.executeTool('bash', { command: 'sudo id' });
      expect(result).toContain(source === 'chat' ? 'HOST_EXECUTED' : '交互终端');
      expect(runInteractiveBash).toHaveBeenCalledTimes(source === 'chat' ? 1 : 0);
    } finally { await factory.dispose(); }
  });
});
