import { existsSync, mkdirSync, appendFileSync, statSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
const levels = { debug: 0, info: 1, warn: 2, error: 3 };
// Resolve log level: env var > config > default
function resolveLevel() {
    const env = process.env.XIAOK_LOG;
    if (env && levels[env] !== undefined)
        return env;
    return 'info';
}
const minLevel = resolveLevel();
// Log file: ~/.xiaok/logs/xiaok.log
function logFilePath() {
    const xiaokDir = process.env.XIAOK_CONFIG_DIR ?? join(homedir(), '.xiaok');
    const logsDir = join(xiaokDir, 'logs');
    if (!existsSync(logsDir)) {
        try {
            mkdirSync(logsDir, { recursive: true });
        }
        catch { }
    }
    return join(logsDir, 'xiaok.log');
}
// Also keep a recent log for quick debugging
function recentLogPath() {
    return join(tmpdir(), 'xiaok-recent.log');
}
const DEFAULT_LOG_ROTATE_MAX_BYTES = 32 * 1024 * 1024;
function resolveMaxLogBytes() {
    const raw = process.env.XIAOK_LOG_MAX_BYTES;
    if (raw !== undefined && raw !== '') {
        const parsed = Number.parseInt(raw, 10);
        if (Number.isFinite(parsed) && parsed > 0)
            return parsed;
    }
    return DEFAULT_LOG_ROTATE_MAX_BYTES;
}
// Cap runaway log growth (a 2026-09 EIO feedback loop wrote a 129GB xiaok.log):
// rotate to `<path>.1`, keeping a single previous generation; truncate in place
// when rename fails. Checked per write because the log file is shared across
// concurrent xiaok processes, so an in-process byte counter would drift.
function enforceLogSizeCap(path) {
    let size;
    try {
        size = statSync(path).size;
    }
    catch {
        return;
    }
    if (size <= resolveMaxLogBytes())
        return;
    try {
        renameSync(path, `${path}.1`);
    }
    catch {
        try {
            writeFileSync(path, '');
        }
        catch { /* best effort */ }
    }
}
function format(level, module, args) {
    const ts = new Date().toISOString();
    const payload = args.map(a => {
        if (a instanceof Error)
            return a.message + (a.stack ? '\n' + a.stack : '');
        if (typeof a === 'object' && a !== null) {
            try {
                return JSON.stringify(a);
            }
            catch {
                return String(a);
            }
        }
        return String(a);
    }).join(' ');
    return `[${ts}] [${level}] [${module}] ${payload}`;
}
function write(level, module, args, options) {
    if (levels[level] < levels[minLevel])
        return;
    const line = format(level, module, args);
    // Persist before touching a potentially broken terminal.
    try {
        enforceLogSizeCap(logFilePath());
        appendFileSync(logFilePath(), line + '\n');
        // Also keep a recent copy in /tmp for quick access
        enforceLogSizeCap(recentLogPath());
        appendFileSync(recentLogPath(), line + '\n');
    }
    catch {
        // Log file write failure is not fatal
    }
    if (options.stderr !== false && (levels[level] >= 2 || process.env.XIAOK_LOG)) {
        try {
            process.stderr.write(line + '\n');
        }
        catch { /* diagnostics must not throw */ }
    }
}
export function createLogger(module, options = {}) {
    return {
        debug: (...args) => write('debug', module, args, options),
        info: (...args) => write('info', module, args, options),
        warn: (...args) => write('warn', module, args, options),
        error: (...args) => write('error', module, args, options),
        child: (childModule) => createLogger(`${module}:${childModule}`, options),
    };
}
// Top-level logger for modules that don't use createLogger
export const log = createLogger('xiaok');
