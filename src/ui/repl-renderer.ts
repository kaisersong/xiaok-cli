import type { ReplInputFrame } from './repl-state.js';
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

  constructor(private readonly stream: NodeJS.WriteStream = process.stdout) {
    this.controller = createTerminalController({ prompt: '' });
    this.terminalRenderer = new TerminalRenderer(stream);
  }

  private syncTerminalSize(): void {
    const { columns, rows } = getTerminalSize(this.stream);
    this.controller.setTerminalSize(columns, rows);
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
}
