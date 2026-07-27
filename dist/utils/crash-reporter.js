import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfigDir } from './config.js';
let crashContext = {};
let handlersInstalled = false;
let streamErrorHandler = null;
let pipeBrokenFromStream = false;
const CRASH_REPORT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SAFE_COMMANDS = new Set([
    'chat',
    'commit',
    'context',
    'diagnose',
    'doctor',
    'init',
    'pr',
    'review',
    'settings',
]);
const SAFE_ERROR_CODES = new Set([
    'EACCES',
    'EADDRINUSE',
    'ECONNREFUSED',
    'ECONNRESET',
    'EEXIST',
    'EIO',
    'EINVAL',
    'ENOENT',
    'ENOMEM',
    'ENOSPC',
    'EPERM',
    'EPIPE',
    'ETIMEDOUT',
]);
/**
 * Provider-private task-local reasoning must never be copied into a Node
 * diagnostic report. Xiaok's structured crash report below is the only
 * supported crash artifact and is intentionally allowlist-only.
 */
export function configureSafeCrashCapture() {
    if (!process.report) {
        return;
    }
    process.report.reportOnFatalError = false;
    process.report.reportOnSignal = false;
    process.report.reportOnUncaughtException = false;
}
export function setCrashContext(ctx) {
    crashContext = { ...crashContext, ...ctx };
}
export function setStreamErrorHandler(handler) {
    streamErrorHandler = handler;
}
export async function reportCrash(error) {
    const crashDir = join(getConfigDir(), 'crashes');
    await mkdir(crashDir, { recursive: true });
    await cleanupExpiredCrashReports(crashDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `crash-${timestamp}.json`;
    const filePath = join(crashDir, fileName);
    const report = {
        time: new Date().toISOString(),
        version: process.env.npm_package_version ?? 'unknown',
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        context: serializeCrashContext(crashContext),
        error: serializeError(error),
    };
    await writeFile(filePath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    return filePath;
}
async function cleanupExpiredCrashReports(crashDir) {
    try {
        const entries = await readdir(crashDir, { withFileTypes: true });
        const now = Date.now();
        await Promise.all(entries.map(async (entry) => {
            if (!entry.isFile() || !entry.name.startsWith('crash-') || !entry.name.endsWith('.json')) {
                return;
            }
            const filePath = join(crashDir, entry.name);
            try {
                const info = await stat(filePath);
                if (now - info.mtimeMs > CRASH_REPORT_RETENTION_MS) {
                    await unlink(filePath);
                }
            }
            catch {
                // Cleanup must never mask the crash that is currently being reported.
            }
        }));
    }
    catch {
        // Cleanup must never mask the crash that is currently being reported.
    }
}
function serializeError(error) {
    const type = error instanceof Error
        ? (error instanceof DOMException
            ? 'DOMException'
            : error instanceof TypeError
                ? 'TypeError'
                : error instanceof RangeError
                    ? 'RangeError'
                    : 'Error')
        : 'NonError';
    const rawCode = typeof error === 'object'
        && error !== null
        && 'code' in error
        && typeof error.code === 'string'
        ? error.code
        : undefined;
    return {
        type,
        code: rawCode && SAFE_ERROR_CODES.has(rawCode)
            ? rawCode
            : 'UNCLASSIFIED_ERROR',
    };
}
function serializeCrashContext(context) {
    const command = context.command && SAFE_COMMANDS.has(context.command)
        ? context.command
        : 'unknown';
    return { command };
}
function isBrokenPipeError(error) {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && error.code === 'EPIPE';
}
function shouldSilentlyExitOnBrokenPipe(stream) {
    if (stream) {
        return stream.isTTY !== true;
    }
    return process.stdout.isTTY !== true;
}
function installBrokenPipeExit(stream) {
    stream.on('error', (error) => {
        if (streamErrorHandler?.(error, stream)) {
            return;
        }
        if (isBrokenPipeError(error)) {
            pipeBrokenFromStream = true;
            if (shouldSilentlyExitOnBrokenPipe(stream)) {
                process.exit(0);
                return;
            }
            setImmediate(() => {
                throw error;
            });
            return;
        }
        setImmediate(() => {
            throw error;
        });
    });
}
export function installGlobalCrashHandlers() {
    if (handlersInstalled) {
        return;
    }
    handlersInstalled = true;
    installBrokenPipeExit(process.stdout);
    installBrokenPipeExit(process.stderr);
    const handle = async (label, error) => {
        if (isBrokenPipeError(error)
            && streamErrorHandler?.(error, process.stdout)) {
            return;
        }
        if (isBrokenPipeError(error)
            && pipeBrokenFromStream
            && shouldSilentlyExitOnBrokenPipe()) {
            process.exit(0);
            return;
        }
        try {
            const path = await reportCrash(error);
            console.error(`\n[xiaok] ${label} — 崩溃报告已保存: ${path}`);
        }
        catch {
            console.error(`\n[xiaok] ${label} — 保存崩溃报告失败`);
        }
        process.exit(1);
    };
    process.on('uncaughtException', (err) => handle('未捕获的异常', err));
    process.on('unhandledRejection', (reason) => handle('未处理的 Promise 拒绝', reason));
}
