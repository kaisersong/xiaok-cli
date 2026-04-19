import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { XiaokDaemonStatus } from './host.js';
import type { XiaokDaemonServerMessage } from './protocol.js';
import { XIAOK_DAEMON_PROTOCOL_VERSION } from './protocol.js';
import { readXiaokVersion } from '../reminder/version.js';

export async function queryXiaokDaemonStatus(socketPath: string): Promise<XiaokDaemonStatus | null> {
  try {
    return await callXiaokDaemonControl<XiaokDaemonStatus>(socketPath, 'status', {});
  } catch {
    return null;
  }
}

export async function stopXiaokDaemon(socketPath: string): Promise<boolean> {
  try {
    await callXiaokDaemonControl(socketPath, 'shutdown', {});
    return true;
  } catch {
    return false;
  }
}

async function callXiaokDaemonControl<TResult>(
  socketPath: string,
  method: 'status' | 'shutdown',
  params: Record<string, unknown>,
): Promise<TResult> {
  const socket = await connectSocket(socketPath);
  let buffer = '';
  let helloAcked = false;

  return await new Promise<TResult>((resolve, reject) => {
    const finish = (callback: () => void) => {
      socket.removeAllListeners();
      socket.destroy();
      callback();
    };

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          const message = JSON.parse(line) as XiaokDaemonServerMessage;
          if (message.type === 'hello_ack') {
            helloAcked = true;
            socket.write(`${JSON.stringify({
              type: 'rpc',
              id: 'control',
              service: 'daemon',
              method,
              params,
            })}\n`);
          } else if (message.type === 'rpc_result' && message.id === 'control') {
            finish(() => resolve(message.result as TResult));
            return;
          } else if (message.type === 'rpc_error' && (message.id === 'control' || message.id === 'hello')) {
            finish(() => reject(new Error(message.message)));
            return;
          }
        }
        newlineIndex = buffer.indexOf('\n');
      }
    });

    socket.on('error', (error) => {
      finish(() => reject(error));
    });

    socket.on('close', () => {
      if (!helloAcked) {
        finish(() => reject(new Error('xiaok daemon unavailable')));
      }
    });

    socket.write(`${JSON.stringify({
      type: 'hello',
      clientInstanceId: `control_${randomUUID()}`,
      sessionId: '',
      creatorUserId: '',
      workspaceRoot: process.cwd(),
      clientVersion: readXiaokVersion(),
      protocolVersion: XIAOK_DAEMON_PROTOCOL_VERSION,
      defaultTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
      sentAt: Date.now(),
    })}\n`);
  });
}

async function connectSocket(socketPath: string): Promise<Socket> {
  const socket = createConnection(socketPath);
  socket.setEncoding('utf8');
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('error', (error) => reject(error));
  });
  return socket;
}
