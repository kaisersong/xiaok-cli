import type { BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { UpdaterHandoffStateMachine } from './updater-handoff.js';

export interface UpdateStatus {
  checking: boolean;
  available: boolean;
  downloading: boolean;
  downloaded: boolean;
  installing?: boolean;
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
const STARTUP_UPDATE_RETRY_DELAY_MS = 60_000;
let handoff: UpdaterHandoffStateMachine | null = null;
let observationTimer: ReturnType<typeof setTimeout> | undefined;
let wrapperInProgress = false;
let syncWrapperError: Error | undefined;
let logUpdater: (event: string, diagnostic?: string) => void = () => {};

function attemptLocked(): boolean {
  return Boolean(handoff?.hasPendingIntent || handoff?.snapshot().kind === 'handed_off');
}

function clearObservation(): void {
  if (observationTimer !== undefined) clearTimeout(observationTimer);
  observationTimer = undefined;
}

function reportUpdaterError(error: unknown): void {
  const message = toError(error).message;
  logUpdater('error', message.replace(/https?:\/\/[^\s]+/gi, '[URL omitted]'));
  if (handoff?.snapshot().kind === 'handed_off') return;
  if (wrapperInProgress) syncWrapperError = toError(error);
  else handoff?.observeAsyncUpdaterError(error);
  clearObservation();
  setUpdateStatus({ checking: false, downloading: false, installing: false, error: message }, true);
}

/** Shared by the IPC owner and production-wiring tests; no renderer timer. */
export function createUpdaterHandoff(platform: NodeJS.Platform = process.platform): UpdaterHandoffStateMachine {
  if (handoff) return handoff;
  handoff = new UpdaterHandoffStateMachine({
    platformClass: platform === 'darwin' ? 'mac' : 'base',
    preflight: () => {
      if (updateStatus.error) throw new Error(updateStatus.error);
      if (!updateStatus.downloaded || !autoUpdater || typeof autoUpdater.quitAndInstall !== 'function') {
        const error = new Error('update_install_not_ready');
        reportUpdaterError(error);
        throw error;
      }
    },
    invokeWrapper: () => {
      syncWrapperError = undefined;
      wrapperInProgress = true;
      setUpdateStatus({ installing: true }, true);
      logUpdater('install-wrapper-entered');
      try {
        if (!callAutoUpdaterQuitAndInstall(autoUpdater)) throw new Error('update_install_not_ready');
      } catch (error) {
        reportUpdaterError(error);
        throw error;
      } finally {
        wrapperInProgress = false;
      }
      if (!syncWrapperError && handoff?.hasPendingIntent) {
        observationTimer = setTimeout(() => {
          observationTimer = undefined;
          if (handoff?.hasPendingIntent) reportUpdaterError(new Error('update_install_handoff_unconfirmed'));
        }, 30_000);
        observationTimer.unref?.();
      }
      return { syncError: syncWrapperError };
    },
  });
  return handoff;
}

/** Called only after the real before-quit transition, never by the install IPC. */
export function completeUpdaterHandoff(): void {
  clearObservation();
  logUpdater('before-quit');
}

interface StartupUpdateCheckOptions {
  retryDelayMs?: number;
  onError: (error: Error) => void;
  setTimer?: (callback: () => void | Promise<void>, delayMs: number) => unknown;
  shouldCheck?: () => boolean;
}

interface StartupAutoUpdater {
  checkForUpdatesAndNotify: () => Promise<unknown> | unknown;
}

export function resolveAutoUpdaterExport(module: unknown): any | null {
  if (!module || typeof module !== 'object') return null;
  const candidate = (module as { autoUpdater?: unknown }).autoUpdater
    ?? (module as { default?: { autoUpdater?: unknown } }).default?.autoUpdater;
  if (!candidate || typeof candidate !== 'object') return null;
  if (typeof (candidate as { checkForUpdates?: unknown }).checkForUpdates !== 'function') return null;
  return candidate;
}

function setUpdateStatus(patch: Partial<UpdateStatus>, installTransition = false): void {
  if (!installTransition && attemptLocked()) return;
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

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function runStartupUpdateCheck(
  updater: StartupAutoUpdater,
  options: StartupUpdateCheckOptions,
): Promise<void> {
  const retryDelayMs = options.retryDelayMs ?? STARTUP_UPDATE_RETRY_DELAY_MS;
  const setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));

  try {
    if (options.shouldCheck && !options.shouldCheck()) return;
    await updater.checkForUpdatesAndNotify();
  } catch (error) {
    options.onError(toError(error));
    setTimer(async () => {
      try {
        if (options.shouldCheck && !options.shouldCheck()) return;
        await updater.checkForUpdatesAndNotify();
      } catch (retryError) {
        options.onError(toError(retryError));
      }
    }, retryDelayMs);
  }
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
    setUpdateStatus({ checking: true, installing: false, error: undefined });
  });

  autoUpdater.on('update-available', (info: { version: string }) => {
    setUpdateStatus({
      checking: false,
      available: true,
      installing: false,
      version: info.version,
    });
  });

  autoUpdater.on('update-not-available', () => {
    setUpdateStatus({
      checking: false,
      available: false,
      installing: false,
    });
  });

  autoUpdater.on('download-progress', (progress: { percent: number }) => {
    setUpdateStatus({
      downloading: true,
      installing: false,
      progress: Math.round(progress.percent),
    });
  });

  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    logUpdater('update-downloaded');
    setUpdateStatus({
      downloading: false,
      downloaded: true,
      installing: false,
      version: info.version,
      progress: 100,
    });
  });

  autoUpdater.on('error', (error: Error) => {
    reportUpdaterError(error);
  });
}

export async function setupAutoUpdater(window: BrowserWindow, logger?: typeof logUpdater): Promise<void> {
  mainWindow = window;
  if (logger) logUpdater = logger;
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
  void runStartupUpdateCheck(autoUpdater, {
    retryDelayMs: STARTUP_UPDATE_RETRY_DELAY_MS,
    shouldCheck: () => !attemptLocked(),
    onError: (error) => {
      if (!attemptLocked()) reportUpdaterError(error);
    },
  });

  // Also check periodically (every 4 hours)
  setInterval(() => {
    if (autoUpdater && !attemptLocked()) {
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
      installing: false,
      progress: 0,
      error: '开发模式下无法检查更新',
    };
  }
  return updateStatus;
}

export async function checkForUpdates(): Promise<void> {
  if (attemptLocked()) return;
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
  createUpdaterHandoff().begin();
}

export function callAutoUpdaterQuitAndInstall(updater: unknown): boolean {
  if (!updater || typeof updater !== 'object') return false;
  const candidate = updater as {
    autoInstallOnAppQuit?: boolean;
    quitAndInstall?: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
  };
  if (typeof candidate.quitAndInstall !== 'function') return false;
  candidate.autoInstallOnAppQuit = true;
  candidate.quitAndInstall(false, true);
  return true;
}
