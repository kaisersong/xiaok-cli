// ANSI color helpers — no dependencies
// Respects NO_COLOR (https://no-color.org) and --no-color flag

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = join(__dirname, '../../data/logo.txt');

let colorsEnabled =
  process.stdout.isTTY !== false &&
  !process.env.NO_COLOR &&
  !process.argv.includes("--no-color");

const defaultColorsEnabled = colorsEnabled;

export function setColorsEnabled(enabled: boolean): void {
  colorsEnabled = enabled;
}

// ── Theme ──

export type Theme = "default" | "minimal" | "plain";

let currentTheme: Theme = "default";

export function getTheme(): Theme {
  return currentTheme;
}

export function setTheme(theme: Theme): void {
  currentTheme = theme;
  colorsEnabled = theme === "plain" ? false : defaultColorsEnabled;
}

// ── Verbose toggle ──

let verboseOutput = false;

export function isVerbose(): boolean {
  return verboseOutput;
}

export function toggleVerbose(): boolean {
  verboseOutput = !verboseOutput;
  return verboseOutput;
}

const esc = (code: string) => (s: string) =>
  colorsEnabled ? `\x1b[${code}m${s}\x1b[0m` : s;

export const dim = esc("2");
export const bold = esc("1");
export const red = esc("31");
export const green = esc("32");
export const yellow = esc("33");
export const cyan = esc("36");
export const magenta = esc("35");
export const blue = esc("34");
export const boldCyan = (s: string) =>
  colorsEnabled ? `\x1b[1;36m${s}\x1b[0m` : s;
export const boldMagenta = (s: string) =>
  colorsEnabled ? `\x1b[1;35m${s}\x1b[0m` : s;
export const boldGreen = (s: string) =>
  colorsEnabled ? `\x1b[1;32m${s}\x1b[0m` : s;
export const boldYellow = (s: string) =>
  colorsEnabled ? `\x1b[1;33m${s}\x1b[0m` : s;
export const bgCyan = (s: string) =>
  colorsEnabled ? `\x1b[46;30m${s}\x1b[0m` : s;
export const dimCyan = (s: string) =>
  colorsEnabled ? `\x1b[2;36m${s}\x1b[0m` : s;
export const bgGray = (s: string) =>
  colorsEnabled ? `\x1b[48;5;240m${s}\x1b[0m` : s;
export const bgDarkGray = (s: string) =>
  colorsEnabled ? `\x1b[48;5;235m${s}\x1b[0m` : s;

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function startSpinner(message: string): () => void {
  if (!colorsEnabled) {
    process.stderr.write(`  ${message}\n`);
    return () => {};
  }

  let i = 0;
  const interval = setInterval(() => {
    process.stderr.write(`\r\x1b[2K    ${dimCyan(SPINNER_FRAMES[i++ % SPINNER_FRAMES.length])} ${dim(message)}`);
  }, 80);

  return () => {
    clearInterval(interval);
    process.stderr.write("\r\x1b[2K");
  };
}

// ── Box drawing ──

function boxHeader(label: string, detail?: string): string {
  const detailStr = detail ? ` ${dim(detail)}` : "";
  return `  ${dimCyan("╭─")} ${boldCyan(label)}${detailStr}`;
}

function boxLine(content: string): string {
  return `  ${dimCyan("│")} ${content}`;
}

function boxFooter(): string {
  return `  ${dimCyan("╰─")}`;
}

export function renderError(message: string): void {
  process.stderr.write(`\n${red("Error:")} ${message}\n`);
}

