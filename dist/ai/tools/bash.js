import { measureCollector, observationMetricsEnabled } from '../../runtime/trace/observation-metrics.js';
import { spawn } from 'child_process';
import { truncateText } from './truncation.js';
import { classifyBashCommand } from './bash-safety.js';
import { StringDecoder } from 'node:string_decoder';
import { beginToolObservation } from '../../runtime/sol-pi/collector-port.js';
const DEFAULT_TIMEOUT_MS = 30_000;
const WINDOWS_ELEVATION_OUTPUT_PATTERNS = [
    /需要管理员权限/i,
    /以管理员身份运行/i,
    /请手动运行/i,
    /requested operation requires elevation/i,
    /requires?\s+(?:administrator|admin|elevat)/i,
    /(?:administrator|admin|elevat)\s+(?:privileges|rights|permissions?)\s+(?:are\s+)?required/i,
    /run\s+(?:manually\s+)?as\s+administrator/i,
];
function outputRequestsWindowsElevation(output) {
    return WINDOWS_ELEVATION_OUTPUT_PATTERNS.some(pattern => pattern.test(output));
}
function terminateChildProcessTree(child) {
    if (process.platform === 'win32' && child.pid) {
        try {
            const killer = spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], {
                stdio: 'ignore', windowsHide: true, detached: true,
            });
            killer.on('error', () => { child.kill('SIGKILL'); });
            killer.unref();
            return;
        }
        catch {
            child.kill('SIGKILL');
            return;
        }
    }
    const kill = (signal) => {
        try {
            if (child.pid)
                process.kill(-child.pid, signal);
            else
                child.kill(signal);
        }
        catch (error) {
            if (error.code !== 'ESRCH')
                child.kill(signal);
        }
    };
    kill('SIGKILL');
}
export const bashTool = {
    permission: 'bash',
    definition: {
        name: 'bash',
        get description() {
            const shell = process.platform === 'win32'
                ? '当前执行环境是 Windows cmd /c，命令须使用 cmd 语法。POSIX 单引号、heredoc 和 PowerShell cmdlet 不能直接使用；需要其他解释器时须显式调用并确认已安装。'
                : '当前执行环境是 sh -c，命令须使用 POSIX sh 语法。';
            return `执行 shell 命令，返回 stdout + stderr。${shell}文件内容搜索优先使用 grep 工具，定位文件使用 glob，读取文件使用 read。慎用：所有 shell 命令均视为潜在危险操作。sudo 在主 CLI 的本地交互终端执行；密码只能由用户在终端输入，严禁通过聊天或工具参数索取、传递密码。`;
        },
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', description: '要执行的 shell 命令' },
                timeout_ms: { type: 'number', description: `超时毫秒数（默认 ${DEFAULT_TIMEOUT_MS}）` },
                workdir: { type: 'string', description: '命令执行目录（可选，默认当前目录）' },
                max_chars: { type: 'number', description: '输出字符上限（默认 12000）' },
            },
            required: ['command'],
        },
    },
    async execute(input, context) {
        context?.signal?.throwIfAborted();
        const { command, timeout_ms = DEFAULT_TIMEOUT_MS, workdir = process.cwd(), max_chars = 12_000 } = input;
        const risk = classifyBashCommand(command);
        if (risk.level === 'block') {
            await context?.compoundPhase?.rejected?.({ toolName: 'bash', reason: 'risk_policy' });
            return `Error: 命令被安全策略拦截: ${risk.reason}`;
        }
        if (/\bsudo\b/.test(command)) {
            await context?.compoundPhase?.rejected?.({ toolName: 'bash', reason: 'interactive_sudo' });
            return 'Error: sudo 需要主 CLI 的本地交互终端；请交由主会话执行，或在终端使用 !sudo 命令。';
        }
        await context?.compoundPhase?.beforeCommandStart?.({ command, workdir });
        context?.signal?.throwIfAborted();
        context?.assertPermissionApproval?.();
        if (context?.compoundPhase) {
            if (!context.compoundPhase.executeIsolatedCommand)
                throw Error('compound_isolated_execution_required');
            return context.compoundPhase.executeIsolatedCommand(Object.freeze({ command, workdir, timeoutMs: timeout_ms, maxChars: max_chars }), () => { context.signal?.throwIfAborted(); context.assertPermissionApproval?.(); });
        }
        return new Promise((resolve, reject) => {
            const shell = process.platform === 'win32' ? 'cmd' : 'sh';
            // cmd consumes shell text, not CRT-escaped argv. /s strips only our outer quotes.
            const shellArgs = process.platform === 'win32' ? ['/d', '/s', '/c', `"${command}"`] : ['-c', command];
            const child = spawn(shell, shellArgs, {
                cwd: workdir, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
                windowsVerbatimArguments: process.platform === 'win32',
                // Piped stdio alone still lets PowerShell mutate the parent console.
                windowsHide: true,
            });
            const observation = beginToolObservation(context?.observationCollector, {
                toolName: 'bash', source: { command, workdir },
            });
            const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
            const collectMetrics = observationMetricsEnabled();
            const collectionStarted = collectMetrics ? performance.now() : 0;
            let collectedBytes = 0;
            let collectedChunks = 0;
            let settled = false;
            let aborted = false;
            let terminationResult;
            let terminationKind;
            const onAbort = () => {
                if (settled || aborted)
                    return;
                aborted = true;
                terminateChildProcessTree(child);
            };
            let timer;
            const finish = (result, exitCode, terminalExited = false) => {
                if (settled) {
                    return;
                }
                settled = true;
                observation.append(decoders.stdout.end());
                observation.append(decoders.stderr.end());
                observation.finalize({ executionState: terminalExited ? 'terminal' : 'termination_pending',
                    ...(terminalExited ? { outcome: aborted ? 'cancelled' : terminationKind ?? (exitCode === 0 ? 'success' : 'error') } : {}),
                    ...(aborted ? { incompleteReason: 'cancelled' } : terminationKind ? { incompleteReason: terminationKind === 'timeout' ? 'timeout' : 'terminated_for_elevation' }
                        : !terminalExited ? { incompleteReason: 'termination_unconfirmed' } : {}),
                });
                if (collectMetrics)
                    measureCollector({ invocationId: context?.toolInvocationId, bytes: collectedBytes, chunks: collectedChunks,
                        durationMs: performance.now() - collectionStarted, terminalExited, interrupted: aborted || terminationResult !== undefined });
                context?.signal?.removeEventListener('abort', onAbort);
                if (timer) {
                    clearTimeout(timer);
                }
                const complete = () => {
                    if (aborted) {
                        reject(context?.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
                        return;
                    }
                    if (context?.toolInvocationId) {
                        context.runtimeFactSink?.emit({
                            invocationId: context.toolInvocationId,
                            toolName: 'bash',
                            factKind: 'command_result',
                            exitCode,
                        });
                    }
                    resolve(result);
                };
                if (context?.compoundPhase?.commandFinished) {
                    void Promise.resolve().then(() => context.compoundPhase.commandFinished({ exitCode: exitCode ?? null, terminalExited,
                        outcome: aborted ? 'cancelled' : terminationKind === 'timeout' ? 'timeout' : exitCode === 0 ? 'success' : 'error', pid: child.pid ?? null,
                    })).then(complete, reject);
                }
                else
                    complete();
            };
            let stdout = '';
            let stderr = '';
            const handleOutput = (stream, data) => {
                if (!settled)
                    observation.append(decoders[stream].write(data));
                if (collectMetrics) {
                    collectedBytes += data.byteLength;
                    collectedChunks++;
                }
                context?.executionProgress?.progress();
                if (aborted || settled || terminationResult)
                    return;
                const chunk = data.toString();
                if (stream === 'stdout') {
                    stdout += chunk;
                }
                else {
                    stderr += chunk;
                }
                const output = `${stdout}\n${stderr}`;
                if (process.platform === 'win32' && outputRequestsWindowsElevation(output)) {
                    terminationKind = 'error';
                    terminationResult = truncateText(`Error: 命令需要管理员权限，已停止等待。请在管理员 PowerShell 中手动运行该命令。\n${output}`, max_chars).text;
                    terminateChildProcessTree(child);
                }
            };
            child.stdout?.on('data', (d) => handleOutput('stdout', d));
            child.stderr?.on('data', (d) => handleOutput('stderr', d));
            timer = setTimeout(() => {
                if (aborted || terminationResult)
                    return;
                terminationKind = 'timeout';
                terminationResult = truncateText(`Error: 命令超时（>${timeout_ms}ms）\n${stdout}${stderr}`, max_chars).text;
                terminateChildProcessTree(child);
            }, timeout_ms);
            child.on('close', code => {
                if (terminationResult) {
                    finish(terminationResult, null, true);
                    return;
                }
                if (settled) {
                    return;
                }
                const output = [stdout, stderr].filter(Boolean).join('\n').trim();
                if (code !== 0) {
                    finish(truncateText(`Error (exit ${code}): ${output || '（无输出）'}`, max_chars).text, code, true);
                }
                else {
                    finish(truncateText(output || '（命令执行成功，无输出）', max_chars).text, 0, true);
                }
            });
            child.on('error', (error) => {
                if (aborted || terminationResult) {
                    // A failed kill is not evidence that the process exited.
                    console.warn(`BASH_TERMINATION_PENDING: ${String(error)}`);
                    return;
                }
                finish(`Error: ${String(error)}`, null);
            });
            context?.signal?.addEventListener('abort', onAbort, { once: true });
            if (context?.signal?.aborted)
                onAbort();
        });
    },
};
/** Installed only by the interactive CLI host, before sandbox wrapping. */
export function createInteractiveBashTool(run) {
    return { ...bashTool, async execute(input, context) {
            context?.signal?.throwIfAborted();
            const command = String(input.command ?? '');
            if (!/\bsudo\b/.test(command))
                return bashTool.execute(input, context);
            const risk = classifyBashCommand(command);
            if (risk.level === 'block')
                return `Error: 命令被安全策略拦截: ${risk.reason}`;
            return run(input, context);
        } };
}
