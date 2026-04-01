import { dim } from "./render.js";
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
const DEFAULT_FIELDS = ["model", "mode", "tokens", "session"];
const VALID_FIELDS = new Set(DEFAULT_FIELDS);
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
        this.fields = loadConfiguredFields(cwd) ?? DEFAULT_FIELDS;
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
        const projectName = this.cwd.split('/').filter(Boolean).pop() || 'xiaok';
        for (const field of this.fields) {
            if (field === "session" && projectName) {
                parts.push(projectName);
            }
            if (field === "model" && this.model) {
                parts.push(this.model);
            }
            if (field === "mode" && this.mode && this.mode !== "default") {
                parts.push(this.mode);
            }
            if (field === "tokens" && this.usage.budget && this.usage.budget > 0) {
                const total = this.usage.inputTokens + this.usage.outputTokens;
                const pct = Math.round((total / this.usage.budget) * 100);
                parts.push(`${pct}%`);
            }
        }
        if (!this.fields.includes("mode") && this.branch) {
            parts.push(this.branch);
        }
        else if (this.fields.includes("mode") && this.fields.includes("session") && this.branch) {
            parts.splice(Math.min(parts.length, 2), 0, this.branch);
        }
        return dim(parts.join(' · '));
    }
    /** Print the status bar as simple text (no ANSI positioning). */
    render() {
        if (!this.enabled)
            return;
        const statusLine = this.getStatusLine();
        if (!statusLine)
            return;
        // 简单输出，不使用 ANSI 定位，避免干扰输入框
        process.stdout.write(statusLine + '\n');
    }
    /** No-op — no terminal state to restore in inline mode. */
    destroy() { }
}
function loadConfiguredFields(cwd) {
    const configDir = process.env.XIAOK_CONFIG_DIR ?? join(homedir(), '.xiaok');
    const settingsPaths = [
        join(configDir, 'settings.json'),
        join(cwd, '.xiaok', 'settings.json'),
    ];
    let configured;
    for (const path of settingsPaths) {
        if (!existsSync(path)) {
            continue;
        }
        try {
            const parsed = JSON.parse(readFileSync(path, 'utf8'));
            const fields = parsed.ui?.statusBar?.fields;
            if (!Array.isArray(fields)) {
                continue;
            }
            const validFields = fields.filter((field) => VALID_FIELDS.has(field));
            if (validFields.length > 0) {
                configured = validFields;
            }
        }
        catch { }
    }
    return configured;
}
