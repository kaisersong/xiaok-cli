import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import type { McpRuntimeRequest, McpRuntimeResponse, McpRuntimeTransport } from './client.js';

export interface McpServerProcess {
  child: ChildProcessWithoutNullStreams;
  dispose(): void;
}

export function startMcpServerProcess(command: string, args: string[] = []): McpServerProcess {
  const child = spawn(command, args, { stdio: 'pipe' });
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
  child: Pick<ChildProcessWithoutNullStreams, 'stdin' | 'stdout' | 'on' | 'off'>,
): McpRuntimeTransport & { dispose(): void } {
  let buffer = '';
  const pending = new Map<number, {
    resolve: (message: McpRuntimeResponse) => void;
    reject: (error: Error) => void;
  }>();

  const handleStdout = (chunk: Buffer | string) => {
    buffer += chunk.toString();
    const messages = decodeMcpFrames(buffer);
    if (messages.length === 0) {
      return;
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
  child.on('error', handleError);
  child.on('exit', handleExit);

  return {
    send(message) {
      return new Promise((resolve, reject) => {
        pending.set(message.id, { resolve, reject });
        child.stdin.write(encodeMcpMessage(message));
      });
    },
    dispose() {
      failPending(new Error('MCP server transport disposed before responding'));
      child.stdout.off('data', handleStdout);
      child.off('error', handleError);
      child.off('exit', handleExit);
    },
  };
}
