import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import type { McpRuntimeRequest, McpRuntimeResponse, McpRuntimeTransport } from './client.js';

export interface McpServerProcess {
  child: ChildProcessWithoutNullStreams;
  dispose(): void;
}

export interface McpServerProcessOptions {
  cwd?: string;
  env?: Record<string, string>;
  platform?: NodeJS.Platform;
}

export function buildMcpServerSpawnOptions(
  command: string,
  opts?: McpServerProcessOptions,
): {
  stdio: 'pipe';
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  windowsVerbatimArguments: boolean;
  windowsHide?: boolean;
} {
  const platform = opts?.platform ?? process.platform;
  return {
    stdio: 'pipe',
    cwd: opts?.cwd,
    env: opts?.env ? { ...process.env, ...opts.env } : undefined,
    windowsVerbatimArguments: platform === 'win32' && command.toLowerCase() === 'cmd.exe',
    ...(platform === 'win32' ? { windowsHide: true } : {}),
  };
}

export function startMcpServerProcess(command: string, args: string[] = [], opts?: McpServerProcessOptions): McpServerProcess {
  const child = spawn(command, args, buildMcpServerSpawnOptions(command, opts));
  return {
    child,
    dispose() {
      child.kill();
    },
  };
}

export function encodeMcpMessage(message: McpRuntimeRequest | McpRuntimeResponse): string {
  const payload = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;
}

export function decodeMcpFrames(input: string): McpRuntimeResponse[] {
  const messages: McpRuntimeResponse[] = [];
  let rest = input;

  while (rest.length > 0) {
    const headerEnd = rest.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      break;
    }

    const header = rest.slice(0, headerEnd);
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      break;
    }

    const length = Number(match[1]);
    const payloadStart = headerEnd + 4;
    const payloadEnd = payloadStart + length;
    if (rest.length < payloadEnd) {
      break;
    }

    messages.push(JSON.parse(rest.slice(payloadStart, payloadEnd)) as McpRuntimeResponse);
    rest = rest.slice(payloadEnd);
  }

  return messages;
}

export function createStdioMcpTransport(
  child: Pick<ChildProcessWithoutNullStreams, 'stdin' | 'stdout' | 'stderr' | 'on' | 'off'>,
): McpRuntimeTransport & { notify(message: { jsonrpc: '2.0'; method: string; params?: Record<string, unknown> }): void; getStderrTail(): string; dispose(): void } {
  let buffer = '';
  let stderrTail = '';
  const STDERR_TAIL_LIMIT = 4096;
  const pending = new Map<number, {
    resolve: (message: McpRuntimeResponse) => void;
    reject: (error: Error) => void;
  }>();

  const handleStderr = (chunk: Buffer | string) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_LIMIT);
  };

  const handleStdout = (chunk: Buffer | string) => {
    buffer += chunk.toString();
    while (buffer.length > 0) {
      if (buffer.startsWith('Content-Length:')) {
        const messages = decodeMcpFrames(buffer);
        if (messages.length === 0) {
          break;
        }
        let consumed = 0;
        for (const message of messages) {
          consumed += Buffer.byteLength(encodeMcpMessage(message), 'utf8');
          if (typeof message.id === 'number' && pending.has(message.id)) {
            const request = pending.get(message.id)!;
            pending.delete(message.id);
            request.resolve(message);
          }
        }
        buffer = buffer.slice(consumed);
        continue;
      }

      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) {
        break;
      }
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const message = JSON.parse(trimmed) as McpRuntimeResponse;
        if (typeof message.id === 'number' && pending.has(message.id)) {
          const request = pending.get(message.id)!;
          pending.delete(message.id);
          request.resolve(message);
        }
      } catch {
        // Skip non-JSON log lines emitted to stdout.
      }
    }
  };

  const failPending = (error: Error) => {
    for (const request of pending.values()) {
      request.reject(error);
    }
    pending.clear();
  };

  const handleError = (error: Error) => {
    failPending(error);
  };

  const handleExit = () => {
    failPending(new Error('MCP server process exited before responding'));
  };

  child.stdout.on('data', handleStdout);
  child.stderr.on('data', handleStderr);
  child.on('error', handleError);
  child.on('exit', handleExit);

  return {
    send(message) {
      return new Promise((resolve, reject) => {
        pending.set(message.id, { resolve, reject });
        child.stdin.write(JSON.stringify(message) + '\n');
      });
    },
    notify(message: { jsonrpc: '2.0'; method: string; params?: Record<string, unknown> }) {
      child.stdin.write(JSON.stringify(message) + '\n');
    },
    getStderrTail() {
      return stderrTail;
    },
    dispose() {
      failPending(new Error('MCP server transport disposed before responding'));
      child.stdout.off('data', handleStdout);
      child.stderr.off('data', handleStderr);
      child.off('error', handleError);
      child.off('exit', handleExit);
    },
  };
}
