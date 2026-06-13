import { app, BrowserWindow, ipcMain, session, shell, nativeImage, Menu, powerMonitor } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFileSync, mkdirSync } from 'node:fs';
import { createDesktopServices, resumeOneScriptWorkflow } from './desktop-services.js';
import { registerDesktopIpc } from './ipc.js';
import {
  buildBrowserWindowOptions,
  isAllowedNavigationUrl,
  isAllowedShellExternalUrl,
  resolveLocalFileOpenPath,
} from './security.js';
import {
  findIntentBrokerProtocolUrl,
  registerIntentBrokerProtocolClient,
} from './intent-broker-protocol.js';
import { resolveDesktopDockIconPath, resolveDesktopWindowIconPath } from './window-icon.js';
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
import { ThreadMetaStore } from './thread-meta-store.js';
import { TimedActionService } from './timed-action-service.js';
import { TimedActionScheduler } from './timed-action-scheduler.js';
import { createDesktopTimedActionExecutors } from './timed-action-executors.js';
import { createDesktopLoopRuntime } from './loop-executor.js';
import { attachDesktopContextMenu } from './context-menu.js';
import {
  createKSwarmRuntimeBridge,
  createKSwarmRuntimeBridgeBrokerClient,
  submitKSwarmRuntimeResultToBroker,
  submitKSwarmWorkflowNodeResultToBroker,
} from './kswarm-runtime-bridge.js';
import { XIAOK_DESKTOP_HOST_PARTICIPANT_ID, XIAOK_WORKER_SEED_ID } from '../shared/kswarm-seed-contract.js';
import { KSwarmStreamBridge } from './kswarm-stream-bridge.js';
import { registerKSwarmProxy } from './kswarm-ipc-proxy.js';
import { configureDefaultRemoteDebugging } from './remote-debugging.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

