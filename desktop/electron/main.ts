import { app, BrowserWindow, ipcMain, shell, nativeImage } from 'electron';
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
import { JsonReminderStore } from './reminder-store.js';
import { ReminderScheduler } from './reminder-scheduler.js';
import { createKSwarmService } from './kswarm-service.js';
import { ScheduledTaskScheduler } from './scheduled-task-scheduler.js';
import { deployBundledPlugins } from './deploy-bundled-plugins.js';

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
  mainWindow = window;
  // KSwarm service — manages kswarm server as a child process
  const kswarmService = createKSwarmService();
  kswarmService.start().catch((err) => {
    console.error('[main] Failed to start kswarm service:', err);
  });
  ipcMain.handle('desktop:kswarm:getStatus', () => kswarmService.getStatus());
  ipcMain.handle('desktop:kswarm:start', () => kswarmService.start());
  ipcMain.handle('desktop:kswarm:stop', () => kswarmService.stop());
  ipcMain.handle('desktop:kswarm:restart', () => kswarmService.restart());
  kswarmService.onStatusChange((status) => {
    window.webContents.send('desktop:kswarm:statusChange', status);
  });

  const services = createDesktopServices({
    dataRoot: join(app.getPath('home'), '.xiaok', 'desktop'),
    kswarmService,
  });
  await registerDesktopIpc(ipcMain, window, services);
  debugMain('createWindow:ipc-registered');

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

  // Initialize reminder scheduler
  const reminderDataDir = join(app.getPath('home'), '.xiaok', 'desktop');
  const reminderStore = new JsonReminderStore(reminderDataDir);
  const reminderScheduler = new ReminderScheduler(reminderStore);
  reminderScheduler.setMainWindow(window);
  reminderScheduler.start();

  // Register reminder tools with AI runner
  services.registerReminderScheduler(reminderScheduler);

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
  services.registerMcpTools().then(({ dispose }) => {
    mcpDispose = dispose;
  }).catch(() => {});
  debugMain('createWindow:mcp-registration-started');

  // Scheduled task auto-execution scheduler
  const taskScheduler = new ScheduledTaskScheduler({
    dataDir: join(app.getPath('home'), '.xiaok', 'desktop'),
  });
  taskScheduler.setMainWindow(window);
  taskScheduler.setExecutor(async (prompt: string) => {
    return services.createTask({ prompt, materials: [] });
  });
  taskScheduler.start();
  ipcMain.handle('desktop:syncScheduledTasks', (_event, tasks) => {
    taskScheduler.syncTasks(tasks);
  });
  ipcMain.handle('desktop:getScheduledTasks', () => {
    return taskScheduler.getTasks();
  });

  app.on('before-quit', () => {
    kswarmService.stop().catch(() => {});
    taskScheduler.stop();
    mcpDispose?.();
  });

  // Reminder IPC handlers
  ipcMain.handle('desktop:createReminder', (_event, input: { content: string; scheduleAt: number; timezone?: string }) => {
    return reminderScheduler.createReminder(input.content, input.scheduleAt, input.timezone);
  });
  ipcMain.handle('desktop:listReminders', () => reminderScheduler.listReminders());
  ipcMain.handle('desktop:cancelReminder', (_event, id: string) => reminderScheduler.cancelReminder(id));
  ipcMain.handle('desktop:getReminderStatus', () => reminderScheduler.getStatus());

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