// 计算字符串的显示宽度（中文字符算2个宽度）
function displayWidth(str: string): number {
  // 移除 ANSI 转义序列
  const clean = str.replace(/\x1b\[[0-9;]*m/g, "");
  let width = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    // 中文字符范围
    if (code >= 0x4e00 && code <= 0x9fff) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

export function renderWelcomeScreen(opts: {
  model: string;
  cwd: string;
  sessionId: string;
  mode: string;
}): number {
  const cols = process.stdout.columns ?? 80;
  const totalWidth = Math.min(cols - 2, 100);
  const leftWidth = 32;
  const rightWidth = totalWidth - leftWidth - 1;

  const line = (left: string, right: string) => {
    const leftPart = left.padEnd(leftWidth, " ");
    const rightPart = right.padEnd(rightWidth, " ");
    return dim("│") + leftPart + dim("│") + rightPart + dim("│");
  };

  // 从文件读取 logo
  let logo: string[] = [];
  if (existsSync(LOGO_PATH)) {
    const logoContent = readFileSync(LOGO_PATH, 'utf-8');
    logo = logoContent.split('\n').filter(line => line.length > 0);
  } else {
    // 如果文件不存在，使用默认 logo
    logo = [
      "  .-------.",
      " /         \\",
      " |  []   []  |",
      " |           |",
      " \\         /",
      "  '-------'"
    ];
  }

  const tips = [
    boldYellow("快速开始指南"),
    dim("• 输入问题开始对话"),
    dim("• 使用 /exit 退出"),
    dim("• 支持 Markdown 和代码高亮"),
    "",
    ""
  ];

  let lineCount = 0;

  console.log();
  lineCount++;
  console.log(dim("╭") + dim("─".repeat(leftWidth)) + dim("┬") + dim("─".repeat(rightWidth)) + dim("╮"));
  lineCount++;

  // Welcome
  const welcome = "欢迎使用 xiaok code!";
  const welcomeWidth = displayWidth(welcome);
  const welcomePad = Math.floor((leftWidth - welcomeWidth) / 2);
  const welcomeLeft = " ".repeat(welcomePad) + boldCyan(welcome) + " ".repeat(leftWidth - welcomePad - welcomeWidth);
  console.log(line(welcomeLeft, ""));
  lineCount++;

  // Logo and tips
  for (let i = 0; i < logo.length; i++) {
    const logoPad = Math.floor((leftWidth - logo[i].length) / 2);
    const logoLine = " ".repeat(logoPad) + cyan(logo[i]) + " ".repeat(leftWidth - logoPad - logo[i].length);

    const tip = tips[i] || "";
    const tipWidth = displayWidth(tip);
    const tipLine = " " + tip + " ".repeat(rightWidth - tipWidth - 1);

    console.log(dim("│") + logoLine + dim("│") + tipLine + dim("│"));
    lineCount++;
  }

  console.log(dim("├") + dim("─".repeat(leftWidth)) + dim("┼") + dim("─".repeat(rightWidth)) + dim("┤"));
  lineCount++;

  // Bottom info
  const modelInfo = `${opts.model} · ${opts.mode}`;
  const sessionInfo = `Session: ${opts.sessionId}`;
  const sessionWidth = displayWidth(sessionInfo);

  const modelLine = " " + dim(modelInfo) + " ".repeat(leftWidth - modelInfo.length - 1);
  const sessionLine = " " + dim(sessionInfo) + " ".repeat(rightWidth - sessionWidth - 1);
  console.log(dim("│") + modelLine + dim("│") + sessionLine + dim("│"));
  lineCount++;

  const cwdShort = opts.cwd.length > leftWidth - 2 ? "..." + opts.cwd.slice(-(leftWidth - 5)) : opts.cwd;
  const cwdLine = " " + dim(cwdShort) + " ".repeat(leftWidth - cwdShort.length - 1);
  console.log(dim("│") + cwdLine + dim("│") + " ".repeat(rightWidth) + dim("│"));
  lineCount++;

  console.log(dim("╰") + dim("─".repeat(leftWidth)) + dim("┴") + dim("─".repeat(rightWidth)) + dim("╯"));
  lineCount++;
  console.log();
  lineCount++;

  return lineCount;
}

export function renderInputSeparator(): void {
  const cols = process.stdout.columns ?? 80;
  const totalWidth = Math.min(cols - 2, 100);
  const line = dim("─".repeat(totalWidth));
  process.stdout.write(`${line}\n`);
}

export function renderInputPrompt(): void {
  process.stdout.write(boldCyan('> '));
}

export function renderUserInput(text: string): void {
  process.stdout.write(`${bgDarkGray(` ${text} `)}\n`);
}

export function renderBanner(opts: {
  model: string;
  cwd: string;
  sessionId: string;
  mode: string;
}): void {
  const w = Math.min(process.stdout.columns ?? 60, 60);
  const line = "─".repeat(w - 4);

  console.log();
  console.log(`  ${dimCyan(line)}`);
  console.log();
  console.log(`  ${boldCyan("◆")} ${bold("xiaok code")} ${dim(`(${opts.model})`)}`);
  console.log();

  const info: [string, string][] = [
    ["cwd", opts.cwd],
    ["session", opts.sessionId],
    ["mode", opts.mode],
  ];

  const maxLabel = Math.max(...info.map(([k]) => k.length));
  for (const [label, value] of info) {
    console.log(`  ${dimCyan("│")} ${dim(label.padEnd(maxLabel))}  ${dim(value)}`);
  }

  console.log();
  console.log(`  ${dim("输入")} ${boldCyan("/exit")} ${dim("或 Ctrl-C 退出")}`);
  console.log(`  ${dimCyan(line)}`);
  console.log();
}
