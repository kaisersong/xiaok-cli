import { app, BrowserWindow, ipcMain, shell, nativeImage, Menu } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFileSync, mkdirSync } from 'node:fs';
import { createDesktopServices } from './desktop-services.js';
import { registerDesktopIpc } from './ipc.js';
import { buildBrowserWindowOptions, isAllowedNavigationUrl } from './security.js';
import { resolveDesktopWindowIconPath } from './window-icon.js';
import {
  attachCloseToMinimize,
  attachWindowRepaintHandlers,
  removeWindowsWindowMenu,
  restoreExistingWindow,
} from './window-lifecycle.js';
import { setupMenuBar, destroyMenuBar } from './menubar.js';
import { setupAutoUpdater, checkForUpdates, quitAndInstall, getUpdateStatus } from './updater.js';
import { createKSwarmService } from './kswarm-service.js';
import { deployBundledPlugins } from './deploy-bundled-plugins.js';
import { TimedActionStore } from './timed-action-store.js';
import { TimedActionService } from './timed-action-service.js';
import { TimedActionScheduler } from './timed-action-scheduler.js';
import { createAgentTaskExecutor, createNotifyExecutor } from './timed-action-executors.js';
import { attachDesktopContextMenu } from './context-menu.js';
import {
  createKSwarmRuntimeBridge,
  createKSwarmRuntimeBridgeBrokerClient,
  submitKSwarmRuntimeResultToBroker,
} from './kswarm-runtime-bridge.js';
import { XIAOK_PO_SEED_ID, XIAOK_WORKER_SEED_ID } from '../shared/kswarm-seed-contract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

function debugMain(message: string, extra?: unknown): void {
  const suffix = extra === undefined ? '' : ` ${JSON.stringify(extra)}`;
  const line = `[main-debug] ${message}${suffix}`;
  try {
    const logDir = join(__dirname, '..', '..', '..', '.tmp');
    mkdirSync(logDir, { recursive: true });
    appendFileSync(join(logDir, 'main-debug.log'), `${new Date().toISOString()} ${line}\n`);
  } catch {}
  console.log(line);
}

// Suppress EPIPE errors from console.log after stdout pipe closes
process.on('uncaughtException', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return;
  console.error('[main] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason);
});
process.on('exit', (code) => {
  debugMain('process exit', { code });
});
const singleInstanceDisabled = process.env.XIAOK_DESKTOP_DISABLE_SINGLE_INSTANCE === '1';
const singleInstanceLock = singleInstanceDisabled ? true : app.requestSingleInstanceLock();
if (singleInstanceDisabled) {
  debugMain('single-instance-lock:disabled-by-env');
}

