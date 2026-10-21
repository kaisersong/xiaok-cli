import { types } from 'node:util';
import { assertUpdaterSource, captureUpdateStatus } from './updater-authority.js';
import type { UpdaterRequestContext } from '../shared/updater-ipc-contract.js';
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
let updaterSetup: Promise<boolean> | undefined;
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
  try { logUpdater('error', message.replace(/https?:\/\/[^\s]+/gi, '[URL omitted]')); } catch { /* diagnostic sink */ }
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
    authorizeBegin: context => assertUpdaterSource(context, 'user'),
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

function recordProjectionFailure(): void {
  // Preserve the last known flags/version/progress; this diagnostic grants no lifecycle transition.
  updateStatus = { ...updateStatus, error: 'updater_projection_unavailable' };
  sendUpdateStatus();
}
function setUpdateStatus(patch: Partial<UpdateStatus>, installTransition = false): void {
  if (!installTransition && attemptLocked()) return;
  try { updateStatus = captureUpdateStatus({ ...updateStatus, ...patch }); }
  catch { recordProjectionFailure(); return; }
  sendUpdateStatus();
}
function sdkScalar(raw: unknown, key: string): unknown {
  if (!raw || typeof raw !== 'object' || types.isProxy(raw)) throw Error('updater_projection_unavailable');
  const descriptor = Object.getOwnPropertyDescriptor(raw, key);
  if (!descriptor || !('value' in descriptor)) throw Error('updater_projection_unavailable');
  return descriptor.value;
}
function sdkEvent(handler: (raw: unknown) => void): (raw: unknown) => void {
  return raw => { try { handler(raw); } catch { recordProjectionFailure(); } };
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
  if (typeof error === 'string') return new Error(error);
  if (error && typeof error === 'object' && !types.isProxy(error)) {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'message');
    if (descriptor && 'value' in descriptor && typeof descriptor.value === 'string') return new Error(descriptor.value);
  }
  return new Error('updater_operation_unknown');
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
    setUpdateStatus({ error: `无法加载更新器: ${toError(e).message}` });
    return false;
  }
}

function registerAutoUpdaterEvents(): void {
  if (!autoUpdater || autoUpdaterEventsRegistered) return;
  autoUpdaterEventsRegistered = true;

  autoUpdater.on('checking-for-update', () => {
    setUpdateStatus({ checking: true, installing: false, error: undefined });
  });

  autoUpdater.on('update-available', sdkEvent(info => {
    const version = sdkScalar(info, 'version');
    if (typeof version !== 'string') throw Error('updater_projection_unavailable');
    setUpdateStatus({
      checking: false,
      available: true,
      installing: false,
      version,
    });
  }));

  autoUpdater.on('update-not-available', () => {
    setUpdateStatus({
      checking: false,
      available: false,
      installing: false,
    });
  });

  autoUpdater.on('download-progress', sdkEvent(progress => {
    const percent = sdkScalar(progress, 'percent');
    if (typeof percent !== 'number' || !Number.isFinite(percent)) throw Error('updater_projection_unavailable');
    setUpdateStatus({
      downloading: true,
      installing: false,
      progress: Math.round(percent),
    });
  }));

  autoUpdater.on('update-downloaded', sdkEvent(info => {
    const version = sdkScalar(info, 'version');
    if (typeof version !== 'string') throw Error('updater_projection_unavailable');
    logUpdater('update-downloaded');
    setUpdateStatus({
      downloading: false,
      downloaded: true,
      installing: false,
      version,
      progress: 100,
    });
  }));

  autoUpdater.on('error', sdkEvent(error => {
    reportUpdaterError(toError(error));
  }));
}

export async function setupAutoUpdater(window: BrowserWindow, logger: typeof logUpdater | undefined, context: UpdaterRequestContext): Promise<void> {
  assertUpdaterSource(context, 'scheduler');
  mainWindow = window;
  if (logger) logUpdater = logger;
  if (updaterSetup) { await updaterSetup; return; }
  const attempt = Promise.resolve().then(async () => {
  isDevMode = isDevelopmentMode();

  // Skip in development mode
  if (isDevMode) {
    updateStatus.error = '开发模式下无法检查更新';
    return true;
  }

  // Load autoUpdater dynamically
  if (!(await loadAutoUpdater())) return false;

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
          error: toError(error).message,
        });
      });
    }
  }, 4 * 60 * 60 * 1000);
  return true;
  });
  updaterSetup = attempt;
  try { if (!await attempt && updaterSetup === attempt) updaterSetup = undefined; }
  catch (error) { if (updaterSetup === attempt) updaterSetup = undefined; throw error; }
}

function sendUpdateStatus(): void {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop:updateStatus', captureUpdateStatus(updateStatus));
  } catch {
    // A closing renderer cannot throw back into the SDK event dispatcher.
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
  return captureUpdateStatus(updateStatus);
}

export async function checkForUpdates(context: UpdaterRequestContext): Promise<void> {
  assertUpdaterSource(context, 'user');
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
      error: toError(e).message,
    });
  }
}

export function quitAndInstall(context: UpdaterRequestContext): void {
  createUpdaterHandoff().begin(context);
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
