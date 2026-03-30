import { dim, boldCyan, dimCyan } from "./render.js";

export type StatusBarField = "model" | "mode" | "tokens" | "session";

const DEFAULT_FIELDS: StatusBarField[] = ["model", "mode", "tokens", "session"];

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  budget?: number;
}

/**
 * Inline status bar — prints a status line after input prompt.
 * No ANSI scroll regions, no absolute cursor positioning.
 */
export class StatusBar {
  private model = "";
  private sessionId = "";
  private mode = "default";
  private usage: UsageStats = { inputTokens: 0, outputTokens: 0 };
  private fields: StatusBarField[] = DEFAULT_FIELDS;
  private enabled: boolean;
  private cwd = "";
  private branch = "";

  constructor() {
    this.enabled = true; // 始终启用状态栏
  }

  init(model: string, sessionId: string, cwd: string, mode?: string): void {
    this.model = model;
    this.sessionId = sessionId;
    this.cwd = cwd;
    if (mode) this.mode = mode;
  }

  update(usage: UsageStats): void {
    this.usage = usage;
  }

  updateModel(model: string): void {
    this.model = model;
  }

  updateMode(mode: string): void {
    this.mode = mode;
  }

  updateBranch(branch: string): void {
    this.branch = branch;
  }

  setFields(fields: StatusBarField[]): void {
    this.fields = fields;
  }

  /** Build the status string (no newline). */
  getStatusLine(): string {
    if (!this.enabled) return "";

    const parts: string[] = [];

    // Project name (directory name)
    const projectName = this.cwd.split('/').filter(Boolean).pop() || 'xiaok';
    parts.push(projectName);

    // Model name
    parts.push(this.model);

    // Branch (if set)
    if (this.branch) {
      parts.push(this.branch);
    }

    if (this.mode && this.mode !== "default") {
      parts.push(this.mode);
    }

    // Token usage: "26%"
    if (this.usage.budget && this.usage.budget > 0) {
      const total = this.usage.inputTokens + this.usage.outputTokens;
      const pct = Math.round((total / this.usage.budget) * 100);
      parts.push(`${pct}%`);
    }

    return dim(parts.join(' · '));
  }

  /** Print the status bar as simple text (no ANSI positioning). */
  render(): void {
    if (!this.enabled) return;
    const statusLine = this.getStatusLine();
    if (!statusLine) return;
    // 简单输出，不使用 ANSI 定位，避免干扰输入框
    process.stdout.write(statusLine + '\n');
  }

  /** No-op — no terminal state to restore in inline mode. */
  destroy(): void {}
}
