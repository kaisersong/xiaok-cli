// electron-updater is a CommonJS module, use default import
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import type { BrowserWindow } from 'electron';

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

export function setupAutoUpdater(window: BrowserWindow): void {
  mainWindow = window;

  // Configure autoUpdater
  autoUpdater.autoDownload = true; // Auto download when update available
  autoUpdater.autoInstallOnAppQuit = true; // Auto install on quit

  // Check for updates immediately on startup (production only)
  if (process.env.NODE_ENV !== 'development') {
    autoUpdater.checkForUpdates().catch(() => {
      // Silently fail - no internet or no updates
    });
  }

  // Also check periodically (every 4 hours)
  setInterval(() => {
    if (process.env.NODE_ENV !== 'development') {
      autoUpdater.checkForUpdates().catch(() => {});
    }
  }, 4 * 60 * 60 * 1000);

  // Event handlers
  autoUpdater.on('checking-for-update', () => {
    updateStatus = { ...updateStatus, checking: true, error: undefined };
    sendUpdateStatus();
  });

  autoUpdater.on('update-available', (info) => {
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

  autoUpdater.on('download-progress', (progress) => {
    updateStatus = {
      ...updateStatus,
      downloading: true,
      progress: Math.round(progress.percent),
    };
    sendUpdateStatus();
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateStatus = {
      ...updateStatus,
      downloading: false,
      downloaded: true,
      version: info.version,
      progress: 100,
    };
    sendUpdateStatus();
  });

  autoUpdater.on('error', (error) => {
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
  return updateStatus;
}

export async function checkForUpdates(): Promise<void> {
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    updateStatus.error = (e as Error).message;
    sendUpdateStatus();
  }
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall();
}