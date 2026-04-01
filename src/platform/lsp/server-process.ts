import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { decodeLspFrames, encodeLspMessage, type LspEnvelope, type LspTransport } from './client.js';

export interface LspServerProcess {
  child: ChildProcessWithoutNullStreams;
  dispose(): void;
}

export function startLspServerProcess(command: string, args: string[] = []): LspServerProcess {
  const child = spawn(command, args, { stdio: 'pipe' });
  return {
    child,
    dispose() {
      child.kill();
    },
  };
}

export function createStdioLspTransport(
  child: Pick<ChildProcessWithoutNullStreams, 'stdin' | 'stdout' | 'on' | 'off' | 'kill'>,
): LspTransport {
  let buffer = '';
  const listeners = new Set<(message: LspEnvelope) => void>();
  const pending = new Map<number, {
    resolve: (message: LspEnvelope) => void;
    reject: (error: Error) => void;
  }>();

  const handleStdout = (chunk: Buffer | string) => {
    buffer += chunk.toString();
    const messages = decodeLspFrames(buffer);
    if (messages.length === 0) {
      return;
    }

    let consumed = 0;
    for (const message of messages) {
      consumed += Buffer.byteLength(encodeLspMessage(message), 'utf8');
      if (typeof message.id === 'number' && pending.has(message.id)) {
        const request = pending.get(message.id)!;
        pending.delete(message.id);
        request.resolve(message);
        continue;
      }

      for (const listener of listeners) {
        listener(message);
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
    failPending(new Error('LSP server process exited before responding'));
  };

  child.stdout.on('data', handleStdout);
  child.on('error', handleError);
  child.on('exit', handleExit);

  return {
    send(message) {
      return new Promise((resolve, reject) => {
        if (typeof message.id === 'number') {
          pending.set(message.id, { resolve, reject });
        }
        child.stdin.write(encodeLspMessage(message));
        if (typeof message.id !== 'number') {
          resolve();
        }
      });
    },
    onMessage(handler) {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
    dispose() {
      failPending(new Error('LSP server transport disposed before responding'));
      child.stdout.off('data', handleStdout);
      child.off('error', handleError);
      child.off('exit', handleExit);
      child.kill();
    },
  };
}
