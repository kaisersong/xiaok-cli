import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ updater: null as any, loadFailure: null as unknown }));
vi.mock('electron-updater', () => ({ get autoUpdater() { if (fixture.loadFailure) throw fixture.loadFailure; return fixture.updater; } }));
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return { ...original, default: { ...original, existsSync: () => true }, existsSync: () => true };
});

describe('configured updater state and maintenance owner', () => {
  const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
  let subject: typeof import('../../electron/updater.js');
  let updater: EventEmitter & Record<string, any>;
  beforeEach(async () => {
    vi.resetModules(); fixture.loadFailure = null;
    vi.useFakeTimers();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('XIAOK_DESKTOP_DEV_SERVER', '');
    Object.defineProperty(process, 'resourcesPath', { value: '/fixture/resources', configurable: true });
    updater = Object.assign(new EventEmitter(), {
      checkForUpdates: vi.fn().mockResolvedValue({}),
      checkForUpdatesAndNotify: vi.fn().mockResolvedValue({}),
      quitAndInstall: vi.fn(),
    });
    fixture.updater = updater;
    subject = await import('../../electron/updater.js');
    await Reflect.apply(subject.setupAutoUpdater, undefined, [{ isDestroyed: () => false, webContents: { send: vi.fn() } }, undefined, { requestSource: 'scheduler' }]);
  });
  afterEach(() => {
    fixture.loadFailure = null; vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs();
    if (originalResourcesPath) Object.defineProperty(process, 'resourcesPath', originalResourcesPath);
    else delete (process as unknown as { resourcesPath?: string }).resourcesPath;
  });



  it('rebinds a replacement window without another startup check or four-hour poller', async () => {
    const before = vi.getTimerCount(); const startup = updater.checkForUpdatesAndNotify.mock.calls.length;
    const window = { isDestroyed: () => false, webContents: { send: vi.fn() } };
    await Reflect.apply(subject.setupAutoUpdater, undefined, [window, undefined, { requestSource: 'scheduler' }]);
    expect(vi.getTimerCount()).toBe(before); expect(updater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(startup);
    updater.emit('update-available', { version: 'owned-next' });
    expect(window.webContents.send).toHaveBeenCalledWith('desktop:updateStatus', expect.objectContaining({ version: 'owned-next' }));
  });
  it('returns detached status and state-machine snapshots', () => {
    updater.emit('update-downloaded', { version: 'owned-next' });
    const status = subject.getUpdateStatus(); status.progress = 39;
    expect(subject.getUpdateStatus().progress).toBe(100);
    const handoff = subject.createUpdaterHandoff('darwin');
    Reflect.apply(handoff.begin, handoff, [{ requestSource: 'user' }]);
    const snapshot = handoff.snapshot(); Object.assign(snapshot, { kind: 'idle' });
    expect(handoff.snapshot().kind).toBe('pending');
  });
  it('keeps known flags and progress while reporting malformed SDK progress without throwing', () => {
    updater.emit('update-downloaded', { version: 'owned-next' });
    const before = subject.getUpdateStatus();
    expect(() => updater.emit('download-progress', { percent: Number.NaN })).not.toThrow();
    expect(subject.getUpdateStatus()).toMatchObject({ downloaded: before.downloaded, version: before.version, progress: before.progress, error: 'updater_projection_unavailable' });
  });
  it('does not invoke an SDK update-info getter and keeps previous data', () => {
    updater.emit('update-available', { version: 'owned-next' }); let reads = 0;
    const raw = Object.defineProperty({}, 'version', { enumerable: true, get() { reads++; return 'bad'; } });
    expect(() => updater.emit('update-downloaded', raw)).not.toThrow();
    expect(reads).toBe(0); expect(subject.getUpdateStatus().version).toBe('owned-next');
    expect(subject.getUpdateStatus().downloaded).toBe(false);
  });
  it('does not authorize manual install from SDK downloaded flags for an agent source', () => {
    updater.emit('update-downloaded', { version: 'owned-next' });
    expect(() => Reflect.apply(subject.quitAndInstall, undefined, [{ requestSource: 'agent' }])).toThrow(/updater_request_source_/);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
  it('retries a failed load only on explicit replacement setup and singleflights concurrent replacements', async () => {
    vi.clearAllTimers(); vi.resetModules(); fixture.updater = null;
    subject = await import('../../electron/updater.js');
    const window = { isDestroyed: () => false, webContents: { send: vi.fn() } };
    await Reflect.apply(subject.setupAutoUpdater, undefined, [window, undefined, { requestSource: 'scheduler' }]);
    expect(vi.getTimerCount()).toBe(0);
    expect(subject.getUpdateStatus().error).toContain('electron-updater');
    fixture.updater = updater;
    await Promise.all([1, 2].map(() => Reflect.apply(subject.setupAutoUpdater, undefined, [window, undefined, { requestSource: 'scheduler' }])));
    expect(updater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(2); // beforeEach epoch plus new successful replacement epoch
    expect(vi.getTimerCount()).toBe(1);
    updater.emit('update-available', { version: 'replacement-next' });
    expect(window.webContents.send).toHaveBeenCalledWith('desktop:updateStatus', expect.objectContaining({ version: 'replacement-next' }));
  });
  it.each(['manual', 'periodic', 'load'])('normalizes actual %s SDK rejection without reading its message getter', async mode => {
    let reads = 0;
    const error = Object.defineProperty({}, 'message', { get() { reads++; throw Error('must_not_read'); } });
    if (mode === 'load') {
      vi.clearAllTimers(); vi.resetModules(); fixture.loadFailure = error;
      subject = await import('../../electron/updater.js');
      const window = { isDestroyed: () => false, webContents: { send: vi.fn() } };
      await expect(Reflect.apply(subject.setupAutoUpdater, undefined, [window, undefined, { requestSource: 'scheduler' }])).resolves.toBeUndefined();
      expect(subject.getUpdateStatus().error).toContain('updater_operation_unknown');
      fixture.loadFailure = null;
      await Reflect.apply(subject.setupAutoUpdater, undefined, [window, undefined, { requestSource: 'scheduler' }]);
      expect(vi.getTimerCount()).toBe(1);
    } else {
      updater.checkForUpdates.mockRejectedValueOnce(error);
      if (mode === 'manual') await expect(Reflect.apply(subject.checkForUpdates, undefined, [{ requestSource: 'user' }])).resolves.toBeUndefined();
      else await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
      expect(subject.getUpdateStatus().error).toBe('updater_operation_unknown');
      expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    }
    expect(reads).toBe(0);
  });
  it('really schedules the first failed startup retry and suppresses it when user handoff becomes pending', async () => {
    vi.clearAllTimers(); vi.resetModules();
    updater = Object.assign(new EventEmitter(), { checkForUpdates: vi.fn().mockResolvedValue({}),
      checkForUpdatesAndNotify: vi.fn().mockRejectedValueOnce(Error('first startup failure')).mockResolvedValue(undefined), quitAndInstall: vi.fn() });
    fixture.updater = updater;
    subject = await import('../../electron/updater.js');
    await Reflect.apply(subject.setupAutoUpdater, undefined, [{ isDestroyed: () => false, webContents: { send: vi.fn() } }, undefined, { requestSource: 'scheduler' }]);
    await Promise.resolve();
    expect(updater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(2); // actual 60s retry plus sole4h maintenance
    await Reflect.apply(subject.checkForUpdates, undefined, [{ requestSource: 'user' }]);
    updater.emit('update-downloaded', { version: 'owned-next' });
    const handoff = subject.createUpdaterHandoff('darwin');
    expect(Reflect.apply(handoff.begin, handoff, [{ requestSource: 'user' }])).toEqual({ status: 'pending' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(updater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(1);
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(handoff.hasPendingIntent).toBe(true);
    expect(subject.getUpdateStatus().error).toBe('update_install_handoff_unconfirmed');
  });

});
