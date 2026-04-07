import { dim, boldCyan, dimCyan } from "./render.js";
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type StatusBarField = "model" | "mode" | "tokens" | "session";

const DEFAULT_FIELDS: StatusBarField[] = ["model", "mode", "tokens", "session"];
const VALID_FIELDS = new Set<StatusBarField>(DEFAULT_FIELDS);

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface StatusBarOptions {
  contextLimit?: number; // Model-specific context window
}

const LIVE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const LIVE_RENDER_DELAY_MS = 600;
const REASSURANCE_INTERVAL_MS = 20_000;

interface ActivityState {
  label: string;
  startedAt: number;
}

interface ReassuranceTick {
  bucket: number;
  line: string;
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
  private contextLimit: number = 200_000; // Default to 200K, updated based on model
  private fields: StatusBarField[] = DEFAULT_FIELDS;
  private enabled: boolean;
  private cwd = "";
  private branch = "";
  private activity: ActivityState | null = null;

  constructor() {
    this.enabled = true; // 始终启用状态栏
  }

  init(model: string, sessionId: string, cwd: string, mode?: string, options?: StatusBarOptions): void {
    this.model = model;
    this.sessionId = sessionId;
    this.cwd = cwd;
    this.fields = loadConfiguredFields(cwd) ?? DEFAULT_FIELDS;
    if (mode) this.mode = mode;
    if (options?.contextLimit) this.contextLimit = options.contextLimit;
    // 根据模型名称自动推断 context limit
    if (!options?.contextLimit) {
      this.contextLimit = inferContextLimitFromModel(model);
    }
  }

  update(usage: UsageStats): void {
    this.usage = usage;
  }

  updateModel(model: string): void {
    this.model = model;
    // 更新模型时同时更新 context limit
    this.contextLimit = inferContextLimitFromModel(model);
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

  beginActivity(label: string, startedAt = Date.now()): void {
    if (!this.activity) {
      this.activity = { label, startedAt };
      return;
    }

    this.activity.label = label;
  }

  updateActivity(label: string): void {
    if (!this.activity) {
      this.beginActivity(label);
      return;
    }

    this.activity.label = label;
  }

  endActivity(): void {
    this.activity = null;
  }

  getActivityLabel(): string {
    return this.activity?.label ?? '';
  }

  /** Build the status string (no newline). */
  getStatusLine(): string {
    if (!this.enabled) return "";

    const text = this.getStatusText();
    return text ? dim(text) : "";
  }

  getLiveStatusLine(now = Date.now(), frameIndex = 0): string {
    if (!this.enabled || !this.activity) return "";

    const elapsedMs = Math.max(0, now - this.activity.startedAt);
    if (elapsedMs < LIVE_RENDER_DELAY_MS) {
      return "";
    }

    const frame = LIVE_FRAMES[frameIndex % LIVE_FRAMES.length] ?? LIVE_FRAMES[0];
    const elapsed = formatElapsed(elapsedMs);
    const statusText = this.getStatusText();
    const label = resolveActivityLabel(this.activity.label, elapsedMs);
    const parts = [`${dimCyan(frame)} ${boldCyan(label)}`, dim(elapsed)];
    if (statusText) {
      parts.push(dim(statusText));
    }

    return parts.join(dim(' · '));
  }

  getReassuranceTick(now = Date.now(), lastBucket = -1): ReassuranceTick | null {
    if (!this.enabled || !this.activity) return null;

    const elapsedMs = Math.max(0, now - this.activity.startedAt);
    if (elapsedMs < REASSURANCE_INTERVAL_MS) {
      return null;
    }

    const bucket = Math.floor(elapsedMs / REASSURANCE_INTERVAL_MS);
    if (bucket <= lastBucket) {
      return null;
    }

    return {
      bucket,
      line: `Still working: ${resolveReassuranceDetail(this.activity.label, elapsedMs)} (${formatElapsed(elapsedMs)})`,
    };
  }

  renderLive(now = Date.now(), frameIndex = 0): void {
    const line = this.getLiveStatusLine(now, frameIndex);
    if (!line) return;
    process.stderr.write(`\r\x1b[2K${line}`);
  }

  clearLive(): void {
    process.stderr.write('\r\x1b[2K');
  }

  private getStatusText(): string {
    const parts: string[] = [];
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
      if (field === "tokens" && this.contextLimit > 0) {
        const total = this.usage.inputTokens + this.usage.outputTokens;
        const pct = Math.round((total / this.contextLimit) * 100);
        parts.push(`${pct}%`);
      }
    }

    if (!this.fields.includes("mode") && this.branch) {
      parts.push(this.branch);
    } else if (this.fields.includes("mode") && this.fields.includes("session") && this.branch) {
      parts.splice(Math.min(parts.length, 2), 0, this.branch);
    }

    return parts.join(' · ');
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

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }

  return `${seconds}s`;
}

/**
 * Infer context limit from model name.
 * Matches the logic in resolveModelCapabilities from model-capabilities.ts.
 */
