import type { ReplInputFrame } from './repl-state.js';
import type { ScrollPromptFrame, ScrollRegionManager } from './scroll-region.js';
import { createTerminalController, type PermissionModalRequest, type TerminalController } from './terminal-controller.js';
import { TerminalRenderer } from './terminal-renderer.js';
import { boldCyan, dim, yellow } from './render.js';
import type { PermissionModalState } from './modal-state.js';

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

  constructor(private readonly stream: NodeJS.WriteStream = process.stdout) {
    this.controller = createTerminalController({ prompt: '' });
    this.terminalRenderer = new TerminalRenderer(stream);
  }

  private syncTerminalSize(): void {
    const { columns, rows } = getTerminalSize(this.stream);
    this.controller.setTerminalSize(columns, rows);
  }

  setScrollRegion(region: ScrollRegionManager): void {
    this.scrollRegion = region;
  }

  hasActiveScrollRegion(): boolean {
    return this.scrollRegion?.isActive() ?? false;
  }

  private getScrollPromptFrame(overlayLines: string[] = []): ScrollPromptFrame {
    const state = this.controller.getState();
    const scrollFrame = this.scrollRegion?.getPromptFrameState();
    const inputValue = state.input.value || scrollFrame?.inputValue || '';
    const cursor = state.input.value ? state.input.cursorOffset : (scrollFrame?.cursor ?? 0);
    const placeholder = state.prompt || scrollFrame?.placeholder || 'Type your message...';
    const statusLine = state.footerLines?.[0] ?? scrollFrame?.statusLine ?? '';

    return {
      inputValue,
      cursor,
      placeholder,
      statusLine,
      overlayLines,
    };
  }

  private buildPermissionOverlayLines(modal: PermissionModalState): string[] {
    return [
      `${yellow('⚡')} xiaok 想要执行以下操作`,
      `${'工具'}: ${boldCyan(modal.toolName)}`,
      ...modal.targetLines,
      ...modal.options.map((option, index) => {
        const selected = index === modal.selectedIndex;
        const prefix = selected ? boldCyan('❯') : dim(' ');
        const label = selected ? boldCyan(option) : dim(option);
        return `${prefix} ${label}`;
      }),
      dim('↑↓ 选择  Enter 确认  Esc 取消'),
    ];
  }

  private render(): void {
    this.syncTerminalSize();
    const state = this.controller.getState();
    if (this.scrollRegion?.isActive()) {
      const overlayLines = state.modal?.type === 'permission'
        ? this.buildPermissionOverlayLines(state.modal)
        : state.overlay?.type === 'lines'
          ? state.overlay.lines
          : [];
      this.scrollRegion.renderPromptFrame(this.getScrollPromptFrame(overlayLines));
      return;
    }
    this.terminalRenderer.render(this.controller.getState());
  }

  getState() {
    return this.controller.getState();
  }

  renderInput(frame: ReplInputFrame): void {
    this.controller.closeModal();
    this.controller.setPrompt(frame.prompt);
    this.controller.replaceInput(frame.input, frame.cursor);
    this.controller.setFooterLines(frame.footerLines ?? []);
    this.controller.setOverlayLines(frame.overlayLines);
    this.render();
  }

  renderOverlayAtCursor(lines: string[]): void {
    this.controller.setOverlayLines(lines);
    this.render();
  }

  openPermissionModal(request: PermissionModalRequest): void {
    this.controller.openPermissionModal(request);
    this.render();
  }

  handleKey(key: string): void {
    this.controller.handleKey(key);
    this.render();
  }

  clearOverlay(): void {
    this.controller.clearOverlay();
    this.render();
  }

  closeModal(): void {
    this.controller.closeModal();
    this.render();
  }

  clearPromptLine(): void {
    this.controller.setPrompt('');
    this.controller.replaceInput('', 0);
    this.controller.setFooterLines([]);
    this.controller.clearOverlay();
    this.controller.closeModal();
    this.render();
  }

  prepareBlockOutput(): void {
    this.terminalRenderer.clearAll();
  }

  /**
   * Restore expected line count after scroll region's endContentStreaming,
   * so the next TerminalRenderer render uses cursor movement not newlines.
   */
  prepareForInput(): void {
    this.terminalRenderer.setExpectedLineCount(2); // input bar + status bar
  }
}
