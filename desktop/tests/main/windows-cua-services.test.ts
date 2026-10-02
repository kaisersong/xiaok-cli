import { resolveInstallPaths } from '../../../src/platform/plugins/install/source.js';
import { switchActivePluginPointer } from '../../../src/platform/plugins/install/active-pointer.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopServices } from '../../electron/desktop-services.js';
import type { KSwarmService } from '../../electron/kswarm-service.js';
vi.mock('../../electron/windows-cua-host.js', () => ({
  detectNativeWindowsArchitecture: vi.fn(async () => 'x64'), detectWindowsInteractiveDesktop: vi.fn(async () => true),
}));
import { detectWindowsInteractiveDesktop } from '../../electron/windows-cua-host.js';

describe('Windows Desktop CUA production service with real stdio transport', () => {
  let root: string;
  let services: ReturnType<typeof createDesktopServices>;
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const arch = Object.getOwnPropertyDescriptor(process, 'arch')!;
  const configRoot = process.env.XIAOK_CONFIG_DIR;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cua-windows-services-'));
    process.env.XIAOK_CONFIG_DIR = join(root, 'config');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    Object.defineProperty(process, 'arch', { value: 'x64' });
    vi.mocked(detectWindowsInteractiveDesktop).mockResolvedValue(true);
  });
  afterEach(async () => {
    await services?.disableComputerUse({ requestSource: 'user' });
    Object.defineProperty(process, 'platform', platform);
    Object.defineProperty(process, 'arch', arch);
    if (configRoot === undefined) delete process.env.XIAOK_CONFIG_DIR; else process.env.XIAOK_CONFIG_DIR = configRoot;
    rmSync(root, { recursive: true, force: true });
  });
  function create(kind = 'target', version = '0.31.0') {
    const fixtures = join(process.cwd(), '..', 'tests', 'fixtures', 'cua-windows-0.31.0');
    const capture = JSON.parse(readFileSync(join(fixtures, 'capture.json'), 'utf8'));
    const server = join(process.cwd(), '..', 'tests', 'support', 'cua-mcp-stdio-server.js');
    const plugins = join(root, 'plugins'); const dir = join(plugins, 'cua-computer-use'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify({ name: 'cua-computer-use', version: '0.3.0', platforms: ['darwin', 'win32'], mcpServers: [{ name: 'cua-driver', type: 'stdio', command: process.execPath, args: [server], protocol: { mode: 'legacy' }, env: { CUA_MCP_WINDOWS_FIXTURE: kind, CUA_MCP_WINDOWS_VERSION: version, CUA_MCP_WINDOWS_CATALOG: join(fixtures, 'catalog.json'), CUA_MCP_WINDOWS_CAPTURE: join(fixtures, 'capture.json') } }] }));
    services = createDesktopServices({ dataRoot: join(root, 'data'), pluginRootDir: plugins, computerUseBundledPluginDir: dir,
      kswarmService: { getStatus: () => ({ running: true }), request: async () => new Response('{}') } as unknown as KSwarmService,
      pluginDependencyStatusOptions: { nativeOsArch: 'x64', exists: () => true, runCommand: async () => ({ exitCode: 0, stdout: '0.31.0', stderr: '' }) },
      pluginDependencies: [{ pluginName: 'cua-computer-use', dependency: { id: 'cua-driver', kind: 'native_cli', supportedPlatforms: ['win32'], displayName: 'CUA', binaryCandidates: [process.execPath], mcp: { serverName: 'cua-driver', command: process.execPath, args: [server], requiresUserActivation: true } } }],
      computerUseAppIdentity: { platform: 'win32', isPackaged: false },
      getComputerUseReadinessTarget: () => ({ pid: capture.structuredContent.pid, window_id: capture.structuredContent.window_id }),
    });
    return services;
  }
  it('qualifies before registration, stays inactive on startup and commits v2 only after PNG validation', async () => {
    create(); expect(services.getToolDefinitions().some(t => t.name === 'xiaok_computer_use')).toBe(false);
    const registration = await services.registerMcpTools();
    expect(services.getComputerUseCapabilityStatus()).toMatchObject({ state: 'not_enabled', mcpConnected: false, wrapperReady: true });
    expect(await services.enableComputerUse({ requestSource: 'user' })).toMatchObject({ state: 'ready', mcpConnected: true });
    expect(JSON.parse(readFileSync(join(root, 'data', 'computer-use-state.json'), 'utf8'))).toMatchObject({ schemaVersion: 2, platform: 'win32', enabledByUser: true, lastSuccessfulAt: expect.any(Number) });
    expect(services.getToolDefinitions().some(t => t.name.startsWith('mcp__cua-driver__'))).toBe(false);
    await registration.dispose();
  });
  it('actually enables the current Desktop bundle when an older valid managed Mac-only CUA is installed', async () => {
    create();
    const paths = resolveInstallPaths(join(root, 'plugins')); const digest = 'd'.repeat(64);
    const versionDir = join(paths.managedDir, 'cua-computer-use', digest);
    const pluginDir = join(versionDir, 'repo', 'plugins', 'cua-computer-use'); mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({ name: 'cua-computer-use', version: '0.2.1', platforms: ['darwin'] }));
    await switchActivePluginPointer(paths, { name: 'cua-computer-use', version: '0.2.1', digest, commit: 'c'.repeat(40), versionDir, pluginDir, registryUrl: 'https://example.com/registry-v2.json', probe: { status: 'verified', outcomes: [] } });
    expect(await services.enableComputerUse({ requestSource: 'user' })).toMatchObject({ state: 'ready', mcpConnected: true });
  });

  it('keeps an empty desktop connected and user intent enabled without recording success', async () => {
    create('empty');
    expect(await services.enableComputerUse({ requestSource: 'user' })).toMatchObject({ state: 'connected_no_target', mcpConnected: true });
    const preference = JSON.parse(readFileSync(join(root, 'data', 'computer-use-state.json'), 'utf8'));
    expect(preference.enabledByUser).toBe(true); expect(preference.lastSuccessfulAt).toBeUndefined();
  });
  it('fails closed on initialized version mismatch or no interactive desktop', async () => {
    create('target', '0.30.0');
    expect(await services.enableComputerUse({ requestSource: 'user' })).toMatchObject({ state: 'failed', mcpConnected: false });
    expect(services.getToolDefinitions().some(t => t.name.startsWith('mcp__cua-driver__'))).toBe(false);
    vi.mocked(detectWindowsInteractiveDesktop).mockResolvedValue(false);
    const result = await services.reconnectComputerUse({ requestSource: 'user' });
    expect(result.lastError).toContain('解锁');
  });
});