function inferContextLimitFromModel(modelName: string): number {
  if (/^claude-opus/i.test(modelName)) {
    return 1_000_000; // Claude Opus 4.5/4.6 has 1M context
  }

  if (/^claude-.*(sonnet|haiku)/i.test(modelName)) {
    return 200_000; // Claude Sonnet/Haiku has 200K context
  }

  if (/^(gpt-|o[1-9]|chatgpt)/i.test(modelName)) {
    return 128_000; // GPT-4 family has 128K context
  }

  return 200_000; // Default fallback
}

function resolveActivityLabel(label: string, elapsedMs: number): string {
  if (label === 'Thinking') {
    if (elapsedMs >= 90_000) {
      return 'Finalizing response';
    }
    if (elapsedMs >= 45_000) {
      return 'Working through details';
    }
    if (elapsedMs >= 15_000) {
      return 'Still working';
    }
  }

  if (label === 'Exploring codebase') {
    if (elapsedMs >= 45_000) {
      return 'Tracing references';
    }
    if (elapsedMs >= 20_000) {
      return 'Digging through repo';
    }
  }

  if (label === 'Updating files') {
    if (elapsedMs >= 40_000) {
      return 'Finishing edits';
    }
    if (elapsedMs >= 15_000) {
      return 'Applying changes';
    }
  }

  if (label === 'Running verification') {
    if (elapsedMs >= 45_000) {
      return 'Checking for regressions';
    }
    if (elapsedMs >= 20_000) {
      return 'Verifying changes';
    }
  }

  if (label === 'Updating skills') {
    if (elapsedMs >= 30_000) {
      return 'Refreshing skill catalog';
    }
    if (elapsedMs >= 12_000) {
      return 'Installing skill updates';
    }
  }

  if (label === 'Exporting presentation') {
    if (elapsedMs >= 40_000) {
      return 'Writing presentation file';
    }
    if (elapsedMs >= 15_000) {
      return 'Packaging slides';
    }
  }

  if (label === 'Inspecting workspace') {
    if (elapsedMs >= 30_000) {
      return 'Reviewing findings';
    }
    if (elapsedMs >= 12_000) {
      return 'Scanning workspace';
    }
  }

  if (label === 'Running command') {
    if (elapsedMs >= 20_000) {
      return 'Waiting for command output';
    }
    if (elapsedMs >= 8_000) {
      return 'Executing command';
    }
  }

  if (label === 'Working') {
    if (elapsedMs >= 30_000) {
      return 'Making progress';
    }
    if (elapsedMs >= 12_000) {
      return 'Still working';
    }
  }

  return label;
}

function resolveReassuranceDetail(label: string, elapsedMs: number): string {
  if (label === 'Thinking') {
    if (elapsedMs >= 90_000) return 'finalizing the response';
    if (elapsedMs >= 45_000) return 'working through the remaining details';
    return 'thinking through the answer';
  }

  if (label === 'Exploring codebase') {
    if (elapsedMs >= 45_000) return 'tracing code paths and references';
    return 'exploring the codebase';
  }

  if (label === 'Updating files') {
    if (elapsedMs >= 40_000) return 'finishing the edits and checks';
    return 'applying file changes';
  }

  if (label === 'Running verification') {
    if (elapsedMs >= 45_000) return 'checking for regressions';
    return 'running verification';
  }

  if (label === 'Exporting presentation') {
    if (elapsedMs >= 40_000) return 'writing the presentation file';
    if (elapsedMs >= 15_000) return 'packaging slides for export';
    return 'exporting the presentation';
  }

  if (label === 'Updating skills') {
    if (elapsedMs >= 30_000) return 'refreshing the installed skill catalog';
    if (elapsedMs >= 12_000) return 'installing skill updates';
    return 'updating installed skills';
  }

  if (label === 'Inspecting workspace') {
    if (elapsedMs >= 30_000) return 'reviewing the workspace findings';
    if (elapsedMs >= 12_000) return 'scanning the workspace';
    return 'inspecting the workspace';
  }

  if (label === 'Running command') {
    if (elapsedMs >= 20_000) return 'waiting for command output';
    if (elapsedMs >= 8_000) return 'running the command';
    return 'running a local command';
  }

  if (label === 'Working') {
    if (elapsedMs >= 30_000) return 'making steady progress';
    if (elapsedMs >= 12_000) return 'working through the request';
    return 'working on your request';
  }

  if (label === 'Answering') return 'streaming the response';

  return 'working on your request';
}

function loadConfiguredFields(cwd: string): StatusBarField[] | undefined {
  const configDir = process.env.XIAOK_CONFIG_DIR ?? join(homedir(), '.xiaok');
  const settingsPaths = [
    join(configDir, 'settings.json'),
    join(cwd, '.xiaok', 'settings.json'),
  ];

  let configured: StatusBarField[] | undefined;
  for (const path of settingsPaths) {
    if (!existsSync(path)) {
      continue;
    }

    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
        ui?: { statusBar?: { fields?: string[] } };
      };
      const fields = parsed.ui?.statusBar?.fields;
      if (!Array.isArray(fields)) {
        continue;
      }
      const validFields = fields.filter((field): field is StatusBarField => VALID_FIELDS.has(field as StatusBarField));
      if (validFields.length > 0) {
        configured = validFields;
      }
    } catch {}
  }

  return configured;
}
