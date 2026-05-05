import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDesktopServices } from './desktop-services.js';
import { registerDesktopIpc } from './ipc.js';
import { buildBrowserWindowOptions, isAllowedNavigationUrl } from './security.js';
import { attachMacCloseToMinimize, attachWindowRepaintHandlers, restoreExistingWindow } from './window-lifecycle.js';
import { setupMenuBar, destroyMenuBar } from './menubar.js';
import { setupAutoUpdater, checkForUpdates, quitAndInstall, getUpdateStatus } from './updater.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
let mainWindow = null;
let isQuitting = false;
const singleInstanceLock = app.requestSingleInstanceLock();
async function createWindow() {
    const preloadPath = join(__dirname, 'preload.cjs');
    const window = new BrowserWindow(buildBrowserWindowOptions(preloadPath));
    mainWindow = window;
    const services = createDesktopServices({
        dataRoot: join(app.getPath('home'), '.xiaok', 'desktop'),
    });
    registerDesktopIpc(ipcMain, window, services);
    // Register update IPC handlers
    ipcMain.handle('desktop:getUpdateStatus', () => getUpdateStatus());
    ipcMain.handle('desktop:checkForUpdates', async () => { await checkForUpdates(); });
    ipcMain.handle('desktop:quitAndInstall', () => quitAndInstall());
    // Setup menubar with K icon
    setupMenuBar(window);
    // Setup auto-updater (production only)
    if (process.env.NODE_ENV !== 'development' && !process.env.XIAOK_DESKTOP_DEV_SERVER) {
        setupAutoUpdater(window);
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
    }
    else {
        await window.loadFile(join(__dirname, '../../../renderer/index.html'));
    }
    return window;
}
function restoreOrCreateWindow() {
    const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows()[0];
    if (window) {
        restoreExistingWindow(window);
        return;
    }
    void createWindow();
}
if (!singleInstanceLock) {
    app.quit();
}
else {
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
