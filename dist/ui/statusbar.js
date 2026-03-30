import { dim } from "./render.js";
const DEFAULT_FIELDS = ["model", "mode", "tokens", "session"];
/**
 * Inline status bar — prints a status line after input prompt.
 * No ANSI scroll regions, no absolute cursor positioning.
 */
export class StatusBar {
    model = "";
    sessionId = "";
    mode = "default";
    usage = { inputTokens: 0, outputTokens: 0 };
    fields = DEFAULT_FIELDS;
    enabled;
    cwd = "";
    branch = "";
    constructor() {
        this.enabled = true; // 始终启用状态栏
    }
    init(model, sessionId, cwd, mode) {
        this.model = model;
        this.sessionId = sessionId;
        this.cwd = cwd;
        if (mode)
            this.mode = mode;
    }
    update(usage) {
        this.usage = usage;
    }
    updateModel(model) {
        this.model = model;
    }
    updateMode(mode) {
        this.mode = mode;
    }
    updateBranch(branch) {
        this.branch = branch;
    }
    setFields(fields) {
        this.fields = fields;
    }
    /** Build the status string (no newline). */
    getStatusLine() {
        if (!this.enabled)
            return "";
        const parts = [];
        // Model name
        parts.push(this.model);
        // Branch (if set)
        if (this.branch) {
            parts.push(this.branch);
        }
        // Token usage: "26% used"
        if (this.usage.budget && this.usage.budget > 0) {
            const total = this.usage.inputTokens + this.usage.outputTokens;
            const pct = Math.round((total / this.usage.budget) * 100);
            parts.push(`${pct}% used`);
            // Tokens left: "148k left"
            const left = Math.round((this.usage.budget - total) / 1000);
            parts.push(`${left}k left`);
        }
        // Current path (replace HOME with ~)
        const displayPath = this.cwd.replace(process.env.HOME || '', '~');
        parts.push(displayPath);
        return dim(parts.join(' · '));
    }
    /** Print the status bar at fixed position (bottom line). */
    render() {
        if (!this.enabled)
            return;
        const statusLine = this.getStatusLine();
        if (!statusLine)
            return;
        const rows = process.stdout.rows ?? 24;
        // 移动到最后一行渲染状态栏
        process.stdout.write(`\x1b[${rows};1H\x1b[K`);
        process.stdout.write(statusLine);
    }
    /** No-op — no terminal state to restore in inline mode. */
    destroy() { }
}
