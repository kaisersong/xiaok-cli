import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { userInfo } from 'node:os';

/** A loopback bind is an OS-exclusive, crash-released lock on both platforms.
 * No lock-file deletion/mtime inference. Port collision fails closed. The
 * socket accepts no commands and transports no file or authentication data.
 */
export function workspaceOwnerPort(osUser: string): number {
  return 41000 + createHash('sha256').update(`xiaok.room-workspace.owner.v1:${osUser}`).digest().readUInt16BE(0) % 14000;
}

export async function acquireWorkspaceMutationOwner(options: { port?: number } = {}) {
  const user = userInfo();
  const requestedPort = options.port ?? workspaceOwnerPort(`${user.uid}:${user.username}`);
  const server = createServer(socket => socket.destroy());
  let owned = false;
  await new Promise<void>((resolve, reject) => {
    server.once('error', error => reject(new Error('workspace_mutation_owner_busy', { cause: error })));
    server.listen({ host: '127.0.0.1', port: requestedPort, exclusive: true }, () => { owned = true; resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('workspace_mutation_owner_unavailable');
  const port = address.port;
  server.on('close', () => { owned = false; });
  let closing: Promise<void> | undefined;
  return {
    port,
    isOwner: () => owned && !closing,
    close: () => closing ??= new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
