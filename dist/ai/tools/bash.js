import { spawn, spawnSync } from 'child_process';
const DEFAULT_TIMEOUT_MS = 30_000;
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
            },
            required: ['command'],
        },
    },
    async execute(input) {
        const { command, timeout_ms = DEFAULT_TIMEOUT_MS } = input;
        return new Promise(resolve => {
            const shell = process.platform === 'win32' ? 'cmd' : 'sh';
            const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command];
            const child = spawn(shell, shellArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
            let stdout = '';
            let stderr = '';
            child.stdout?.on('data', (d) => (stdout += d.toString()));
            child.stderr?.on('data', (d) => (stderr += d.toString()));
            let killed = false;
            const timer = setTimeout(() => {
                killed = true;
                if (process.platform === 'win32' && child.pid) {
                    // taskkill /F /T kills the process tree reliably on Windows
                    spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
                }
                else {
                    child.kill('SIGTERM');
                    setTimeout(() => child.kill('SIGKILL'), 2000);
                }
            }, timeout_ms);
            child.on('close', code => {
                clearTimeout(timer);
                if (killed) {
                    resolve(`Error: 命令超时（>${timeout_ms}ms）\n${stdout}${stderr}`);
                    return;
                }
                const output = [stdout, stderr].filter(Boolean).join('\n').trim();
                if (code !== 0) {
                    resolve(`Error (exit ${code}): ${output || '（无输出）'}`);
                }
                else {
                    resolve(output || '（命令执行成功，无输出）');
                }
            });
        });
    },
};
