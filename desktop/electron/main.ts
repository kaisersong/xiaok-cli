import { app, BrowserWindow, ipcMain, shell, nativeImage } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

// Suppress EPIPE errors from console.log after stdout pipe closes
process.on('uncaughtException', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return;
  console.error('[main] uncaughtException:', err);
});
const singleInstanceLock = app.requestSingleInstanceLock();

async function createWindow(): Promise<BrowserWindow> {
  const preloadPath = join(__dirname, 'preload.cjs');
  const window = new BrowserWindow(buildBrowserWindowOptions(preloadPath, {
    platform: process.platform,
    iconPath: resolveDesktopWindowIconPath(__dirname, process.platform),
  }));
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
  reminderScheduler.setOnDelivery((event) => {
    // Broadcast to renderer
    window.webContents.send('desktop:reminder', event);
  });
  reminderScheduler.start();

  // Register reminder tools with AI runner
  services.registerReminderScheduler(reminderScheduler);

  // Register channel tools with AI runner (for sending messages to yunzhijia, discord, etc.)
  services.registerChannelTools();

  // Register skill tools with AI runner (for installing/uninstalling skills)
  services.registerSkillTools();

  // Deploy bundled plugins (report-creator, slide-creator) to ~/.xiaok/plugins/
  const deployResult = await deployBundledPlugins();
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

  // Scheduled task auto-execution scheduler
  const taskScheduler = new ScheduledTaskScheduler();
  taskScheduler.setMainWindow(window);
  taskScheduler.start();
  ipcMain.handle('desktop:syncScheduledTasks', (_event, tasks) => {
    taskScheduler.syncTasks(tasks);
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

  // Setup auto-updater (production only)
  if (process.env.NODE_ENV !== 'development' && !process.env.XIAOK_DESKTOP_DEV_SERVER) {
    setupAutoUpdater(window).catch(() => {});
  }

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
  app.quit();
} else {
  app.whenReady().then(async () => {
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
  });
  app.on('second-instance', () => {
    restoreOrCreateWindow();
  });
  app.on('before-quit', () => {
    isQuitting = true;
    destroyMenuBar();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
  app.on('activate', () => {
    restoreOrCreateWindow();
  });
}
