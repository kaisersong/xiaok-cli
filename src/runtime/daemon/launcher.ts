import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';

export async function spawnXiaokDaemonDetached(socketPath: string): Promise<void> {
  const args = resolveCurrentCliInvocationArgs(socketPath);
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

export async function waitForXiaokDaemon(socketPath: string, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = createConnection(socketPath);
        socket.once('connect', () => {
          socket.destroy();
          resolve();
        });
        socket.once('error', (error) => {
          socket.destroy();
          reject(error);
        });
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`timed out waiting for xiaok daemon on ${socketPath}`);
}

function resolveCurrentCliInvocationArgs(socketPath: string): string[] {
  const argv1 = process.argv[1] ?? '';
  const argv2 = process.argv[2] ?? '';
  const isTsxRunner = /tsx(?:\.cmd)?$/i.test(argv1) || argv1.includes(`${String.raw`\tsx`}`);

  if (isTsxRunner && argv2) {
    return [argv1, argv2, 'daemon', 'serve', '--socket', socketPath];
  }

  return [argv1, 'daemon', 'serve', '--socket', socketPath];
}
