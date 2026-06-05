import type { BrowserWindow, IpcMain } from 'electron';
import type { createDesktopServices } from './desktop-services.js';
import type { KSwarmStreamBridge } from './kswarm-stream-bridge.js';

export type DesktopServices = Awaited<ReturnType<typeof createDesktopServices>>;

export interface MainStartupDeps {
  ipcMain: IpcMain;
  app: Pick<Electron.App, 'getPath' | 'setName' | 'isReady' | 'getVersion'> & { dock?: Electron.Dock };
  createWindow: () => Promise<BrowserWindow>;
  createDesktopServices: (opts: { dataRoot: string; kswarmService: unknown }) => DesktopServices;
  registerDesktopIpc: (ipcMain: IpcMain, window: BrowserWindow, services: DesktopServices) => Promise<void>;
  recoverStaleTasks: (services: DesktopServices) => Promise<void>;
  registerChannelTools: (services: DesktopServices) => void;
  registerSkillTools: (services: DesktopServices) => void;
  deployBundledPlugins: () => Promise<{ venvReady: boolean }>;
  scheduleRuntimeBridgeFallback: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  registerMcpTools: (services: DesktopServices) => Promise<{ dispose: () => void }>;
  setupAutoUpdater: (window: BrowserWindow) => Promise<void>;
  setupMenuBar: (window: BrowserWindow) => void;
  startRuntimeBridge: (services: DesktopServices, kswarmStartPromise: Promise<void>) => void;
  createKSwarmStreamBridge: () => KSwarmStreamBridge;
  registerKSwarmProxy: (ipcMain: IpcMain, bridge: KSwarmStreamBridge) => void;
}

export interface MainStartupResult {
  window: BrowserWindow;
  services: DesktopServices;
  kswarmStreamBridge: KSwarmStreamBridge;
  dispose: () => void;
}

export async function runMainStartup(deps: MainStartupDeps): Promise<MainStartupResult> {
  const services = deps.createDesktopServices({
    dataRoot: deps.app.getPath('userData'),
    kswarmService: null,
  });
  const window = await deps.createWindow();
  await deps.registerDesktopIpc(deps.ipcMain, window, services);
  await deps.recoverStaleTasks(services);
  deps.registerChannelTools(services);
  deps.registerSkillTools(services);
  await deps.deployBundledPlugins();

  const kswarmStreamBridge = deps.createKSwarmStreamBridge();
  deps.registerKSwarmProxy(deps.ipcMain, kswarmStreamBridge);

  let mcpDispose: (() => void) | undefined;
  const fallbackTimer = deps.scheduleRuntimeBridgeFallback(() => {
    deps.startRuntimeBridge(services, Promise.resolve());
  }, 10_000);

  try {
    const { dispose } = await deps.registerMcpTools(services);
    mcpDispose = dispose;
  } catch {}
  deps.startRuntimeBridge(services, Promise.resolve());

  deps.setupAutoUpdater(window).catch(() => {});
  deps.setupMenuBar(window);

  return {
    window,
    services,
    kswarmStreamBridge,
    dispose: () => {
      clearTimeout(fallbackTimer);
      kswarmStreamBridge.dispose();
      mcpDispose?.();
    },
  };
}
