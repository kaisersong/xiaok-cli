import { spawn } from 'child_process';
import type { Tool } from '../../types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export const bashTool: Tool = {
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
      },
      required: ['command'],
    },
  },
  async execute(input) {
    const { command, timeout_ms = DEFAULT_TIMEOUT_MS, workdir = process.cwd() } = input as {
      command: string;
      timeout_ms?: number;
      workdir?: string;
    };

    return new Promise(resolve => {
      const shell = process.platform === 'win32' ? 'cmd' : 'sh';
      const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command];
      const child = spawn(shell, shellArgs, { cwd: workdir, stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
      child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));

      let settled = false;
      const finish = (result: string) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        if (process.platform === 'win32' && child.pid) {
          // Fire-and-forget taskkill so timeout resolution is not blocked by process teardown.
          const killer = spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], {
            stdio: 'ignore',
            windowsHide: true,
            detached: true,
          });
          killer.unref();
        } else {
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 2000);
        }
        finish(`Error: 命令超时（>${timeout_ms}ms）\n${stdout}${stderr}`);
      }, timeout_ms);

      child.on('close', code => {
        if (settled) {
          return;
        }
        const output = [stdout, stderr].filter(Boolean).join('\n').trim();
        if (code !== 0) {
          finish(`Error (exit ${code}): ${output || '（无输出）'}`);
        } else {
          finish(output || '（命令执行成功，无输出）');
        }
      });

      child.on('error', (error) => {
        finish(`Error: ${String(error)}`);
      });
    });
  },
};
