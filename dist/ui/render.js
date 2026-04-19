// ANSI color helpers — no dependencies
// Respects NO_COLOR (https://no-color.org) and --no-color flag
import { readFileSync, existsSync } from 'fs';
import { basename, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getToolActivityLabel } from './locale.js';
import { getDisplayWidth, stripAnsi } from './display-width.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = join(__dirname, '../../data/logo.txt');
let colorsEnabled = process.stdout.isTTY !== false &&
    !process.env.NO_COLOR &&
    !process.argv.includes("--no-color");
const defaultColorsEnabled = colorsEnabled;
export function setColorsEnabled(enabled) {
    colorsEnabled = enabled;
}
let currentTheme = "default";
export function getTheme() {
    return currentTheme;
}
export function setTheme(theme) {
    currentTheme = theme;
    colorsEnabled = theme === "plain" ? false : defaultColorsEnabled;
}
// ── Verbose toggle ──
let verboseOutput = false;
export function isVerbose() {
    return verboseOutput;
}
export function toggleVerbose() {
    verboseOutput = !verboseOutput;
    return verboseOutput;
}
const esc = (code) => (s) => colorsEnabled ? `\x1b[${code}m${s}\x1b[0m` : s;
export const dim = esc("2");
export const bold = esc("1");
export const red = esc("31");
export const green = esc("32");
export const yellow = esc("33");
export const cyan = esc("36");
export const magenta = esc("35");
export const blue = esc("34");
export const boldCyan = (s) => colorsEnabled ? `\x1b[1;36m${s}\x1b[0m` : s;
export const boldMagenta = (s) => colorsEnabled ? `\x1b[1;35m${s}\x1b[0m` : s;
export const boldGreen = (s) => colorsEnabled ? `\x1b[1;32m${s}\x1b[0m` : s;
export const boldYellow = (s) => colorsEnabled ? `\x1b[1;33m${s}\x1b[0m` : s;
export const bgCyan = (s) => colorsEnabled ? `\x1b[46;30m${s}\x1b[0m` : s;
export const dimCyan = (s) => colorsEnabled ? `\x1b[2;36m${s}\x1b[0m` : s;
export const bgGray = (s) => colorsEnabled ? `\x1b[48;5;240m${s}\x1b[0m` : s;
export const bgDarkGray = (s) => colorsEnabled ? `\x1b[48;5;235m${s}\x1b[0m` : s;
export const bgInputGray = (s) => colorsEnabled ? `\x1b[48;5;238m${s}\x1b[0m` : s;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const RAIL_INDENT = "  ";
function padToDisplayWidth(text, width) {
    const padCount = Math.max(0, width - getDisplayWidth(text));
    return text + ' '.repeat(padCount);
}
function wrapDisplayLine(text, width) {
    if (width <= 0) {
        return [''];
    }
    const wrapped = [];
    let current = '';
    let currentWidth = 0;
    for (const symbol of Array.from(text)) {
        const symbolWidth = Math.max(1, getDisplayWidth(symbol));
        if (current !== '' && currentWidth + symbolWidth > width) {
            wrapped.push(current);
            current = symbol;
            currentWidth = symbolWidth;
            continue;
        }
        current += symbol;
        currentWidth += symbolWidth;
    }
    if (current.length > 0 || wrapped.length === 0) {
        wrapped.push(current);
    }
    return wrapped;
}
export function startSpinner(message) {
    if (!colorsEnabled) {
        process.stderr.write(`  ${message}\n`);
        return () => { };
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
export function formatRailHeader(label, detail) {
    const detailStr = detail ? ` ${dim(detail)}` : "";
    return `${RAIL_INDENT}${dimCyan("╭─")} ${boldCyan(label)}${detailStr}`;
}
export function formatRailLine(content) {
    return `${RAIL_INDENT}${dimCyan("│")} ${content}`;
}
export function formatRailFooter() {
    return `${RAIL_INDENT}${dimCyan("╰─")}`;
}
export function renderError(message) {
    process.stderr.write(`\n${red("Error:")} ${message}\n`);
}
export function renderWelcomeScreen(opts) {
    const cols = process.stdout.columns ?? 80;
    const totalWidth = Math.min(cols - 2, 100);
    const leftWidth = 32;
    const rightWidth = totalWidth - leftWidth - 1;
    // 如果终端太小（小于 50 列），跳过欢迎界面，避免 String.repeat 负数错误
    if (cols < 50 || rightWidth < 0) {
        console.log();
        console.log(boldCyan("欢迎使用 xiaok code!"));
        console.log(dim(`${opts.model} · ${opts.mode} · ${opts.cwd}`));
        console.log();
        // Count actual terminal rows (with wrapping)
        return 1 + 1 + Math.ceil(getDisplayWidth(`${opts.model} · ${opts.mode} · ${opts.cwd}`) / cols) + 1;
    }
    const line = (left, right) => {
        const leftPart = left.padEnd(leftWidth, " ");
        const rightPart = right.padEnd(rightWidth, " ");
        return dim("│") + leftPart + dim("│") + rightPart + dim("│");
    };
    let logo = [];
    if (existsSync(LOGO_PATH)) {
        const logoContent = readFileSync(LOGO_PATH, 'utf-8');
        logo = logoContent.split(/\r?\n/).filter(line => line.length > 0);
    }
    else {
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
    // Count actual terminal rows (accounting for line wrapping)
    function countRows(text) {
        const displayWidth = getDisplayWidth(text);
        return Math.max(1, Math.ceil(displayWidth / cols));
    }
    let rowCount = 0;
    // Blank line
    console.log();
    rowCount += 1;
    // Top border (totalWidth chars, may wrap)
    const topBorder = dim("╭") + dim("─".repeat(leftWidth)) + dim("┬") + dim("─".repeat(rightWidth)) + dim("╮");
    console.log(topBorder);
    rowCount += countRows(stripAnsi(topBorder));
    const welcome = "欢迎使用 xiaok code!";
    const welcomeWidth = getDisplayWidth(welcome);
    const welcomePad = Math.floor((leftWidth - welcomeWidth) / 2);
    const welcomeLeft = " ".repeat(welcomePad) + boldCyan(welcome) + " ".repeat(leftWidth - welcomePad - welcomeWidth);
    const welcomeLine = line(welcomeLeft, "");
    console.log(welcomeLine);
    rowCount += countRows(stripAnsi(welcomeLine));
    for (let i = 0; i < logo.length; i++) {
        const logoPad = Math.floor((leftWidth - logo[i].length) / 2);
        const logoLine = " ".repeat(logoPad) + cyan(logo[i]) + " ".repeat(leftWidth - logoPad - logo[i].length);
        const tip = tips[i] || "";
        const tipWidth = getDisplayWidth(tip);
        const tipLine = " " + tip + " ".repeat(rightWidth - tipWidth - 1);
        console.log(dim("│") + logoLine + dim("│") + tipLine + dim("│"));
        rowCount += countRows(stripAnsi(dim("│") + logoLine + dim("│") + tipLine + dim("│")));
    }
    const midBorder = dim("├") + dim("─".repeat(leftWidth)) + dim("┼") + dim("─".repeat(rightWidth)) + dim("┤");
    console.log(midBorder);
    rowCount += countRows(stripAnsi(midBorder));
    const modelInfo = `${opts.model} · ${opts.mode}`;
    const sessionInfo = `Session: ${opts.sessionId}`;
    const sessionWidth = getDisplayWidth(sessionInfo);
    const versionInfo = `Version: ${opts.version}`;
    const versionWidth = getDisplayWidth(versionInfo);
    const modelLine = " " + dim(modelInfo) + " ".repeat(leftWidth - modelInfo.length - 1);
    const sessionLine = " " + dim(sessionInfo) + " ".repeat(rightWidth - sessionWidth - 1);
    const modelRow = dim("│") + modelLine + dim("│") + sessionLine + dim("│");
    console.log(modelRow);
    rowCount += countRows(stripAnsi(modelRow));
    const cwdShort = opts.cwd.length > leftWidth - 2 ? "..." + opts.cwd.slice(-(leftWidth - 5)) : opts.cwd;
    const cwdLine = " " + dim(cwdShort) + " ".repeat(leftWidth - cwdShort.length - 1);
    const versionLine = " " + dim(versionInfo) + " ".repeat(rightWidth - versionWidth - 1);
    const cwdRow = dim("│") + cwdLine + dim("│") + versionLine + dim("│");
    console.log(cwdRow);
    rowCount += countRows(stripAnsi(cwdRow));
    const botBorder = dim("╰") + dim("─".repeat(leftWidth)) + dim("┴") + dim("─".repeat(rightWidth)) + dim("╯");
    console.log(botBorder);
    rowCount += countRows(stripAnsi(botBorder));
    // Blank line
    console.log();
    rowCount += 1;
    return rowCount;
}
export function renderInputSeparator() {
    const cols = process.stdout.columns ?? 80;
    const totalWidth = Math.min(Math.max(cols - 2, 0), 100);
    if (totalWidth <= 0)
        return; // 终端太小时不渲染分隔线
    const line = dim("─".repeat(totalWidth));
    process.stdout.write(`${line}\n`);
}
export function renderInputPrompt() {
    process.stdout.write(boldCyan('> '));
}
function singleLine(text) {
    return text.replace(/\s+/g, ' ').trim();
}
function truncatePlain(text, maxWidth) {
    if (maxWidth <= 0)
        return '';
    if (text.length <= maxWidth)
        return text;
    if (maxWidth <= 3)
        return '.'.repeat(maxWidth);
    return `${text.slice(0, maxWidth - 3)}...`;
}
const LOW_SIGNAL_TOOL_NAMES = new Set([
    'glob',
    'grep',
    'read',
    'skill',
    'task_create',
    'task_get',
    'task_list',
    'task_update',
    'tool_search',
]);
function extractToolActivityTarget(input) {
    if (typeof input.command === 'string')
        return singleLine(input.command);
    if (typeof input.url === 'string')
        return singleLine(input.url);
    if (typeof input.file_path === 'string')
        return singleLine(input.file_path);
    if (typeof input.path === 'string')
        return singleLine(input.path);
    if (typeof input.pattern === 'string')
        return singleLine(input.pattern);
    if (typeof input.query === 'string')
        return singleLine(input.query);
    return '';
}
export function formatSubmittedInput(text) {
    const termWidth = process.stdout.columns ?? 80;
    const prefix = ' › ';
    const textWidth = Math.max(1, termWidth - getDisplayWidth(prefix));
    const lines = text
        .split(/\r?\n/)
        .flatMap((line) => wrapDisplayLine(line, textWidth));
    return [
        bgDarkGray(' '.repeat(termWidth)),
        ...lines.map((line) => bgDarkGray(padToDisplayWidth(`${prefix}${line}`, termWidth))),
        bgDarkGray(' '.repeat(termWidth)),
    ].join('\n') + '\n';
}
export function formatProgressNote(text) {
    return `  ${dim('·')} ${dim(text)}\n`;
}
export function renderUserInput(text) {
    process.stdout.write(formatSubmittedInput(text));
}
function localizeSummary(locale, zh, en) {
    return locale === 'zh-CN' ? zh : en;
}
function summarizePath(input, verbose) {
    const target = extractToolActivityTarget(input);
    if (!target)
        return '';
    return verbose ? target : basename(target) || target;
}
function summarizeBashCommand(command, locale, verbose) {
    const normalized = singleLine(command);
    if (!normalized)
        return '';
    if (verbose)
        return normalized;
    const lower = normalized.toLowerCase();
    const inspectionPatterns = [
        /^(ls|find|rg|grep|cat|sed|head|tail|pwd)\b/,
        /^git (status|diff|log|show)\b/,
        /^python\d?(?:\s+--version|\s+-m\s+pip\s+--version)\b/,
    ];
    if (inspectionPatterns.some((pattern) => pattern.test(lower))) {
        return '';
    }
    if (lower.includes('export-pptx.py') || /\.pptx\b/.test(lower)) {
        return localizeSummary(locale, '导出 PPT', 'Export PPT');
    }
    if (/^(npm|pnpm|yarn|bun)\s+(test|run test)/.test(lower) || /^(vitest|pytest|go test|cargo test)\b/.test(lower)) {
        return localizeSummary(locale, '运行测试', 'Run tests');
    }
    if (/^git (commit|push|merge|rebase|checkout|switch|tag)\b/.test(lower)) {
        return localizeSummary(locale, '执行 Git 操作', 'Run Git operation');
    }
    if (/^(npm|pnpm|yarn|bun)\s+(install|add)\b/.test(lower) || /^pip(?:3)?\s+install\b/.test(lower)) {
        return localizeSummary(locale, '安装依赖', 'Install dependencies');
    }
    if (/^(python\d?|node|tsx|bun|ruby|perl|sh|bash)\b/.test(lower) || /<<['"]?[a-z_]+['"]?/i.test(normalized) || /cat\s+>/.test(lower)) {
        return '';
    }
    return localizeSummary(locale, '执行本地命令', 'Run local command');
}
export function describeToolActivity(toolName, input, locale = 'zh-CN', verbose = isVerbose()) {
    if (!verbose && LOW_SIGNAL_TOOL_NAMES.has(toolName)) {
        return '';
    }
    const label = getToolActivityLabel(toolName, locale);
    let detail = '';
    if (toolName === 'bash') {
        const command = typeof input.command === 'string' ? input.command : '';
        detail = summarizeBashCommand(command, locale, verbose);
        if (!detail)
            return '';
    }
    else if (toolName === 'write' || toolName === 'edit') {
        detail = summarizePath(input, verbose);
    }
    else if (toolName === 'install_skill' || toolName === 'uninstall_skill') {
        detail = summarizePath(input, verbose) || (typeof input.source === 'string' ? singleLine(input.source) : '');
    }
    else {
        detail = extractToolActivityTarget(input);
    }
    return detail ? `${label} ${detail}` : label;
}
export function formatToolActivity(toolName, input, maxWidth = process.stdout.columns ?? 80, locale = 'zh-CN') {
    const description = describeToolActivity(toolName, input, locale);
    if (!description)
        return '';
    const prefix = '•';
    const available = Math.max(maxWidth - prefix.length - 1, 0);
    const truncated = truncatePlain(description, available);
    return truncated ? `${prefix} ${truncated}` : prefix;
}
// Format a single message block for history display during session resume
export function formatHistoryBlock(block) {
    if (block.type === 'text') {
        // Text blocks are formatted with submitted input styling
        return formatSubmittedInput(block.text);
    }
    if (block.type === 'thinking') {
        // Thinking is hidden during normal interactive use and should stay hidden
        // when replaying persisted session history during resume.
        return '';
    }
    if (block.type === 'tool_use') {
        // Tool use shown as activity summary
        const activity = formatToolActivity(block.name, block.input);
        return activity ? `${dim('  ↳')} ${activity}\n` : '';
    }
    if (block.type === 'tool_result') {
        // Tool result shown as dim summary, truncated to 100 chars
        const summary = block.content.length > 100
            ? block.content.slice(0, 100) + '...'
            : block.content;
        const errorPrefix = block.is_error ? red(' (error)') : '';
        return `${dim('  ↳ Tool result')}${errorPrefix}: ${dim(summary)}\n`;
    }
    if (block.type === 'image') {
        return `${dim('  ↳ [Image]')}\n`;
    }
    // Unknown block type - skip
    return '';
}
export function renderBanner(opts) {
    const w = Math.min(process.stdout.columns ?? 60, 60);
    const line = "─".repeat(w - 4);
    console.log();
    console.log(`  ${dimCyan(line)}`);
    console.log();
    console.log(`  ${boldCyan("◆")} ${bold("xiaok code")} ${dim(`(${opts.model})`)}`);
    console.log();
    const info = [
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
