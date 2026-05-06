import type { BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface UpdateStatus {
  checking: boolean;
  available: boolean;
  downloading: boolean;
  downloaded: boolean;
  progress: number; // 0-100
  version?: string;
  error?: string;
}

let updateStatus: UpdateStatus = {
  checking: false,
  available: false,
  downloading: false,
  downloaded: false,
  progress: 0,
};

let mainWindow: BrowserWindow | null = null;
let isDevMode = false;
let autoUpdater: any = null;

function isDevelopmentMode(): boolean {
  // Check multiple indicators for development mode
  if (process.env.NODE_ENV === 'development') return true;
  if (process.env.XIAOK_DESKTOP_DEV_SERVER) return true;
  // Check if app-update.yml exists in resources
  if (process.resourcesPath) {
    const updateYml = join(process.resourcesPath, 'app-update.yml');
    if (!existsSync(updateYml)) return true;
  } else {
    // No resourcesPath means development mode
    return true;
  }
  return false;
}

async function loadAutoUpdater(): Promise<void> {
  if (autoUpdater) return;
  try {
    const pkg = await import('electron-updater');
    autoUpdater = pkg.autoUpdater;
  } catch (e) {
    updateStatus.error = `无法加载更新器: ${(e as Error).message}`;
  }
}

export async function setupAutoUpdater(window: BrowserWindow): Promise<void> {
  mainWindow = window;
  isDevMode = isDevelopmentMode();

  // Skip in development mode
  if (isDevMode) {
    updateStatus.error = '开发模式下无法检查更新';
    return;
  }

  // Load autoUpdater dynamically
  await loadAutoUpdater();
  if (!autoUpdater) return;

  // Configure autoUpdater
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  // Check for updates immediately on startup
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});

  // Also check periodically (every 4 hours)
  setInterval(() => {
    if (autoUpdater) {
      autoUpdater.checkForUpdates().catch(() => {});
    }
  }, 4 * 60 * 60 * 1000);

  // Event handlers
  autoUpdater.on('checking-for-update', () => {
    updateStatus = { ...updateStatus, checking: true, error: undefined };
    sendUpdateStatus();
  });

  autoUpdater.on('update-available', (info: { version: string }) => {
    updateStatus = {
      ...updateStatus,
      checking: false,
      available: true,
      version: info.version,
    };
    sendUpdateStatus();
  });

  autoUpdater.on('update-not-available', () => {
    updateStatus = {
      ...updateStatus,
      checking: false,
      available: false,
    };
    sendUpdateStatus();
  });

  autoUpdater.on('download-progress', (progress: { percent: number }) => {
    updateStatus = {
      ...updateStatus,
      downloading: true,
      progress: Math.round(progress.percent),
    };
    sendUpdateStatus();
  });

  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    updateStatus = {
      ...updateStatus,
      downloading: false,
      downloaded: true,
      version: info.version,
      progress: 100,
    };
    sendUpdateStatus();
  });

  autoUpdater.on('error', (error: Error) => {
    updateStatus = {
      ...updateStatus,
      checking: false,
      downloading: false,
      error: error.message,
    };
    sendUpdateStatus();
  });
}

function sendUpdateStatus(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('desktop:updateStatus', updateStatus);
  }
}

export function getUpdateStatus(): UpdateStatus {
  // In development mode, return a special status without touching autoUpdater
  if (isDevMode || isDevelopmentMode()) {
    return {
      checking: false,
      available: false,
      downloading: false,
      downloaded: false,
      progress: 0,
      error: '开发模式下无法检查更新',
    };
  }
  return updateStatus;
}

export async function checkForUpdates(): Promise<void> {
  // Skip in development mode - app-update.yml doesn't exist
  if (isDevMode || isDevelopmentMode()) {
    updateStatus = {
      ...updateStatus,
      checking: false,
      error: '开发模式下无法检查更新',
    };
    sendUpdateStatus();
    return;
  }

  await loadAutoUpdater();
  if (!autoUpdater) return;

  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    updateStatus.error = (e as Error).message;
    sendUpdateStatus();
  }
}

export function quitAndInstall(): void {
  if (autoUpdater) {
    autoUpdater.quitAndInstall();
  }
}