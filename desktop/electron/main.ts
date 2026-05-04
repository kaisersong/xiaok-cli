import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDesktopServices } from './desktop-services.js';
import { registerDesktopIpc } from './ipc.js';
import { buildBrowserWindowOptions, isAllowedNavigationUrl } from './security.js';
import { attachMacCloseToMinimize, attachWindowRepaintHandlers, restoreExistingWindow } from './window-lifecycle.js';
import { setupMenuBar, destroyMenuBar } from './menubar.js';

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

  // Setup menubar with K icon
  setupMenuBar(window);

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
