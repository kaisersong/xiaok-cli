import { dim } from "./render.js";
const DEFAULT_FIELDS = ["model", "mode", "tokens", "session"];
export class StatusBar {
    model = "";
    sessionId = "";
    mode = "default";
    usage = { inputTokens: 0, outputTokens: 0 };
    fields = DEFAULT_FIELDS;
    enabled;
    welcomeLines = 0;
    constructor() {
        this.enabled = process.stdout.isTTY === true && !process.env.NO_COLOR;
    }
    /** Initialize status bar. */
    init(model, sessionId, mode, welcomeLines) {
        if (!this.enabled)
            return;
        this.model = model;
        this.sessionId = sessionId;
        if (mode)
            this.mode = mode;
        const rows = process.stdout.rows ?? 24;
        // 设置滚动区域：从第1行到倒数第4行
        // 为分割线、输入栏、状态栏预留3行空间
        process.stderr.write(`\x1b[1;${rows - 3}r`);
        this.render();
    }
    /** Update usage stats. */
    update(usage) {
        this.usage = usage;
        this.render();
    }
    updateModel(model) {
        this.model = model;
        this.render();
    }
    updateMode(mode) {
        this.mode = mode;
        this.render();
    }
    setFields(fields) {
        this.fields = fields;
        this.render();
    }
    render() {
        if (!this.enabled)
            return;
        const rows = process.stdout.rows ?? 24;
        const cols = process.stdout.columns ?? 80;
        const left = [];
        const right = [];
        for (const field of this.fields) {
            switch (field) {
                case "model":
                    left.push(this.model);
                    break;
                case "mode":
                    if (this.mode !== "default")
                        left.push(`[${this.mode}]`);
                    break;
                case "tokens": {
                    const totalK = ((this.usage.inputTokens + this.usage.outputTokens) / 1000).toFixed(1);
                    right.push(`${totalK}k tokens`);
                    break;
                }
                case "session":
                    right.push(this.sessionId);
                    break;
            }
        }
        const leftStr = ` ${left.join(" ")}`;
        const rightStr = `${right.join("  ")} `;
        const padding = Math.max(0, cols - leftStr.length - rightStr.length);
        const bar = dim(leftStr + " ".repeat(padding) + rightStr);
        // 保存光标位置，定位到状态栏，渲染，恢复光标位置
        process.stderr.write(`\x1b7\x1b[${rows};1H\x1b[K${bar}\x1b8`);
    }
    /** Restore terminal state. */
    destroy() {
        if (!this.enabled)
            return;
        // 重置滚动区域
        process.stderr.write('\x1b[r');
        const rows = process.stdout.rows ?? 24;
        process.stderr.write(`\x1b[${rows};1H\x1b[K`);
    }
}
