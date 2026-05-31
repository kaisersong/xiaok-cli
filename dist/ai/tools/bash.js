import { spawn } from 'child_process';
import { truncateText } from './truncation.js';
import { classifyBashCommand } from './bash-safety.js';
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
            // Fire-and-forget taskkill so result resolution is not blocked by process teardown.
            const killer = spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], {
                stdio: 'ignore',
                windowsHide: true,
                detached: true,
            });
            killer.unref();
            return;
        }
        catch {
            // Fall back to killing the shell process itself if taskkill cannot start.
        }
    }
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 2000);
}
export const bashTool = {
    permission: 'bash',
    definition: {
        name: 'bash',
        description: '执行 shell 命令，返回 stdout + stderr。慎用：所有 bash 命令均视为潜在危险操作。',
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
    async execute(input) {
        const { command, timeout_ms = DEFAULT_TIMEOUT_MS, workdir = process.cwd(), max_chars = 12_000 } = input;
        const risk = classifyBashCommand(command);
        if (risk.level === 'block') {
            return `Error: 命令被安全策略拦截: ${risk.reason}`;
        }
        return new Promise(resolve => {
            const shell = process.platform === 'win32' ? 'cmd' : 'sh';
            const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command];
            const child = spawn(shell, shellArgs, { cwd: workdir, stdio: ['ignore', 'pipe', 'pipe'] });
            let settled = false;
            let timer;
            const finish = (result) => {
                if (settled) {
                    return;
                }
                settled = true;
                if (timer) {
                    clearTimeout(timer);
                }
                resolve(result);
            };
            let stdout = '';
            let stderr = '';
            const handleOutput = (stream, data) => {
                const chunk = data.toString();
                if (stream === 'stdout') {
                    stdout += chunk;
                }
                else {
                    stderr += chunk;
                }
                const output = `${stdout}\n${stderr}`;
                if (process.platform === 'win32' && outputRequestsWindowsElevation(output)) {
                    terminateChildProcessTree(child);
                    finish(truncateText(`Error: 命令需要管理员权限，已停止等待。请在管理员 PowerShell 中手动运行该命令。\n${output}`, max_chars).text);
                }
            };
            child.stdout?.on('data', (d) => handleOutput('stdout', d));
            child.stderr?.on('data', (d) => handleOutput('stderr', d));
            timer = setTimeout(() => {
                terminateChildProcessTree(child);
                finish(truncateText(`Error: 命令超时（>${timeout_ms}ms）\n${stdout}${stderr}`, max_chars).text);
            }, timeout_ms);
            child.on('close', code => {
                if (settled) {
                    return;
                }
                const output = [stdout, stderr].filter(Boolean).join('\n').trim();
                if (code !== 0) {
                    finish(truncateText(`Error (exit ${code}): ${output || '（无输出）'}`, max_chars).text);
                }
                else {
                    finish(truncateText(output || '（命令执行成功，无输出）', max_chars).text);
                }
            });
            child.on('error', (error) => {
                finish(`Error: ${String(error)}`);
            });
        });
    },
};
