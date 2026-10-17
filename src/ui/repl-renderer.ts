import type { ReplInputFrame } from './repl-state.js';
import type { ScrollPromptFrame, ScrollRegionManager } from './scroll-region.js';
import { createTerminalController, type PermissionModalRequest, type TerminalController } from './terminal-controller.js';
import { TerminalRenderer } from './terminal-renderer.js';
import { formatPermissionPromptLines } from './permission-prompt.js';
import type { PermissionModalState } from './modal-state.js';
import { PermissionScreen } from './permission-screen.js';

function getTerminalSize(stream: NodeJS.WriteStream): { columns: number; rows: number } {
  return {
    columns: stream.columns ?? process.stdout.columns ?? 80,
    rows: stream.rows ?? process.stdout.rows ?? 24,
  };
}

export class ReplRenderer {
  private readonly controller: TerminalController;

  private readonly terminalRenderer: TerminalRenderer;

  private scrollRegion: ScrollRegionManager | null = null;
  private permissionScreen: PermissionScreen | null = null;
  private permissionInvalidated = false;
  private permissionNeedsScreen = false;
  private onPermissionInvalidated: (() => void) | undefined;
  private permissionCompletion: (() => void) | undefined;
  private readonly invalidatePermissionScreen = () => {
    const complete = this.permissionCompletion;
    if (!complete) return;
    this.permissionInvalidated = true;
    const deny = this.onPermissionInvalidated;
    this.onPermissionInvalidated = undefined;
    // Retire and restore this owner before notifying its real pending promise.
    // done() only calls its own now-retired completion closure, never closeModal.
    try { complete(); }
    finally { deny?.(); }
  };
  private releasePermissionScreen: (() => void) | null = null;
  private readonly repaintPermissionScreen = () => {
    if (this.permissionScreen) {
      try { this.render(); } catch { this.invalidatePermissionScreen(); }
    }
  };

  canApprovePermissionModal(): boolean {
    // A resize invalidates earlier page review before accepting a key.
    if (this.permissionInvalidated || !this.permissionCompletion
      || this.controller.getState().modal?.type !== 'permission') return false;
    if (this.permissionNeedsScreen && !this.permissionScreen) return false;
    if (this.permissionScreen) {
      this.render();
      return this.permissionScreen?.canApprove() ?? false;
    }
    // A valid inline modal intentionally has no alternate screen.
    return !this.permissionNeedsScreen;
  }

  pagePermissionModal(delta: number): void {
    if (!this.permissionScreen) return;
    this.permissionScreen.page(delta);
    this.render();
  }

  private finishPermissionScreen(): void {
    if (!this.permissionScreen) return;
    this.stream.removeListener('resize', this.repaintPermissionScreen);
    this.permissionScreen = null;
    const release = this.releasePermissionScreen;
    this.releasePermissionScreen = null;
    try { this.stream.write('\x1b[0m\x1b[?1049l\x1b[?25h'); }
    finally { release?.(); }
  }
  private inputOverlayKind: 'generic' | 'question' = 'generic';

  constructor(private readonly stream: NodeJS.WriteStream = process.stdout) {
    this.controller = createTerminalController({ prompt: '' });
    this.terminalRenderer = new TerminalRenderer(stream);
  }

  private syncTerminalSize(): void {
    const { columns, rows } = getTerminalSize(this.stream);
    this.controller.setTerminalSize(columns, rows);
  }

  setScrollRegion(region: ScrollRegionManager): void {
    this.invalidatePermissionScreen();
    this.scrollRegion = region;
  }

  hasActiveScrollRegion(): boolean {
    return this.scrollRegion?.isActive() ?? false;
  }

  private getScrollPromptFrame(
    overlayLines: string[] = [],
    overlayKind: ScrollPromptFrame['overlayKind'] = 'generic',
  ): ScrollPromptFrame {
    const state = this.controller.getState();
    const scrollFrame = this.scrollRegion?.getPromptFrameState();
    const hasRendererInputFrame = state.prompt !== '';
    const inputValue = hasRendererInputFrame
      ? state.input.value
      : state.input.value || scrollFrame?.inputValue || '';
    const cursor = hasRendererInputFrame
      ? state.input.cursorOffset
      : (state.input.value ? state.input.cursorOffset : (scrollFrame?.cursor ?? 0));
    const placeholder = state.prompt || scrollFrame?.placeholder || 'Type your message...';
    const summaryLine = state.footerLines && state.footerLines.length > 1
      ? state.footerLines[0] ?? ''
      : scrollFrame?.summaryLine ?? '';
    const statusLine = state.footerLines && state.footerLines.length > 1
      ? state.footerLines[1] ?? ''
      : state.footerLines?.[0] ?? scrollFrame?.statusLine ?? '';

    return {
      inputValue,
      cursor,
      placeholder,
      summaryLine,
      statusLine,
      overlayLines,
      overlayKind,
      owner: 'renderer',
    };
  }

