import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
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
    const xiaokDir = join(homedir(), '.xiaok');
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
function write(level, module, args) {
    if (levels[level] < levels[minLevel])
        return;
    const line = format(level, module, args);
    // Always print to stderr for terminal apps (stdout is for content)
    if (levels[level] >= 3) {
        process.stderr.write(line + '\n');
    }
    else if (levels[level] >= 2) {
        process.stderr.write(line + '\n');
    }
    else {
        // debug/info only when XIAOK_LOG is set
        if (process.env.XIAOK_LOG) {
            process.stderr.write(line + '\n');
        }
    }
    // Append to log file
    try {
        appendFileSync(logFilePath(), line + '\n');
        // Also keep a recent copy in /tmp for quick access
        appendFileSync(recentLogPath(), line + '\n');
    }
    catch {
        // Log file write failure is not fatal
    }
}
export function createLogger(module) {
    return {
        debug: (...args) => write('debug', module, args),
        info: (...args) => write('info', module, args),
        warn: (...args) => write('warn', module, args),
        error: (...args) => write('error', module, args),
        child: (childModule) => createLogger(`${module}:${childModule}`),
    };
}
// Top-level logger for modules that don't use createLogger
export const log = createLogger('xiaok');
