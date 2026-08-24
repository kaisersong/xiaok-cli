import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { renderTranscriptText } from './transcript-buffer.js';
/** Quote-aware split so `PAGER="less -FX"` works without invoking a shell. */
export function parsePagerCommand(command) {
    const argv = [];
    let current = '';
    let quote = null;
    let started = false;
    for (const char of command) {
        if (quote) {
            if (char === quote)
                quote = null;
            else
                current += char;
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            started = true;
            continue;
        }
        if (/\s/.test(char)) {
            if (started)
                argv.push(current);
            current = '';
            started = false;
            continue;
        }
        current += char;
        started = true;
    }
    if (started)
        argv.push(current);
    return argv;
}
export function isLessFamilyBinary(binary) {
    const base = binary.split(/[\\/]/).pop() ?? binary;
    return base === 'less' || base === 'less.exe';
}
export function buildPagerArgv(pagerEnv, isAvailable) {
    const argv = pagerEnv?.trim() ? parsePagerCommand(pagerEnv) : ['less'];
    if (argv.length === 0)
        return [];
    if (!isAvailable(argv[0]))
        return [];
    if (isLessFamilyBinary(argv[0]) && !argv.includes('-R'))
        argv.push('-R');
    return argv;
}
export async function spawnPagerProcess(argv, filePath) {
    return new Promise((resolve) => {
        const child = spawn(argv[0], [...argv.slice(1), filePath], { stdio: 'inherit', shell: false });
        child.once('error', (error) => {
            resolve({ ok: false, error: error.code ?? error.message });
        });
        child.once('close', (exitCode, signal) => {
            resolve({ ok: true, exitCode, signal });
        });
    });
}
export async function openTranscriptPager(opts) {
    const { buffer, host } = opts;
    const status = host.getStatus();
    if (status !== 'idle') {
        return { action: 'skipped', reason: status };
    }
    if (buffer.isEmpty()) {
        return { action: 'skipped', reason: 'empty' };
    }
    const text = renderTranscriptText(buffer.getEntries());
    const argv = host.getPlatform() === 'win32'
        ? []
        : buildPagerArgv(host.getPager(), (binary) => host.lookupBinary(binary) !== null);
    if (argv.length === 0) {
        host.writeStdout(text);
        return { action: 'printed', reason: 'no-pager' };
    }
    let filePath;
    let directory = null;
    let result;
    let printFallback = false;
    const suspension = host.suspendInput();
    host.endScrollRegion();
    try {
        directory = mkdtempSync(join(host.tempDir ?? tmpdir(), 'xiaok-transcript-'));
        filePath = join(directory, 'transcript.ansi');
        writeFileSync(filePath, text, { encoding: 'utf8', mode: 0o600 });
        const spawnResult = await host.spawnPager(argv, filePath);
        if (spawnResult.ok) {
            result = { action: 'pager', exitCode: spawnResult.exitCode ?? null, signal: spawnResult.signal ?? null };
        }
        else {
            host.logDebug(`transcript pager unavailable: ${spawnResult.error ?? 'unknown error'}`);
            printFallback = true;
            result = { action: 'printed', reason: spawnResult.error ?? 'spawn-failed' };
        }
    }
    catch (error) {
        host.logDebug(`transcript pager failed: ${String(error)}`);
        result = { action: 'error', reason: String(error) };
    }
    finally {
        if (directory) {
            try {
                rmSync(directory, { recursive: true, force: true });
            }
            catch (error) {
                host.logDebug(`transcript pager temp cleanup failed: ${String(error)}`);
            }
        }
        host.resumeScrollRegion();
        suspension.resume();
    }
    if (printFallback) {
        host.writeStdout(text);
    }
    return result;
}