  private buildPermissionOverlayLines(modal: PermissionModalState): string[] {
    const lines = formatPermissionPromptLines(modal.toolName, {}, modal.options.map((label, index) => ({
      label, selected: index === modal.selectedIndex,
    })));
    return [...lines.slice(0, 2), ...modal.targetLines, ...lines.slice(2)];
  }

  private render(): void {
    this.syncTerminalSize();
    const state = this.controller.getState();
    if (state.modal?.type === 'permission' && this.permissionScreen) {
      try { this.permissionScreen.render(state.modal, this.getScrollPromptFrame()); }
      catch (error) {
        try { this.invalidatePermissionScreen(); } catch {}
        throw error;
      }
      return;
    }
    this.finishPermissionScreen();
    if (this.scrollRegion?.isActive()) {
      const permissionModal = state.modal?.type === 'permission' ? state.modal : null;
      const overlayLines = permissionModal
        ? this.buildPermissionOverlayLines(permissionModal)
        : state.overlay?.type === 'lines'
          ? state.overlay.lines
          : [];
      this.scrollRegion.renderPromptFrame(
        this.getScrollPromptFrame(overlayLines, permissionModal ? 'permission' : this.inputOverlayKind),
      );
      return;
    }
    this.terminalRenderer.render(this.controller.getState());
  }

  getState() {
    return this.controller.getState();
  }

  renderInput(frame: ReplInputFrame, overlayKind: 'generic' | 'question' = 'generic'): void {
    this.inputOverlayKind = overlayKind;
    this.invalidatePermissionScreen();
    this.controller.closeModal();
    this.controller.setPrompt(frame.prompt);
    this.controller.replaceInput(frame.input, frame.cursor);
    this.controller.setFooterLines(frame.footerLines ?? []);
    this.controller.setOverlayLines(frame.overlayLines);
    this.render();
  }

  renderOverlayAtCursor(lines: string[]): void {
    this.inputOverlayKind = 'generic';
    this.invalidatePermissionScreen();
    this.controller.setOverlayLines(lines);
    this.render();
  }

  openPermissionModal(request: PermissionModalRequest, onInvalidated?: () => void): () => void {
    // A replacement must finish the previous real request before owning input.
    this.invalidatePermissionScreen();
    this.permissionInvalidated = false;
    this.permissionNeedsScreen = this.scrollRegion?.isActive() ?? false;
    this.onPermissionInvalidated = onInvalidated;
    const complete = (): void => {
      if (this.permissionCompletion !== complete) return;
      this.permissionCompletion = undefined;
      this.onPermissionInvalidated = undefined;
      this.permissionInvalidated = true;
      if (this.permissionScreen && this.scrollRegion) {
        const frame = this.scrollRegion.getPromptFrameState();
        this.controller.setPrompt(frame.placeholder);
        this.controller.setFooterLines([frame.summaryLine ?? '', frame.statusLine]);
      }
      this.controller.closeModal();
      this.render();
    };
    this.permissionCompletion = complete;
    try {
      this.controller.openPermissionModal(request);
      if (this.scrollRegion?.isActive() && !this.permissionScreen) {
        this.releasePermissionScreen = this.scrollRegion.suspendForPermissionScreen(this.invalidatePermissionScreen);
        this.permissionScreen = new PermissionScreen(this.stream);
        this.stream.on('resize', this.repaintPermissionScreen);
        this.stream.write('\x1b[?1049h');
      }
      this.render();
      return complete;
    } catch (error) {
      try { this.invalidatePermissionScreen(); } catch {}
      throw error;
    }
  }

  handleKey(key: string): void {
    this.controller.handleKey(key);
    this.render();
  }

  clearOverlay(): void {
    this.inputOverlayKind = 'generic';
    this.invalidatePermissionScreen();
    this.controller.clearOverlay();
    this.render();
  }

  closeModal(): void {
    if (this.permissionCompletion) {
      this.invalidatePermissionScreen();
      return;
    }
    this.controller.closeModal();
    this.render();
  }

  clearVisibleContent(): void {
    this.invalidatePermissionScreen();
    this.scrollRegion?.clearVisibleViewport();
  }

  clearPromptLine(): void {
    this.invalidatePermissionScreen();
    this.controller.setPrompt('');
    this.controller.replaceInput('', 0);
    this.controller.setFooterLines([]);
    this.controller.clearOverlay();
    this.controller.closeModal();
    this.render();
  }

  prepareBlockOutput(): void {
    this.invalidatePermissionScreen();
    this.terminalRenderer.clearAll();
  }

  /**
   * Restore expected line count after scroll region's endContentStreaming,
   * so the next TerminalRenderer render uses cursor movement not newlines.
   */
  prepareForInput(): void {
    this.invalidatePermissionScreen();
    this.terminalRenderer.setExpectedLineCount(2); // input bar + status bar
  }
}
