import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfigDir } from './config.js';
let crashContext = {};
let handlersInstalled = false;
let streamErrorHandler = null;
export function setCrashContext(ctx) {
    crashContext = { ...crashContext, ...ctx };
}
export function setStreamErrorHandler(handler) {
    streamErrorHandler = handler;
}
export async function reportCrash(error) {
    const crashDir = join(getConfigDir(), 'crashes');
    await mkdir(crashDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `crash-${timestamp}.json`;
    const filePath = join(crashDir, fileName);
    const report = {
        time: new Date().toISOString(),
        version: process.env.npm_package_version ?? 'unknown',
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cwd: process.cwd(),
        context: crashContext,
        error: serializeError(error),
    };
    await writeFile(filePath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    return filePath;
}
function serializeError(error) {
    if (error instanceof Error) {
        return {
            type: error.constructor.name,
            message: error.message,
            stack: error.stack,
            cause: error.cause instanceof Error ? serializeError(error.cause) : error.cause,
        };
    }
    return { type: typeof error, value: String(error) };
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
        if (isBrokenPipeError(error) && shouldSilentlyExitOnBrokenPipe()) {
            process.exit(0);
            return;
        }
        try {
            const path = await reportCrash(error);
            console.error(`\n[xiaok] ${label} — 崩溃报告已保存: ${path}`);
        }
        catch {
            console.error(`\n[xiaok] ${label} — 保存崩溃报告失败`);
            console.error(error);
        }
        process.exit(1);
    };
    process.on('uncaughtException', (err) => handle('未捕获的异常', err));
    process.on('unhandledRejection', (reason) => handle('未处理的 Promise 拒绝', reason));
}
