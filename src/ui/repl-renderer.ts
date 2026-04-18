import type { ReplInputFrame } from './repl-state.js';
import type { ScrollRegionManager } from './scroll-region.js';
import { createTerminalController, type PermissionModalRequest, type TerminalController } from './terminal-controller.js';
import { TerminalRenderer } from './terminal-renderer.js';

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

  private render(): void {
    this.syncTerminalSize();
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
