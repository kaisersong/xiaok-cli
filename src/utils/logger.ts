import { existsSync, mkdirSync, appendFileSync, statSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const levels = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof levels;

// Resolve log level: env var > config > default
function resolveLevel(): Level {
  const env = process.env.XIAOK_LOG;
  if (env && levels[env as Level] !== undefined) return env as Level;
  return 'info';
}

const minLevel = resolveLevel();

// Log file: ~/.xiaok/logs/xiaok.log
function logFilePath(): string {
  const xiaokDir = process.env.XIAOK_CONFIG_DIR ?? join(homedir(), '.xiaok');
  const logsDir = join(xiaokDir, 'logs');
  if (!existsSync(logsDir)) {
    try { mkdirSync(logsDir, { recursive: true }); } catch {}
  }
  return join(logsDir, 'xiaok.log');
}

// Also keep a recent log for quick debugging
function recentLogPath(): string {
  return join(tmpdir(), 'xiaok-recent.log');
}

const DEFAULT_LOG_ROTATE_MAX_BYTES = 32 * 1024 * 1024;

function resolveMaxLogBytes(): number {
  const raw = process.env.XIAOK_LOG_MAX_BYTES;
  if (raw !== undefined && raw !== '') {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_LOG_ROTATE_MAX_BYTES;
}

// Cap runaway log growth (a 2026-09 EIO feedback loop wrote a 129GB xiaok.log):
// rotate to `<path>.1`, keeping a single previous generation; truncate in place
// when rename fails. Checked per write because the log file is shared across
// concurrent xiaok processes, so an in-process byte counter would drift.
function enforceLogSizeCap(path: string): void {
  let size: number;
  try { size = statSync(path).size; } catch { return; }
  if (size <= resolveMaxLogBytes()) return;
  try {
    renameSync(path, `${path}.1`);
  } catch {
    try { writeFileSync(path, ''); } catch { /* best effort */ }
  }
}

function format(level: Level, module: string, args: unknown[]): string {
  const ts = new Date().toISOString();
  const payload = args.map(a => {
    if (a instanceof Error) return a.message + (a.stack ? '\n' + a.stack : '');
    if (typeof a === 'object' && a !== null) {
      try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
  }).join(' ');
  return `[${ts}] [${level}] [${module}] ${payload}`;
}

export interface LoggerOptions { stderr?: boolean }

function write(level: Level, module: string, args: unknown[], options: LoggerOptions) {
  if (levels[level] < levels[minLevel]) return;
  const line = format(level, module, args);

  // Persist before touching a potentially broken terminal.
  try {
    enforceLogSizeCap(logFilePath());
    appendFileSync(logFilePath(), line + '\n');
    // Also keep a recent copy in /tmp for quick access
    enforceLogSizeCap(recentLogPath());
    appendFileSync(recentLogPath(), line + '\n');
  } catch {
    // Log file write failure is not fatal
  }
  if (options.stderr !== false && (levels[level] >= 2 || process.env.XIAOK_LOG)) {
    try { process.stderr.write(line + '\n'); } catch { /* diagnostics must not throw */ }
  }
}

export function createLogger(module: string, options: LoggerOptions = {}) {
  return {
    debug: (...args: unknown[]) => write('debug', module, args, options),
    info: (...args: unknown[]) => write('info', module, args, options),
    warn: (...args: unknown[]) => write('warn', module, args, options),
    error: (...args: unknown[]) => write('error', module, args, options),
    child: (childModule: string) => createLogger(`${module}:${childModule}`, options),
  };
}

// Top-level logger for modules that don't use createLogger
export const log = createLogger('xiaok');
