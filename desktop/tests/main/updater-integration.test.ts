import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ updater: null as any }));
vi.mock('electron-updater', () => ({ get autoUpdater() { return fixture.updater; } }));
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return { ...original, default: { ...original, existsSync: () => true }, existsSync: () => true };
});

describe('real updater handoff wiring', () => {
  const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
  let subject: typeof import('../../electron/updater.js');
  let updater: EventEmitter & Record<string, any>;
  beforeEach(async () => {
    vi.resetModules();
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
    await subject.setupAutoUpdater({ isDestroyed: () => false, webContents: { send: vi.fn() } } as any);
  });
  afterEach(() => {
    vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs();
    if (originalResourcesPath) Object.defineProperty(process, 'resourcesPath', originalResourcesPath);
    else delete (process as unknown as { resourcesPath?: string }).resourcesPath;
  });

  it('rejects absent download before entering mac wrapper', () => {
    const handoff = subject.createUpdaterHandoff('darwin');
    expect(handoff.begin().status).toBe('rejected_sync');
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
  it('preserves a prior native failure and rejects before wrapper', () => {
    updater.emit('update-downloaded', { version: '1.5.3' });
    updater.emit('error', new Error('signature rejected'));
    expect(subject.createUpdaterHandoff('darwin').begin().status).toBe('rejected_sync');
    expect(subject.getUpdateStatus().error).toBe('signature rejected');
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
  it('stops spinning without retry or shutdown after observation expires; late quit is allowed', async () => {
    updater.emit('update-downloaded', { version: '1.5.3' });
    const handoff = subject.createUpdaterHandoff('darwin');
    handoff.begin();
    await vi.advanceTimersByTimeAsync(30_001);
    expect(subject.getUpdateStatus()).toMatchObject({ downloaded: true, installing: false, error: 'update_install_handoff_unconfirmed' });
    expect(handoff.hasPendingIntent).toBe(true);
    for (const event of ['checking-for-update', 'update-available', 'update-not-available', 'download-progress', 'update-downloaded']) {
      updater.emit(event, { version: '1.5.4', percent: 12 });
    }
    await subject.checkForUpdates();
    expect(subject.getUpdateStatus().error).toBe('update_install_handoff_unconfirmed');
    handoff.begin();
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    handoff.commitHandoffOnBeforeQuit();
    subject.completeUpdaterHandoff();
    updater.emit('error', new Error('late unrelated error'));
    expect(handoff.snapshot().kind).toBe('handed_off');
  });
  it.each(['darwin', 'win32'] as const)('keeps asynchronous errors sticky on %s', (platform) => {
    updater.emit('update-downloaded', { version: '1.5.3' });
    const handoff = subject.createUpdaterHandoff(platform);
    handoff.begin();
    updater.emit('error', new Error('native delayed failure'));
    expect(handoff.snapshot().kind).toBe('pending_error_sticky');
    expect(subject.getUpdateStatus()).toMatchObject({ installing: false, error: 'native delayed failure' });
    handoff.begin();
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });
  it('attributes Windows synchronous emitted errors without treating delayed errors as retryable', () => {
    updater.emit('update-downloaded', { version: '1.5.3' });
    updater.quitAndInstall.mockImplementation(() => updater.emit('error', new Error('install refused')));
    const handoff = subject.createUpdaterHandoff('win32');
    expect(handoff.begin().status).toBe('rejected_sync');
    expect(handoff.snapshot().kind).toBe('error');
  });
  it.each(['darwin', 'win32'] as const)('classifies synchronous wrapper throws on %s', (platform) => {
    updater.emit('update-downloaded', { version: '1.5.3' });
    updater.quitAndInstall.mockImplementation(() => { throw new Error('wrapper failed'); });
    const handoff = subject.createUpdaterHandoff(platform);
    expect(handoff.begin().status).toBe(platform === 'darwin' ? 'pending_error_sticky' : 'rejected_sync');
    expect(subject.getUpdateStatus()).toMatchObject({ installing: false, error: 'wrapper failed' });
  });
  it('suppresses the scheduled startup retry and periodic check once an install is pending', async () => {
    const error = new Error('startup check failed');
    updater.checkForUpdatesAndNotify.mockRejectedValueOnce(error);
    await subject.setupAutoUpdater({ isDestroyed: () => false, webContents: { send: vi.fn() } } as any);
    await Promise.resolve();
    await subject.checkForUpdates();
    updater.emit('update-downloaded', { version: '1.5.3' });
    const startupCalls = updater.checkForUpdatesAndNotify.mock.calls.length;
    const checkCalls = updater.checkForUpdates.mock.calls.length;
    subject.createUpdaterHandoff('darwin').begin();
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(updater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(startupCalls);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(checkCalls);
    expect(subject.getUpdateStatus().error).toBe('update_install_handoff_unconfirmed');
  });
  it('logs useful updater diagnostics without credentials embedded in download URLs', async () => {
    const logger = vi.fn();
    await subject.setupAutoUpdater({ isDestroyed: () => false, webContents: { send: vi.fn() } } as any, logger);
    updater.emit('error', new Error('native rejected https://user:secret@download.example/package.zip?token=private'));
    expect(logger).toHaveBeenCalledWith('error', 'native rejected [URL omitted]');
    expect(JSON.stringify(logger.mock.calls)).not.toMatch(/secret|private|download\.example/);
  });
  it('does not rearm observation after synchronous before-quit', async () => {
    updater.emit('update-downloaded', { version: '1.5.3' });
    const handoff = subject.createUpdaterHandoff('darwin');
    updater.quitAndInstall.mockImplementation(() => {
      handoff.commitHandoffOnBeforeQuit();
      subject.completeUpdaterHandoff();
    });
    handoff.begin();
    await vi.advanceTimersByTimeAsync(30_001);
    expect(handoff.snapshot().kind).toBe('handed_off');
    expect(subject.getUpdateStatus().error).toBeUndefined();
  });
  it('does not roll back a synchronous committed handoff if the wrapper then throws', () => {
    updater.emit('update-downloaded', { version: '1.5.3' });
    const handoff = subject.createUpdaterHandoff('darwin');
    updater.quitAndInstall.mockImplementation(() => {
      handoff.commitHandoffOnBeforeQuit();
      subject.completeUpdaterHandoff();
      throw new Error('after quit');
    });
    handoff.begin();
    expect(handoff.snapshot().kind).toBe('handed_off');
    handoff.begin();
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });
});
