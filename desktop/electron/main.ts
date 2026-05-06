import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDesktopServices } from './desktop-services.js';
import { registerDesktopIpc } from './ipc.js';
import { buildBrowserWindowOptions, isAllowedNavigationUrl } from './security.js';
import { attachMacCloseToMinimize, attachWindowRepaintHandlers, restoreExistingWindow } from './window-lifecycle.js';
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
  const window = new BrowserWindow(buildBrowserWindowOptions(preloadPath));
  mainWindow = window;
  const services = createDesktopServices({
    dataRoot: join(app.getPath('home'), '.xiaok', 'desktop'),
  });
  registerDesktopIpc(ipcMain, window, services);

  // Register update IPC handlers
  ipcMain.handle('desktop:getUpdateStatus', () => {
    try {
      return getUpdateStatus();
    } catch (e) {
      return { checking: false, available: false, downloading: false, downloaded: false, progress: 0, error: (e as Error).message };
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
  attachMacCloseToMinimize(window, process.platform, () => !isQuitting);
  attachWindowRepaintHandlers(window);

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
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
  app.whenReady().then(() => {
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
