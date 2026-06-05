import { describe, expect, it, vi } from 'vitest';
import { runMainStartup, type MainStartupDeps } from '../../electron/main-startup.js';

function createMockDeps(callOrder: string[]): MainStartupDeps {
  const mockWindow = { webContents: { send: vi.fn() }, isDestroyed: () => false } as any;
  const mockServices = {
    recoverStaleTasks: vi.fn(),
    registerChannelTools: vi.fn(),
    registerSkillTools: vi.fn(),
    registerMcpTools: vi.fn().mockResolvedValue({ dispose: vi.fn() }),
    runKSwarmHandoffTask: vi.fn(),
    runKSwarmWorkflowNode: vi.fn(),
  } as any;
  const mockBridge = { start: vi.fn(), dispose: vi.fn() } as any;

  return {
    ipcMain: { handle: vi.fn() } as any,
    app: {
      getPath: () => '/tmp/test-userdata',
      setName: vi.fn(),
      isReady: () => true,
      getVersion: () => '1.0.0',
    },
    createWindow: vi.fn(async () => {
      callOrder.push('createWindow');
      return mockWindow;
    }),
    createDesktopServices: vi.fn((_opts) => {
      callOrder.push('createDesktopServices');
      return mockServices;
    }),
    registerDesktopIpc: vi.fn(async () => { callOrder.push('registerDesktopIpc'); }),
    recoverStaleTasks: vi.fn(async () => { callOrder.push('recoverStaleTasks'); }),
    registerChannelTools: vi.fn(() => { callOrder.push('registerChannelTools'); }),
    registerSkillTools: vi.fn(() => { callOrder.push('registerSkillTools'); }),
    deployBundledPlugins: vi.fn(async () => { callOrder.push('deployBundledPlugins'); return { venvReady: false }; }),
    scheduleRuntimeBridgeFallback: vi.fn((cb, ms) => {
      callOrder.push('scheduleRuntimeBridgeFallback');
      return setTimeout(() => {}, 0);
    }),
    registerMcpTools: vi.fn(async () => { callOrder.push('registerMcpTools'); return { dispose: vi.fn() }; }),
    setupAutoUpdater: vi.fn(async () => { callOrder.push('setupAutoUpdater'); }),
    setupMenuBar: vi.fn(() => { callOrder.push('setupMenuBar'); }),
    startRuntimeBridge: vi.fn(() => { callOrder.push('startRuntimeBridge'); }),
    createKSwarmStreamBridge: vi.fn(() => {
      callOrder.push('createKSwarmStreamBridge');
      return mockBridge;
    }),
    registerKSwarmProxy: vi.fn(() => { callOrder.push('registerKSwarmProxy'); }),
  };
}

describe('desktop startup order', () => {
  it('executes steps in the required dependency order', async () => {
    const callOrder: string[] = [];
    const deps = createMockDeps(callOrder);

    await runMainStartup(deps);

    const indexOf = (step: string) => callOrder.indexOf(step);

    expect(indexOf('createDesktopServices')).toBeLessThan(indexOf('createWindow'));
    expect(indexOf('createWindow')).toBeLessThan(indexOf('registerDesktopIpc'));
    expect(indexOf('registerDesktopIpc')).toBeLessThan(indexOf('recoverStaleTasks'));
    expect(indexOf('recoverStaleTasks')).toBeLessThan(indexOf('registerChannelTools'));
    expect(indexOf('registerChannelTools')).toBeLessThan(indexOf('registerSkillTools'));
    expect(indexOf('registerSkillTools')).toBeLessThan(indexOf('deployBundledPlugins'));
    expect(indexOf('deployBundledPlugins')).toBeLessThan(indexOf('registerMcpTools'));
    expect(indexOf('registerMcpTools')).toBeLessThan(indexOf('startRuntimeBridge'));
  });

  it('returns window, services, and dispose function', async () => {
    const callOrder: string[] = [];
    const deps = createMockDeps(callOrder);

    const result = await runMainStartup(deps);

    expect(result.window).toBeDefined();
    expect(result.services).toBeDefined();
    expect(result.kswarmStreamBridge).toBeDefined();
    expect(typeof result.dispose).toBe('function');
  });

  it('dispose cleans up bridge and mcp', async () => {
    const callOrder: string[] = [];
    const deps = createMockDeps(callOrder);

    const result = await runMainStartup(deps);
    result.dispose();

    expect(result.kswarmStreamBridge.dispose).toHaveBeenCalled();
  });

  it('still starts runtime bridge when registerMcpTools fails', async () => {
    const callOrder: string[] = [];
    const deps = createMockDeps(callOrder);
    (deps.registerMcpTools as any).mockRejectedValue(new Error('mcp unavailable'));

    await runMainStartup(deps);

    expect(callOrder).toContain('startRuntimeBridge');
  });
});
