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

const __dirname = dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
const singleInstanceLock = app.requestSingleInstanceLock();

async function createWindow(): Promise<BrowserWindow> {
  const preloadPath = join(__dirname, 'preload.cjs');
  const window = new BrowserWindow(buildBrowserWindowOptions(preloadPath, {
    platform: process.platform,
    iconPath: resolveDesktopWindowIconPath(__dirname, process.platform),
  }));
  removeWindowsWindowMenu(window, process.platform);
  mainWindow = window;
  const services = createDesktopServices({
    dataRoot: join(app.getPath('home'), '.xiaok', 'desktop'),
  });
  registerDesktopIpc(ipcMain, window, services);

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

  // Register MCP plugin tools (connects to MCP servers declared in ~/.xiaok/plugins)
  let mcpDispose: (() => void) | undefined;
  services.registerMcpTools().then(({ dispose }) => {
    mcpDispose = dispose;
  }).catch(() => {});

  app.on('before-quit', () => {
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
    // Set app name for macOS dock (icon requires packaged .app bundle)
    if (process.platform === 'darwin') {
      app.setName('xiaok');
      const { existsSync } = await import('node:fs');
      const iconPath = join(__dirname, '..', 'build', 'icon.png');
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
