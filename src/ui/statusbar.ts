import { dim, cyan } from "./render.js";

export type StatusBarField = "model" | "mode" | "tokens" | "session";

const DEFAULT_FIELDS: StatusBarField[] = ["model", "mode", "tokens", "session"];

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
}

export class StatusBar {
  private model = "";
  private sessionId = "";
  private mode = "default";
  private usage: UsageStats = { inputTokens: 0, outputTokens: 0 };
  private fields: StatusBarField[] = DEFAULT_FIELDS;
  private enabled: boolean;
  private welcomeLines = 0;

  constructor() {
    this.enabled = process.stdout.isTTY === true && !process.env.NO_COLOR;
  }

  /** Initialize status bar. */
  init(model: string, sessionId: string, mode?: string, welcomeLines?: number): void {
    if (!this.enabled) return;
    this.model = model;
    this.sessionId = sessionId;
    if (mode) this.mode = mode;

    const rows = process.stdout.rows ?? 24;
    // 设置滚动区域：从第1行到倒数第4行
    // 为分割线、输入栏、状态栏预留3行空间
    process.stderr.write(`\x1b[1;${rows - 3}r`);
    this.render();
  }

  /** Update usage stats. */
  update(usage: UsageStats): void {
    this.usage = usage;
    this.render();
  }

  updateModel(model: string): void {
    this.model = model;
    this.render();
  }

  updateMode(mode: string): void {
    this.mode = mode;
    this.render();
  }

  setFields(fields: StatusBarField[]): void {
    this.fields = fields;
    this.render();
  }

  render(): void {
    if (!this.enabled) return;

    const rows = process.stdout.rows ?? 24;
    const cols = process.stdout.columns ?? 80;

    const left: string[] = [];
    const right: string[] = [];

    for (const field of this.fields) {
      switch (field) {
        case "model":
          left.push(this.model);
          break;
        case "mode":
          if (this.mode !== "default") left.push(`[${this.mode}]`);
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
  destroy(): void {
    if (!this.enabled) return;
    // 重置滚动区域
    process.stderr.write('\x1b[r');
    const rows = process.stdout.rows ?? 24;
    process.stderr.write(`\x1b[${rows};1H\x1b[K`);
  }
}
