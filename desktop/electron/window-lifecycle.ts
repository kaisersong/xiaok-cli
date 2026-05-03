export interface RestorableDesktopWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  isVisible(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  webContents: {
    isDestroyed?(): boolean;
    invalidate(): void;
  };
}

export interface RepaintObservableDesktopWindow extends RestorableDesktopWindow {
  on(event: 'restore' | 'show', listener: () => void): unknown;
  webContents: RestorableDesktopWindow['webContents'] & {
    on(event: 'did-finish-load', listener: () => void): unknown;
  };
}

export interface CloseMinimizeDesktopWindow {
  on(event: 'close', listener: (event: { preventDefault(): void }) => void): unknown;
  minimize(): void;
}

const restoreRepaintDelayMs = 75;

export function restoreExistingWindow(window: RestorableDesktopWindow): void {
  if (window.isDestroyed()) return;
  if (window.isMinimized()) {
    window.restore();
  }
  if (!window.isVisible()) {
    window.show();
  }
  window.focus();
  repaintRenderer(window);
}

export function repaintRenderer(window: RestorableDesktopWindow): void {
  invalidateRenderer(window);
  setTimeout(() => invalidateRenderer(window), restoreRepaintDelayMs);
}

export function attachWindowRepaintHandlers(window: RepaintObservableDesktopWindow): void {
  window.on('restore', () => repaintRenderer(window));
  window.on('show', () => repaintRenderer(window));
  window.webContents.on('did-finish-load', () => repaintRenderer(window));
}

export function attachMacCloseToMinimize(
  window: CloseMinimizeDesktopWindow,
  platform: NodeJS.Platform = process.platform,
  shouldMinimize: () => boolean = () => true,
): void {
  if (platform !== 'darwin') return;
  window.on('close', (event) => {
    if (!shouldMinimize()) return;
    event.preventDefault();
    window.minimize();
  });
}

function invalidateRenderer(window: RestorableDesktopWindow): void {
  if (window.isDestroyed() || window.webContents.isDestroyed?.()) return;
  window.webContents.invalidate();
}
