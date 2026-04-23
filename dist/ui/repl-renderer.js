import { createTerminalController } from './terminal-controller.js';
import { TerminalRenderer } from './terminal-renderer.js';
import { boldCyan, dim, yellow } from './render.js';
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
    hasActiveScrollRegion() {
        return this.scrollRegion?.isActive() ?? false;
    }
    getScrollPromptFrame(overlayLines = [], overlayKind = 'generic') {
        const state = this.controller.getState();
        const scrollFrame = this.scrollRegion?.getPromptFrameState();
        const inputValue = state.input.value || scrollFrame?.inputValue || '';
        const cursor = state.input.value ? state.input.cursorOffset : (scrollFrame?.cursor ?? 0);
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
    buildPermissionOverlayLines(modal) {
        return [
            `${yellow('⚡')} xiaok 想要执行以下操作`,
            `${'工具'}: ${boldCyan(modal.toolName)}`,
            ...modal.targetLines,
            ...modal.options.map((option, index) => {
                const selected = index === modal.selectedIndex;
                return selected ? boldCyan(`❯ ${option}`) : dim(`  ${option}`);
            }),
            dim('↑↓ 选择  Enter 确认  Esc 取消'),
        ];
    }
    render() {
        this.syncTerminalSize();
        const state = this.controller.getState();
        if (this.scrollRegion?.isActive()) {
            const permissionModal = state.modal?.type === 'permission' ? state.modal : null;
            const overlayLines = permissionModal
                ? this.buildPermissionOverlayLines(permissionModal)
                : state.overlay?.type === 'lines'
                    ? state.overlay.lines
                    : [];
            this.scrollRegion.renderPromptFrame(this.getScrollPromptFrame(overlayLines, permissionModal ? 'permission' : 'generic'));
            return;
        }
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
    clearVisibleContent() {
        this.scrollRegion?.clearVisibleViewport();
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
