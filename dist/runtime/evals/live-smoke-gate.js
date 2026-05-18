import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export function createDefaultAheLiveSmokeChecks() {
    return [
        {
            id: 'tmux',
            label: 'tmux TTY e2e',
            command: ['python3', 'tests/e2e/tmux-e2e.py'],
            timeoutMs: 10 * 60_000,
        },
        {
            id: 'desktop-ipc',
            label: 'Desktop trace/diagnose IPC',
            command: ['npm', '--prefix', 'desktop', 'test', '--', 'tests/main/ahe-lite-live-ipc.test.ts'],
            timeoutMs: 120_000,
        },
        {
            id: 'kswarm-restart',
            label: 'KSwarm restart continuity IPC',
            command: ['npm', '--prefix', 'desktop', 'test', '--', 'tests/main/ahe-lite-live-ipc.test.ts'],
            timeoutMs: 120_000,
        },
    ];
}
export async function runAheLiveSmokeGate(input) {
    const now = input.now ?? (() => new Date());
    mkdirSync(dirname(input.outputPath), { recursive: true });
    const results = input.skipReason
        ? input.checks.map((check) => ({
            id: check.id,
            label: check.label,
            command: check.command,
            ok: false,
            failureClass: 'skipped',
            durationMs: 0,
            exitCode: null,
            stdoutPreview: '',
            stderrPreview: input.skipReason,
        }))
        : await Promise.all(input.checks.map(runCheck));
    const recommendation = classifyRecommendation(results, input.skipReason);
    const summary = {
        schemaVersion: 1,
        generatedAt: now().toISOString(),
        recommendation,
        skipReason: input.skipReason,
        results,
    };
    writeFileSync(input.outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    return summary;
}
async function runCheck(check) {
    const startedAt = Date.now();
    const commandResult = check.run
        ? await check.run()
        : await runCommand(check.command, check.timeoutMs ?? 120_000);
    const durationMs = commandResult.durationMs || Math.max(1, Date.now() - startedAt);
    const failureClass = classifyResult(commandResult);
    return {
        id: check.id,
        label: check.label,
        command: check.command,
        ok: failureClass === 'pass',
        failureClass,
        durationMs,
        exitCode: commandResult.exitCode,
        stdoutPreview: commandResult.stdout.slice(0, 4_000),
        stderrPreview: commandResult.stderr.slice(0, 4_000),
    };
}
function classifyRecommendation(results, skipReason) {
    if (skipReason || results.some((result) => result.failureClass === 'skipped' || result.failureClass === 'infra' || result.failureClass === 'timeout')) {
        return results.some((result) => result.failureClass === 'product') ? 'revise' : 'inconclusive';
    }
    return results.every((result) => result.ok) ? 'ship' : 'revise';
}
function classifyResult(result) {
    if (result.timedOut)
        return 'timeout';
    if (result.exitCode === 0)
        return 'pass';
    const text = `${result.stdout}\n${result.stderr}`;
    if (/(command not found|not found\. Install|Cannot find module|ERR_MODULE_NOT_FOUND|ECONNREFUSED|EADDRINUSE|no such file or directory|spawn .* ENOENT|PermissionError:.*Operation not permitted)/i.test(text)) {
        return 'infra';
    }
    return 'product';
}
function runCommand(command, timeoutMs) {
    const [bin, ...args] = command;
    const startedAt = Date.now();
    return new Promise((resolve) => {
        if (!bin) {
            resolve({ exitCode: 1, stdout: '', stderr: 'empty command', durationMs: 0 });
            return;
        }
        const child = spawn(bin, args, {
            cwd: process.cwd(),
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const timer = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            child.kill('SIGTERM');
            resolve({
                exitCode: 124,
                stdout,
                stderr,
                durationMs: Date.now() - startedAt,
                timedOut: true,
            });
        }, timeoutMs);
        child.stdout?.on('data', (chunk) => {
            stdout += String(chunk);
        });
        child.stderr?.on('data', (chunk) => {
            stderr += String(chunk);
        });
        child.on('error', (error) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve({
                exitCode: 1,
                stdout,
                stderr: `${stderr}${error.message}`,
                durationMs: Date.now() - startedAt,
            });
        });
        child.on('close', (code) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve({
                exitCode: code,
                stdout,
                stderr,
                durationMs: Date.now() - startedAt,
            });
        });
    });
}
