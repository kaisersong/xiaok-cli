import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { createMeetingRecorderWindowController } from '../../electron/meeting-recorder-window.js';

class FakeWebContents extends EventEmitter {
  send = vi.fn();
}

class FakeBrowserWindow extends EventEmitter {
  static instances: FakeBrowserWindow[] = [];
  static fromWebContents = vi.fn();

  webContents = new FakeWebContents();
  destroyed = false;
  focused = false;
  visible = false;
  bounds = { x: 100, y: 80, width: 980, height: 680 };
  loadFile = vi.fn().mockResolvedValue(undefined);
  loadURL = vi.fn().mockResolvedValue(undefined);
  show = vi.fn(() => { this.visible = true; });
  focus = vi.fn(() => { this.focused = true; });
  restore = vi.fn();
  center = vi.fn();
  close = vi.fn(() => { this.emit('close', { preventDefault: vi.fn() }); });
  destroy = vi.fn(() => { this.destroyed = true; this.emit('closed'); });
  isDestroyed = vi.fn(() => this.destroyed);
  isFocused = vi.fn(() => this.focused);
  isMinimized = vi.fn(() => false);
  setAlwaysOnTop = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  setWindowButtonVisibility = vi.fn();
  setResizable = vi.fn();
  setMinimumSize = vi.fn();
  setMaximumSize = vi.fn();
  setSize = vi.fn((width: number, height: number) => {
    this.bounds = { ...this.bounds, width, height };
  });
  setPosition = vi.fn((x: number, y: number) => {
    this.bounds = { ...this.bounds, x, y };
  });
  getBounds = vi.fn(() => this.bounds);

  constructor(public options: Record<string, unknown>) {
    super();
    FakeBrowserWindow.instances.push(this);
  }
}

function createController(platform: NodeJS.Platform = 'darwin') {
  FakeBrowserWindow.instances = [];
  const notificationPort = { show: vi.fn().mockResolvedValue({ ok: true }) };
  const mainWindow = {
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  };
  const controller = createMeetingRecorderWindowController({
    BrowserWindow: FakeBrowserWindow as never,
    getMainWindow: () => mainWindow as never,
    notificationPort,
    platform,
    preloadPath: '/app/preload.cjs',
    rendererFile: '/app/index.html',
    screen: {
      getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
    } as never,
  });
  return { controller, mainWindow, notificationPort };
}

describe('MeetingRecorderWindowController', () => {
  it('opens one recorder window and focuses it on repeated open', async () => {
    const { controller } = createController();

    await controller.open({ collectionId: 'col-1' });
    await controller.open({ collectionId: 'col-1' });

    expect(FakeBrowserWindow.instances).toHaveLength(1);
    const recorder = FakeBrowserWindow.instances[0];
    expect(recorder.loadFile).toHaveBeenCalledWith('/app/index.html', {
      hash: '/meeting-recorder/col-1',
    });
    expect(recorder.show).toHaveBeenCalled();
    expect(recorder.focus).toHaveBeenCalled();
  });

  it('switches the same window between compact, workbench, and summary geometry', async () => {
    const { controller } = createController();
    await controller.open({ collectionId: 'col-1' });
    const recorder = FakeBrowserWindow.instances[0];

    expect(controller.setMode('compact')).toEqual({ ok: true });
    expect(recorder.setAlwaysOnTop).toHaveBeenLastCalledWith(true, 'floating');
    expect(recorder.setVisibleOnAllWorkspaces).toHaveBeenLastCalledWith(true, { visibleOnFullScreen: true });
    expect(recorder.setWindowButtonVisibility).toHaveBeenLastCalledWith(false);
    expect(recorder.setSize).toHaveBeenLastCalledWith(420, 160, true);
    expect(recorder.setPosition).toHaveBeenLastCalledWith(1004, 724, true);

    expect(controller.setMode('workbench')).toEqual({ ok: true });
    expect(recorder.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
    expect(recorder.setSize).toHaveBeenLastCalledWith(1180, 760, true);
    expect(recorder.center).toHaveBeenCalled();

    expect(controller.setMode('summary')).toEqual({ ok: true });
    expect(recorder.setSize).toHaveBeenLastCalledWith(760, 780, true);
  });

  it('does not call macOS-only window APIs on other platforms', async () => {
    const { controller } = createController('win32');
    await controller.open({ collectionId: 'col-1' });
    const recorder = FakeBrowserWindow.instances[0];

    controller.setMode('compact');

    expect(recorder.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
    expect(recorder.setWindowButtonVisibility).not.toHaveBeenCalled();
  });

  it('blocks native close while recording and tells the renderer why', async () => {
    const { controller } = createController();
    await controller.open({ collectionId: 'col-1' });
    const recorder = FakeBrowserWindow.instances[0];
    controller.setSessionState('recording');
    const event = { preventDefault: vi.fn() };

    recorder.emit('close', event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(recorder.webContents.send).toHaveBeenCalledWith('desktop:meetingRecorderCloseRequested');
  });

  it('uses a best-effort system notification only when the recorder is not focused', async () => {
    const { controller, notificationPort } = createController();
    await controller.open({ collectionId: 'col-1' });
    const recorder = FakeBrowserWindow.instances[0];
    recorder.focused = true;

    await expect(controller.notifySummaryReady({ title: '客户需求讨论' })).resolves.toEqual({
      ok: true,
      skipped: true,
    });
    expect(notificationPort.show).not.toHaveBeenCalled();

    recorder.focused = false;
    await expect(controller.notifySummaryReady({ title: '客户需求讨论' })).resolves.toMatchObject({ ok: true });
    expect(notificationPort.show).toHaveBeenCalledWith(expect.objectContaining({
      title: '录音纪要总结完成',
      body: '客户需求讨论',
      onClick: expect.any(Function),
    }));
    const onClick = notificationPort.show.mock.calls[0][0].onClick as () => void;
    onClick();
    expect(recorder.show).toHaveBeenCalled();
    expect(recorder.focus).toHaveBeenCalled();
  });

  it('notifies the main knowledge window after a recorder save', async () => {
    const { controller, mainWindow } = createController();
    await controller.open({ collectionId: 'col-1' });

    expect(controller.notifySaved({ collectionId: 'col-1' })).toEqual({ ok: true });
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('desktop:meetingRecordingSaved', {
      collectionId: 'col-1',
    });
  });
});