async function createWindow(): Promise<BrowserWindow> {
  debugMain('createWindow:start');
  const preloadPath = join(__dirname, 'preload.cjs');
  const window = new BrowserWindow(buildBrowserWindowOptions(preloadPath, {
    platform: process.platform,
    iconPath: resolveDesktopWindowIconPath(__dirname, process.platform),
  }));
  debugMain('createWindow:browserWindow-created');
  removeWindowsWindowMenu(window, process.platform);
  attachDesktopContextMenu(window, Menu);
  mainWindow = window;
  // KSwarm service — manages kswarm server as a child process
  const kswarmService = createKSwarmService();
  const kswarmStartPromise = kswarmService.start().catch((err) => {
    console.error('[main] Failed to start kswarm service:', err);
  });
  ipcMain.handle('desktop:kswarm:getStatus', () => kswarmService.getStatus());
  ipcMain.handle('desktop:kswarm:start', () => kswarmService.start());
  ipcMain.handle('desktop:kswarm:stop', () => kswarmService.stop());
  ipcMain.handle('desktop:kswarm:restart', () => kswarmService.restart());
  let restartRuntimeBridgeService: () => Promise<void> = async () => {};
  ipcMain.handle('desktop:services:getStatus', async () => {
    const snapshot = await kswarmService.getServiceStatus();
    return {
      ...snapshot,
      services: [
        ...snapshot.services,
        {
          id: 'runtime-bridge',
          label: 'Runtime Bridge',
          running: runtimeBridgeStarted,
          reachable: runtimeBridgeStarted,
          port: 0,
          pid: null,
          restartCount: 0,
          lastError: null,
          detail: runtimeBridgeStarted ? `${runtimeBridgeClients.length} client(s) registered` : 'not started',
        },
      ],
    };
  });
  ipcMain.handle('desktop:services:restart', (_event, serviceId) => (
    serviceId === 'runtime-bridge'
      ? restartRuntimeBridgeService()
      : kswarmService.restartRelatedService(serviceId)
  ));
  kswarmService.onStatusChange((status) => {
    window.webContents.send('desktop:kswarm:statusChange', status);
  });

  const dataRoot = join(app.getPath('home'), '.xiaok', 'desktop');
  const services = createDesktopServices({
    dataRoot,
    kswarmService,
  });

  await registerDesktopIpc(ipcMain, window, services);
  debugMain('createWindow:ipc-registered');

  ipcMain.handle('desktop:getConnectorsConfig', () => services.getConnectorsConfig());
  ipcMain.handle('desktop:saveConnectorsConfig', (_event, input) => services.setConnectorsConfig(input));
  ipcMain.handle('desktop:listConnectorRuntimes', () => services.listConnectorRuntimes());
  ipcMain.handle('desktop:testConnectorProvider', (_event, kind) => services.testConnectorProvider(kind));

  // Register update IPC handlers
  ipcMain.handle('desktop:getUpdateStatus', () => {
    try {
      return { ...getUpdateStatus(), currentVersion: app.getVersion() };
    } catch (e) {
      return { checking: false, available: false, downloading: false, downloaded: false, progress: 0, error: (e as Error).message, currentVersion: app.getVersion() };
    }
  });
  ipcMain.handle('desktop:checkForUpdates', async () => {
    try {
      await checkForUpdates();
    } catch (e) {
      // Error already handled in checkForUpdates
    }
  });
  ipcMain.handle('desktop:quitAndInstall', () => {
    try {
      quitAndInstall();
    } catch (e) {
      // Ignore
    }
  });

  // Unified timed action daemon: notification reminders and automatic AI tasks share one scheduler.
  const timedActionStore = new TimedActionStore(join(dataRoot, 'timed-actions.sqlite'));
  const timedActionService = new TimedActionService(timedActionStore);
  services.registerTimedActionService(timedActionService);

  // Register channel tools with AI runner (for sending messages to yunzhijia, discord, etc.)
  services.registerChannelTools();

  // Register skill tools with AI runner (for installing/uninstalling skills)
  services.registerSkillTools();

  // Deploy bundled plugins (report-creator, slide-creator) to ~/.xiaok/plugins/
  const deployResult = await deployBundledPlugins();
  debugMain('createWindow:plugins-deployed', deployResult);
  if (deployResult.venvReady) {
    const venvDir = join(app.getPath('home'), '.xiaok', 'runtime', 'python-env');
    process.env.XIAOK_PYTHON_CMD = process.platform === 'win32'
      ? join(venvDir, 'Scripts', 'python.exe')
      : join(venvDir, 'bin', 'python3');
  }

  // Register MCP plugin tools (connects to MCP servers declared in ~/.xiaok/plugins)
  let mcpDispose: (() => void) | undefined;
  const runtimeBridgeClients: Array<{ start(): Promise<void>; stop(): void }> = [];
  let runtimeBridgeStarted = false;
  let runtimeBridgeFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  const stopRuntimeBridge = () => {
    if (runtimeBridgeFallbackTimer) {
      clearTimeout(runtimeBridgeFallbackTimer);
      runtimeBridgeFallbackTimer = null;
    }
    for (const client of runtimeBridgeClients.splice(0)) client.stop();
    runtimeBridgeStarted = false;
  };
  const startRuntimeBridge = () => {
    if (runtimeBridgeStarted) return;
    runtimeBridgeStarted = true;
    if (runtimeBridgeFallbackTimer) {
      clearTimeout(runtimeBridgeFallbackTimer);
      runtimeBridgeFallbackTimer = null;
    }
    void kswarmStartPromise.then(() => {
      const brokerUrl = 'http://127.0.0.1:4318';
      const runtimeBridge = {
        ...createKSwarmRuntimeBridge({
        allowedRoots: [join(app.getPath('home'), '.kswarm', 'handoff-packages')],
        runDesktopTask: (input) => services.runKSwarmHandoffTask(input),
        submitResult: (input) => submitKSwarmRuntimeResultToBroker({
          brokerUrl,
          participantId: input.targetParticipantId || XIAOK_WORKER_SEED_ID,
          projectId: input.projectId,
          taskId: input.taskId,
          runId: input.runId,
          result: input.result,
        }),
        }),
        handleAssignPo: (input: { payload: Record<string, unknown>; targetParticipantId?: string }) => services.runKSwarmAssignPo(input),
        handleReviewSubmission: (input: { payload: Record<string, unknown>; targetParticipantId?: string }) => services.runKSwarmReviewSubmission(input),
        handlePlanApproved: (input: { payload: Record<string, unknown>; targetParticipantId?: string }) => services.runKSwarmPlanApproved(input),
        handleReadinessProbe: (input: { payload: Record<string, unknown>; targetParticipantId?: string }) => services.runKSwarmReadinessProbe(input),
      };
      runtimeBridgeClients.push(
        createKSwarmRuntimeBridgeBrokerClient({
          brokerUrl,
          participantId: XIAOK_PO_SEED_ID,
          alias: 'PO-Agent',
          roles: ['project_owner'],
          capabilities: ['research', 'analysis', 'coding', 'testing', 'design', 'planning', 'reporting', 'slides'],
          bridge: runtimeBridge,
        }),
        createKSwarmRuntimeBridgeBrokerClient({
          brokerUrl,
          participantId: XIAOK_WORKER_SEED_ID,
          alias: 'Worker-Agent',
          roles: ['worker'],
          capabilities: ['research', 'analysis', 'coding', 'testing', 'design', 'planning', 'reporting', 'slides'],
          bridge: runtimeBridge,
        }),
      );
      for (const client of runtimeBridgeClients) {
        client.start().catch((error) => {
          console.warn('[main] Failed to start kswarm runtime bridge client:', (error as Error).message);
        });
      }
    });
  };
  restartRuntimeBridgeService = async () => {
    stopRuntimeBridge();
    startRuntimeBridge();
  };
  runtimeBridgeFallbackTimer = setTimeout(startRuntimeBridge, 10_000);
  services.registerMcpTools().then(({ dispose }) => {
    mcpDispose = dispose;
    startRuntimeBridge();
  }).catch(() => {
    startRuntimeBridge();
  });
  debugMain('createWindow:mcp-registration-started');

  const timedActionScheduler = new TimedActionScheduler(timedActionStore, {
    executors: {
      notify: createNotifyExecutor({ getMainWindow: () => window }),
      agent_task: createAgentTaskExecutor({
        createTask: (input) => services.createTask(input),
      }),
    },
    onRunComplete: (event) => {
      if (event.action.executor.kind !== 'agent_task') return;
      if (window.isDestroyed()) return;
      window.webContents.send('desktop:scheduledTaskDue', {
        taskId: event.action.id,
        runtimeTaskId: event.runtimeTaskId,
        completed: true,
        success: event.status === 'success',
        lastRunAt: event.action.lastDueAt ?? event.finishedAt,
        nextRunAt: event.action.nextDueAt,
        error: event.error,
      });
    },
  });
  timedActionScheduler.start();

  ipcMain.handle('desktop:syncScheduledTasks', (_event, tasks) => {
    // Deprecated compatibility endpoint. Renderer must not replace main state.
    return timedActionService.listScheduledTasks();
  });
  ipcMain.handle('desktop:getScheduledTasks', () => {
    return timedActionService.listScheduledTasks();
  });
  ipcMain.handle('desktop:createScheduledTask', (_event, input) => {
    return timedActionService.createScheduledTask(input);
  });
  ipcMain.handle('desktop:updateScheduledTask', (_event, input) => {
    return timedActionService.updateScheduledTask(input);
  });
  ipcMain.handle('desktop:cancelScheduledTask', (_event, id: string) => {
    return timedActionService.cancelScheduledTask(id);
  });
  ipcMain.handle('desktop:getTimedActions', () => {
    return timedActionService.getActions();
  });
  ipcMain.handle('desktop:getTimedActionRuns', (_event, actionId: string) => {
    return timedActionService.getRuns(actionId);
  });

  app.on('before-quit', () => {
    kswarmService.stop().catch(() => {});
    if (runtimeBridgeFallbackTimer) {
      clearTimeout(runtimeBridgeFallbackTimer);
      runtimeBridgeFallbackTimer = null;
    }
    for (const client of runtimeBridgeClients) client.stop();
    timedActionScheduler.stop();
    timedActionStore.close();
    mcpDispose?.();
  });

  // Reminder IPC handlers
  ipcMain.handle('desktop:createReminder', (_event, input: { content: string; scheduleAt: number; timezone?: string }) => {
    return timedActionService.createReminder(input.content, input.scheduleAt, input.timezone);
  });
  ipcMain.handle('desktop:listReminders', () => timedActionService.listReminders());
  ipcMain.handle('desktop:cancelReminder', (_event, id: string) => timedActionService.cancelReminder(id));
  ipcMain.handle('desktop:getReminderStatus', () => timedActionService.getReminderStatus());

  // Skill debug config IPC handlers
  ipcMain.handle('desktop:getSkillDebugConfig', () => services.getSkillDebugConfig());
  ipcMain.handle('desktop:saveSkillDebugConfig', (_event, input: { enabled: boolean }) => services.saveSkillDebugConfig(input));

  // Setup menubar with K icon
  setupMenuBar(window);
  debugMain('createWindow:menubar-ready');

  // Setup auto-updater (production only)
  if (process.env.NODE_ENV !== 'development' && !process.env.XIAOK_DESKTOP_DEV_SERVER) {
    setupAutoUpdater(window).catch(() => {});
  }
  debugMain('createWindow:before-load');

  window.on('closed', () => {
    destroyMenuBar();
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
  attachCloseToMinimize(window, process.platform, () => !isQuitting);
  attachWindowRepaintHandlers(window);

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('file://')) {
      void shell.openPath(decodeURIComponent(url.replace('file://', '')));
    } else {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://')) return;
    if (!isAllowedNavigationUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  const devServer = process.env['XIAOK_DESKTOP_DEV_SERVER'];
  if (devServer) {
    await window.loadURL(devServer);
  } else {
    await window.loadFile(join(__dirname, '../../../renderer/index.html'));
  }
  debugMain('createWindow:loaded');
  return window;
}

function restoreOrCreateWindow(): void {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows()[0];
  if (window) {
    restoreExistingWindow(window);
    return;
  }
  void createWindow();
}

if (!singleInstanceLock) {
  debugMain('single-instance-lock:failed');
  app.quit();
} else {
  app.whenReady().then(async () => {
    debugMain('app:whenReady');
    if (process.platform === 'darwin') {
      app.setName('xiaok');
      // Use .icns for proper macOS dock icon (auto-sizes + rounds corners)
      const icnsPath = join(__dirname, '..', 'build', 'icon.icns');
      const pngPath = join(__dirname, '..', 'build', 'icon.png');
      const { existsSync } = await import('node:fs');
      const iconPath = existsSync(icnsPath) ? icnsPath : pngPath;
      if (existsSync(iconPath) && app.dock) {
        app.dock.setIcon(nativeImage.createFromPath(iconPath));
      }
    }
    void createWindow();
  }).catch((error) => {
    console.error('[main] whenReady failed:', error);
  });
  app.on('second-instance', () => {
    debugMain('app:second-instance');
    restoreOrCreateWindow();
  });
  app.on('before-quit', () => {
    isQuitting = true;
    destroyMenuBar();
    debugMain('app:before-quit');
  });
  app.on('window-all-closed', () => {
    debugMain('app:window-all-closed', { platform: process.platform });
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
  app.on('activate', () => {
    debugMain('app:activate');
    restoreOrCreateWindow();
  });
}
