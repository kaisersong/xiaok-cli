import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ updater: null as any }));
vi.mock('electron-updater', () => ({ get autoUpdater() { return fixture.updater; } }));
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return { ...original, default: { ...original, existsSync: () => true }, existsSync: () => true };
});

describe('configured updater source authority', () => {
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
    await Reflect.apply(subject.setupAutoUpdater, undefined, [{ isDestroyed: () => false, webContents: { send: vi.fn() } }, undefined, { requestSource: 'scheduler' }]);
  });
  afterEach(() => {
    vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs();
    if (originalResourcesPath) Object.defineProperty(process, 'resourcesPath', originalResourcesPath);
    else delete (process as unknown as { resourcesPath?: string }).resourcesPath;
  });


  const roles = [undefined, { requestSource: 'agent' }, { requestSource: 'scheduler' }, { requestSource: 'system' }];
  it.each(roles)('does not allow a manual check from disallowed configured source %j', async context => {
    const before = updater.checkForUpdates.mock.calls.length;
    await expect(Reflect.apply(subject.checkForUpdates, undefined, [context])).rejects.toThrow(/updater_request_source_/);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(before);
  });
  it.each(roles)('does not allow configured singleton begin from disallowed source %j', context => {
    updater.emit('update-downloaded', { version: 'owned-fixture-next' });
    const handoff = subject.createUpdaterHandoff('darwin');
    const before = handoff.snapshot();
    expect(() => Reflect.apply(handoff.begin, handoff, [context])).toThrow(/updater_request_source_/);
    expect(handoff.snapshot()).toEqual(before);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
  it.each(roles)('does not allow public install sibling from disallowed source %j', context => {
    updater.emit('update-downloaded', { version: 'owned-fixture-next' });
    expect(() => Reflect.apply(subject.quitAndInstall, undefined, [context])).toThrow(/updater_request_source_/);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
  it('checks source shape without executing its getter', async () => {
    let reads = 0;
    const context = Object.defineProperty({}, 'requestSource', { enumerable: true, get() { reads++; return 'user'; } });
    await expect(Reflect.apply(subject.checkForUpdates, undefined, [context])).rejects.toThrow(/updater_request_source_/);
    expect(reads).toBe(0); expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });
});
