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
let autoUpdaterEventsRegistered = false;

export function resolveAutoUpdaterExport(module: unknown): any | null {
  if (!module || typeof module !== 'object') return null;
  const candidate = (module as { autoUpdater?: unknown }).autoUpdater
    ?? (module as { default?: { autoUpdater?: unknown } }).default?.autoUpdater;
  if (!candidate || typeof candidate !== 'object') return null;
  if (typeof (candidate as { checkForUpdates?: unknown }).checkForUpdates !== 'function') return null;
  return candidate;
}

function setUpdateStatus(patch: Partial<UpdateStatus>): void {
  updateStatus = { ...updateStatus, ...patch };
  sendUpdateStatus();
}

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

async function loadAutoUpdater(): Promise<boolean> {
  if (autoUpdater) return true;
  try {
    const pkg = await import('electron-updater');
    autoUpdater = resolveAutoUpdaterExport(pkg);
    if (!autoUpdater) {
      setUpdateStatus({ error: '无法加载更新器: electron-updater 未导出 autoUpdater' });
      return false;
    }
    return true;
  } catch (e) {
    setUpdateStatus({ error: `无法加载更新器: ${(e as Error).message}` });
    return false;
  }
}

function registerAutoUpdaterEvents(): void {
  if (!autoUpdater || autoUpdaterEventsRegistered) return;
  autoUpdaterEventsRegistered = true;

  autoUpdater.on('checking-for-update', () => {
    setUpdateStatus({ checking: true, error: undefined });
  });

  autoUpdater.on('update-available', (info: { version: string }) => {
    setUpdateStatus({
      checking: false,
      available: true,
      version: info.version,
    });
  });

  autoUpdater.on('update-not-available', () => {
    setUpdateStatus({
      checking: false,
      available: false,
    });
  });

  autoUpdater.on('download-progress', (progress: { percent: number }) => {
    setUpdateStatus({
      downloading: true,
      progress: Math.round(progress.percent),
    });
  });

  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    setUpdateStatus({
      downloading: false,
      downloaded: true,
      version: info.version,
      progress: 100,
    });
  });

  autoUpdater.on('error', (error: Error) => {
    setUpdateStatus({
      checking: false,
      downloading: false,
      error: error.message,
    });
  });
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
  if (!(await loadAutoUpdater())) return;

  // Configure autoUpdater
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  registerAutoUpdaterEvents();

  // Check for updates immediately on startup
  autoUpdater.checkForUpdatesAndNotify().catch((error: Error) => {
    setUpdateStatus({
      checking: false,
      downloading: false,
      error: error.message,
    });
  });

  // Also check periodically (every 4 hours)
  setInterval(() => {
    if (autoUpdater) {
      autoUpdater.checkForUpdates().catch((error: Error) => {
        setUpdateStatus({
          checking: false,
          downloading: false,
          error: error.message,
        });
      });
    }
  }, 4 * 60 * 60 * 1000);
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
    setUpdateStatus({
      checking: false,
      error: '开发模式下无法检查更新',
    });
    return;
  }

  setUpdateStatus({ checking: true, error: undefined });
  if (!(await loadAutoUpdater())) {
    setUpdateStatus({ checking: false });
    return;
  }
  registerAutoUpdaterEvents();

  try {
    const result = await autoUpdater.checkForUpdates();
    if (result === null) {
      setUpdateStatus({
        checking: false,
        error: '更新器未激活',
      });
    }
  } catch (e) {
    setUpdateStatus({
      checking: false,
      downloading: false,
      error: (e as Error).message,
    });
  }
}

export function quitAndInstall(): void {
  if (autoUpdater) {
    autoUpdater.quitAndInstall();
  }
}
