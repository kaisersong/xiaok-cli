import { describe, expect, it, vi } from 'vitest';

import { callAutoUpdaterQuitAndInstall, resolveAutoUpdaterExport, runStartupUpdateCheck } from '../../electron/updater.js';

describe('desktop updater', () => {
  it('loads autoUpdater from CommonJS default exports', () => {
    const updater = { checkForUpdates: vi.fn() };

    expect(resolveAutoUpdaterExport({ default: { autoUpdater: updater } })).toBe(updater);
  });

  it('prefers named autoUpdater exports when available', () => {
    const namedUpdater = { checkForUpdates: vi.fn() };
    const defaultUpdater = { checkForUpdates: vi.fn() };

    expect(resolveAutoUpdaterExport({
      autoUpdater: namedUpdater,
      default: { autoUpdater: defaultUpdater },
    })).toBe(namedUpdater);
  });

  it('returns null when the module does not expose autoUpdater', () => {
    expect(resolveAutoUpdaterExport({ default: {} })).toBeNull();
  });

  it('installs downloaded updates by allowing app quit and relaunch', () => {
    const updater = {
      autoInstallOnAppQuit: false,
      quitAndInstall: vi.fn(),
    };

    expect(callAutoUpdaterQuitAndInstall(updater)).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('reports install failure when updater is unavailable', () => {
    expect(callAutoUpdaterQuitAndInstall(null)).toBe(false);
    expect(callAutoUpdaterQuitAndInstall({})).toBe(false);
  });

  it('retries a failed startup update check once after a short delay', async () => {
    const retryCallbacks: Array<() => void> = [];
    const retryDelays: number[] = [];
    const errors: string[] = [];
    const updater = {
      checkForUpdatesAndNotify: vi.fn()
        .mockRejectedValueOnce(new Error('Cannot find latest-mac.yml'))
        .mockResolvedValueOnce(undefined),
    };

    await runStartupUpdateCheck(updater, {
      retryDelayMs: 25,
      onError: (error) => errors.push(error.message),
      setTimer: (callback, delayMs) => {
        retryCallbacks.push(callback);
        retryDelays.push(delayMs);
      },
    });

    expect(updater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(1);
    expect(errors).toEqual(['Cannot find latest-mac.yml']);
    expect(retryDelays).toEqual([25]);
    expect(retryCallbacks).toHaveLength(1);

    await retryCallbacks[0]();

    expect(updater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(2);
    expect(retryCallbacks).toHaveLength(1);
  });
});
