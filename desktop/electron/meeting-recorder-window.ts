import type { BrowserWindow, BrowserWindowConstructorOptions, Rectangle, screen as ElectronScreen } from 'electron';

import type { DesktopNotificationPort, DesktopNotificationResult } from './desktop-notifications.js';
import { buildBrowserWindowOptions } from './security.js';

export type MeetingRecorderWindowMode = 'workbench' | 'compact' | 'summary';
export type MeetingRecorderSessionState = 'idle' | 'recording' | 'processing' | 'summary';

type BrowserWindowConstructor = new (options: BrowserWindowConstructorOptions) => BrowserWindow;
type ScreenPort = Pick<typeof ElectronScreen, 'getDisplayMatching'>;

export interface MeetingRecorderWindowControllerOptions {
  BrowserWindow: BrowserWindowConstructor;
  getMainWindow: () => BrowserWindow | null;
  notificationPort: DesktopNotificationPort;
  platform?: NodeJS.Platform;
  preloadPath: string;
  rendererFile: string;
  devServer?: string;
  screen: ScreenPort;
}

export interface MeetingRecorderWindowController {
  open(input: { collectionId: string }): Promise<{ ok: boolean; error?: string }>;
  setMode(mode: MeetingRecorderWindowMode): { ok: boolean };
  setSessionState(state: MeetingRecorderSessionState): { ok: boolean };
  notifySummaryReady(input: { title: string }): Promise<DesktopNotificationResult>;
  notifySaved(input: { collectionId: string }): { ok: boolean };
  ownsWebContents(webContents: unknown): boolean;
  close(): { ok: boolean };
  dispose(): void;
}

const COMPACT_WIDTH = 420;
const COMPACT_HEIGHT = 160;
const COMPACT_MARGIN = 16;

function compactPosition(workArea: Rectangle): { x: number; y: number } {
  return {
    x: workArea.x + workArea.width - COMPACT_WIDTH - COMPACT_MARGIN,
    y: workArea.y + workArea.height - COMPACT_HEIGHT - COMPACT_MARGIN,
  };
}

export function createMeetingRecorderWindowController(
  options: MeetingRecorderWindowControllerOptions,
): MeetingRecorderWindowController {
  const platform = options.platform ?? process.platform;
  let recorderWindow: BrowserWindow | null = null;
  let sessionState: MeetingRecorderSessionState = 'idle';
  let forceClose = false;

  const currentWindow = (): BrowserWindow | null => (
    recorderWindow && !recorderWindow.isDestroyed() ? recorderWindow : null
  );

  const restoreWindow = (window: BrowserWindow): void => {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };

  const setMacWindowChrome = (window: BrowserWindow, compact: boolean): void => {
    if (platform !== 'darwin') return;
    window.setWindowButtonVisibility(compact ? false : true);
    window.setVisibleOnAllWorkspaces(compact, { visibleOnFullScreen: compact });
  };

  const setMode = (mode: MeetingRecorderWindowMode): { ok: boolean } => {
    const window = currentWindow();
    if (!window) return { ok: false };

    if (mode === 'compact') {
      window.setResizable(false);
      window.setMinimumSize(COMPACT_WIDTH, COMPACT_HEIGHT);
      window.setMaximumSize(COMPACT_WIDTH, COMPACT_HEIGHT);
      window.setAlwaysOnTop(true, 'floating');
      setMacWindowChrome(window, true);
      window.setSize(COMPACT_WIDTH, COMPACT_HEIGHT, true);
      const display = options.screen.getDisplayMatching(window.getBounds());
      const position = compactPosition(display.workArea);
      window.setPosition(position.x, position.y, true);
      restoreWindow(window);
      return { ok: true };
    }

    window.setAlwaysOnTop(false);
    setMacWindowChrome(window, false);
    window.setMaximumSize(10_000, 10_000);
    window.setMinimumSize(760, 560);
    window.setResizable(true);
    if (mode === 'summary') {
      window.setSize(760, 780, true);
    } else {
      window.setSize(1180, 760, true);
    }
    window.center();
    restoreWindow(window);
    return { ok: true };
  };

  return {
    async open(input) {
      const collectionId = input.collectionId.trim();
      if (!collectionId) return { ok: false, error: 'collection_id_required' };

      const existing = currentWindow();
      if (existing) {
        restoreWindow(existing);
        return { ok: true };
      }

      forceClose = false;
      sessionState = 'idle';
      const window = new options.BrowserWindow({
        ...buildBrowserWindowOptions(options.preloadPath, { platform }),
        width: 980,
        height: 680,
        minWidth: 760,
        minHeight: 560,
        title: 'AI录音',
        show: false,
      });
      recorderWindow = window;
      window.on('close', (event) => {
        if (forceClose || sessionState === 'idle' || sessionState === 'summary') return;
        event.preventDefault();
        window.webContents.send('desktop:meetingRecorderCloseRequested');
        restoreWindow(window);
      });
      window.on('closed', () => {
        if (recorderWindow === window) recorderWindow = null;
        sessionState = 'idle';
        forceClose = false;
      });

      const route = `/meeting-recorder/${encodeURIComponent(collectionId)}`;
      if (options.devServer) {
        const base = options.devServer.replace(/\/$/, '');
        await window.loadURL(`${base}#${route}`);
      } else {
        await window.loadFile(options.rendererFile, { hash: route });
      }
      window.show();
      window.focus();
      return { ok: true };
    },

    setMode,

    setSessionState(state) {
      sessionState = state;
      return { ok: true };
    },

    async notifySummaryReady(input) {
      const window = currentWindow();
      if (!window || window.isFocused()) return { ok: true, skipped: true };
      return options.notificationPort.show({
        title: '录音纪要总结完成',
        body: input.title.trim() || '录音总结已生成',
        onClick: () => {
          const target = currentWindow();
          if (target) restoreWindow(target);
        },
      });
    },

    notifySaved(input) {
      const mainWindow = options.getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
      mainWindow.webContents.send('desktop:meetingRecordingSaved', input);
      return { ok: true };
    },

    ownsWebContents(webContents) {
      return currentWindow()?.webContents === webContents;
    },

    close() {
      const window = currentWindow();
      if (!window) return { ok: true };
      forceClose = true;
      window.close();
      return { ok: true };
    },

    dispose() {
      const window = currentWindow();
      if (!window) return;
      forceClose = true;
      window.destroy();
      recorderWindow = null;
    },
  };
}
