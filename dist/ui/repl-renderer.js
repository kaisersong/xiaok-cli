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
    scrollRegion = null;
    constructor(stream = process.stdout) {
        this.stream = stream;
        this.controller = createTerminalController({ prompt: '' });
        this.terminalRenderer = new TerminalRenderer(stream);
    }
    syncTerminalSize() {
        const { columns, rows } = getTerminalSize(this.stream);
        this.controller.setTerminalSize(columns, rows);
    }
    setScrollRegion(region) {
        this.scrollRegion = region;
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
        this.controller.setFooterLines(frame.footerLines ?? []);
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
        this.controller.setFooterLines([]);
        this.controller.clearOverlay();
        this.controller.closeModal();
        this.render();
    }
    prepareBlockOutput() {
        this.terminalRenderer.clearAll();
    }
    /**
     * Restore expected line count after scroll region's endContentStreaming,
     * so the next TerminalRenderer render uses cursor movement not newlines.
     */
    prepareForInput() {
        this.terminalRenderer.setExpectedLineCount(2); // input bar + status bar
    }
}