function debugMain(message: string, extra?: unknown): void {
  const suffix = extra === undefined ? '' : ` ${JSON.stringify(extra)}`;
  const line = `[main-debug] ${message}${suffix}`;
  try {
    const logDir = join(app.getPath('userData'), 'logs');
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
const remoteDebuggingConfig = configureDefaultRemoteDebugging(app.commandLine, process.argv);
debugMain('remote-debugging:configured', remoteDebuggingConfig);
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
  ipcMain.handle('desktop:kswarm:resumeWorkflowRun', (_event, input) =>
    resumeOneScriptWorkflow(kswarmService, input?.projectId, input?.workflowRunId));
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

  const kswarmStreamBridge = new KSwarmStreamBridge('ws://127.0.0.1:4400/ws');
  kswarmStreamBridge.start();
  registerKSwarmProxy(ipcMain, kswarmStreamBridge, kswarmService);

  const { getConfigDir } = await import('../../src/utils/config.js');
  const dataRoot = getConfigDir('desktop');
  const services = createDesktopServices({
    dataRoot,
    kswarmService,
  });

  await registerDesktopIpc(ipcMain, window, services);
  debugMain('createWindow:ipc-registered');

  try {
    await services.recoverStaleTasks();
  } catch (err) {
    console.error('[main] recoverStaleTasks failed (startup continues):', err);
  }

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
    isQuitting = true;
    try {
      quitAndInstall();
    } catch (e) {
      isQuitting = false;
      throw e;
    }
  });

  // Unified timed action daemon: notification reminders and automatic AI tasks share one scheduler.
  const timedActionStore = new TimedActionStore(join(dataRoot, 'timed-actions.sqlite'));
  const timedActionService = new TimedActionService(timedActionStore);
  services.registerTimedActionService(timedActionService);
  const loopRuntime = createDesktopLoopRuntime({ dataRoot });

  // Register channel tools with AI runner (for sending messages to yunzhijia, discord, etc.)
  services.registerChannelTools();

  // Register skill tools with AI runner (for installing/uninstalling skills)
  services.registerSkillTools();

  // Deploy bundled plugins (report-creator, slide-creator) to ~/.xiaok/plugins/
  const deployResult = await deployBundledPlugins();
  debugMain('createWindow:plugins-deployed', deployResult);
  if (deployResult.venvReady) {
    const venvDir = getConfigDir(join('runtime', 'python-env'));
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
    void kswarmStartPromise.then(async () => {
      const { loadConfig } = await import('../../src/utils/config.js');
      const cfg = await loadConfig();
      const rawConcurrency = cfg.kswarm?.maxConcurrentTasks ?? 3;
      const maxConcurrentTasks = Math.max(1, Math.min(10, rawConcurrency));
      const brokerUrl = 'http://127.0.0.1:4318';
      const kswarmHandoffRoots = [join(app.getPath('home'), '.kswarm', 'handoff-packages')];
      const runtimeBridge = {
        ...createKSwarmRuntimeBridge({
        allowedRoots: kswarmHandoffRoots,
        runDesktopTask: (input) => services.runKSwarmHandoffTask(input),
        runWorkflowNode: (input) => services.runKSwarmWorkflowNode(input),
        submitResult: (input) => submitKSwarmRuntimeResultToBroker({
          brokerUrl,
          participantId: XIAOK_DESKTOP_HOST_PARTICIPANT_ID,
          logicalParticipantId: input.targetParticipantId || XIAOK_WORKER_SEED_ID,
          projectId: input.projectId,
          taskId: input.taskId,
          runId: input.runId,
          result: input.result,
        }),
        submitWorkflowNodeResult: (input) => submitKSwarmWorkflowNodeResultToBroker({
          brokerUrl,
          participantId: XIAOK_DESKTOP_HOST_PARTICIPANT_ID,
          logicalParticipantId: input.targetParticipantId || XIAOK_WORKER_SEED_ID,
          handoff: input.handoff,
          output: input.output,
          reviewDecision: input.reviewDecision,
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
          participantId: XIAOK_DESKTOP_HOST_PARTICIPANT_ID,
          participantKind: 'service',
          alias: 'Xiaok Desktop',
          roles: ['desktop_runtime_host'],
          capabilities: ['research', 'analysis', 'coding', 'testing', 'design', 'planning', 'reporting', 'slides'],
          allowedRoots: kswarmHandoffRoots,
          bridge: runtimeBridge,
          maxConcurrentTasks,
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

  let powerSuspendedAtMs = 0;
  const postRuntimePower = async (path: '/runtime/suspend' | '/runtime/resume', body?: unknown) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      await fetch(`http://127.0.0.1:4400${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      console.warn(`[main] kswarm ${path} call failed:`, (error as Error).message);
    } finally {
      clearTimeout(timer);
    }
  };
  powerMonitor.on('suspend', () => {
    powerSuspendedAtMs = Date.now();
    debugMain('powerMonitor:suspend');
    void postRuntimePower('/runtime/suspend');
  });
  powerMonitor.on('resume', () => {
    const sleptMs = powerSuspendedAtMs ? Date.now() - powerSuspendedAtMs : 0;
    powerSuspendedAtMs = 0;
    debugMain('powerMonitor:resume');
    void restartRuntimeBridgeService();
    void postRuntimePower('/runtime/resume', { sleptMs });
  });

  runtimeBridgeFallbackTimer = setTimeout(startRuntimeBridge, 10_000);
  services.registerMcpTools().then(({ dispose }) => {
    mcpDispose = dispose;
    startRuntimeBridge();
  }).catch(() => {
    startRuntimeBridge();
  });
  debugMain('createWindow:mcp-registration-started');

  const timedActionScheduler = new TimedActionScheduler(timedActionStore, {
    executors: createDesktopTimedActionExecutors({
      getMainWindow: () => window,
      loopRuntime,
      createTask: (input) => services.createTask(input),
    }),
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
  ipcMain.handle('desktop:timedAction:approveAuto', (_event, actionId: string) => {
    return timedActionService.approveAuto(actionId) ?? null;
  });
  ipcMain.handle('desktop:timedAction:revokeAuto', (_event, actionId: string) => {
    return timedActionService.revokeAuto(actionId) ?? null;
  });

  // Thread meta (GTD / pinned) — persistent via SQLite in main process
  const threadMetaStore = new ThreadMetaStore(join(dataRoot, 'thread-meta.sqlite'));
  const broadcastThreadMeta = () => {
    if (window.isDestroyed()) return;
    window.webContents.send('desktop:threadMetaChanged', threadMetaStore.getAll());
  };
  ipcMain.handle('desktop:getThreadLabels', () => {
    return threadMetaStore.getAll();
  });
  ipcMain.handle('desktop:setThreadLabel', (_event, threadId: string, label: string) => {
    const result = threadMetaStore.addThreadToLabel(threadId, label as any);
    if (result.ok) broadcastThreadMeta();
    return result;
  });
  ipcMain.handle('desktop:unsetThreadLabel', (_event, threadId: string, label: string) => {
    const result = threadMetaStore.removeThreadFromLabel(threadId, label as any);
    if (result.ok) broadcastThreadMeta();
    return result;
  });
  ipcMain.handle('desktop:moveThreadLabel', (_event, threadId: string, from: string, to: string) => {
    const result = threadMetaStore.moveThread(threadId, from as any, to as any);
    if (result.ok) broadcastThreadMeta();
    return result;
  });
  ipcMain.handle('desktop:getAppFlag', (_event, key: string) => {
    return threadMetaStore.getFlag(key as any);
  });
  ipcMain.handle('desktop:setAppFlag', (_event, key: string, value: string) => {
    const result = threadMetaStore.setFlag(key as any, value);
    if (result.ok) broadcastThreadMeta();
    return result;
  });
  ipcMain.handle('desktop:migrateLegacyThreadMeta', (_event, data: any) => {
    const result = threadMetaStore.bulkImport(data);
    if (result.ok) broadcastThreadMeta();
    return result;
  });

  app.on('before-quit', () => {
    kswarmService.stop().catch((err) => {
      debugMain('kswarmService.stop failed', err instanceof Error ? err.message : String(err));
    });
    kswarmStreamBridge.dispose();
    if (runtimeBridgeFallbackTimer) {
      clearTimeout(runtimeBridgeFallbackTimer);
      runtimeBridgeFallbackTimer = null;
    }
    for (const client of runtimeBridgeClients) client.stop();
    timedActionScheduler.stop();
    loopRuntime.close();
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

  // KSwarm config IPC handlers
  ipcMain.handle('desktop:getKswarmConfig', () => services.getKswarmConfig());
  ipcMain.handle('desktop:saveKswarmConfig', (_event, input: { maxConcurrentTasks: number }) => services.saveKswarmConfig(input));

  // Setup menubar with K icon
  setupMenuBar(window);
  debugMain('createWindow:menubar-ready');

  // Setup auto-updater (production only)
  if (process.env.NODE_ENV !== 'development' && !process.env.XIAOK_DESKTOP_DEV_SERVER) {
    setupAutoUpdater(window).catch((err) => {
      debugMain('setupAutoUpdater failed', err instanceof Error ? err.message : String(err));
    });
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
    const filePath = resolveLocalFileOpenPath(url);
    if (filePath) {
      void shell.openPath(filePath);
    } else if (isAllowedShellExternalUrl(url)) {
      void shell.openExternal(url);
    } else {
      debugMain('external-open:blocked', { url });
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://')) return;
    if (!isAllowedNavigationUrl(url)) {
      event.preventDefault();
      if (isAllowedShellExternalUrl(url)) {
        void shell.openExternal(url);
      } else {
        debugMain('navigation-external-open:blocked', { url });
      }
    }
  });

  const devServer = process.env['XIAOK_DESKTOP_DEV_SERVER'];

  // CSP — Report-Only mode to observe violations before enforcing
  const isDev = !!devServer;
  const cspDirectives = [
    "default-src 'self'",
    `script-src 'self'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:* https:${isDev ? ' ws://localhost:*' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy-Report-Only': [cspDirectives],
        },
      });
    } else {
      callback({});
    }
  });

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
    const protocolRegistered = registerIntentBrokerProtocolClient(app, {
      platform: process.platform,
      execPath: process.execPath,
    });
    debugMain('intent-broker-protocol:registration', {
      platform: process.platform,
      registered: protocolRegistered,
    });
    const launchProtocolUrl = findIntentBrokerProtocolUrl(process.argv);
    if (launchProtocolUrl) {
      debugMain('intent-broker-protocol:launch', { url: launchProtocolUrl });
    }
    if (process.platform === 'darwin') {
      app.setName('xiaok');
      const iconPath = resolveDesktopDockIconPath(__dirname, process.resourcesPath, process.platform);
      if (iconPath && app.dock) {
        app.dock.setIcon(nativeImage.createFromPath(iconPath));
      }
    }
    void createWindow();
  }).catch((error) => {
    console.error('[main] whenReady failed:', error);
  });
  app.on('second-instance', (_event, commandLine) => {
    const protocolUrl = findIntentBrokerProtocolUrl(commandLine);
    debugMain('app:second-instance', protocolUrl ? { protocolUrl } : undefined);
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
