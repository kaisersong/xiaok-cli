import { createTerminalController } from './terminal-controller.js';
import { TerminalRenderer } from './terminal-renderer.js';
function getTerminalSize(stream) {
    return {
        columns: stream.columns ?? process.stdout.columns ?? 80,
        rows: stream.rows ?? process.stdout.rows ?? 24,
    };
}
export class ReplRenderer {
    stream;
    controller;
    terminalRenderer;
    constructor(stream = process.stdout) {
        this.stream = stream;
        this.controller = createTerminalController({ prompt: '' });
        this.terminalRenderer = new TerminalRenderer(stream);
    }
    syncTerminalSize() {
        const { columns, rows } = getTerminalSize(this.stream);
        this.controller.setTerminalSize(columns, rows);
    }
    render() {
        this.syncTerminalSize();
        this.terminalRenderer.render(this.controller.getState());
    }
    getState() {
        return this.controller.getState();
    }
    renderInput(frame) {
        this.controller.closeModal();
        this.controller.setPrompt(frame.prompt);
        this.controller.replaceInput(frame.input, frame.cursor);
        this.controller.setOverlayLines(frame.overlayLines);
        this.render();
    }
    renderOverlayAtCursor(lines) {
        this.controller.setOverlayLines(lines);
        this.render();
    }
    openPermissionModal(request) {
        this.controller.openPermissionModal(request);
        this.render();
    }
    handleKey(key) {
        this.controller.handleKey(key);
        this.render();
    }
    clearOverlay() {
        this.controller.clearOverlay();
        this.render();
    }
    closeModal() {
        this.controller.closeModal();
        this.render();
    }
    clearPromptLine() {
        this.controller.setPrompt('');
        this.controller.replaceInput('', 0);
        this.controller.clearOverlay();
        this.controller.closeModal();
        this.render();
    }
    prepareBlockOutput() {
        this.clearPromptLine();
    }
}
