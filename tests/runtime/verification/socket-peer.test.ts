import { describe, it, expect } from 'vitest';
import { createServer, createConnection } from 'node:net';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { readControllerSocketPeer } from '../../../src/runtime/verification/socket-peer.js';

describe.skipIf(process.platform === 'win32')('actual kernel IPC caller identity', () => {
  it('extracts actual UID/GID from the accepted socket instead of caller JSON', async () => {
    const root = mkdtempSync(join(tmpdir(), 'controller-peer-')), helper = join(root, 'socket-peer');
    const compile = spawnSync('/usr/bin/cc', ['-O2', '-Wall', '-Wextra', '-Werror', resolve('src/runtime/verification/native/socket-peer.c'), '-o', helper], { encoding: 'utf8' });
    expect(compile.status).toBe(0);
    const socketPath = join(root, 'peer.sock'); let peer: { uid: number; gid: number } | undefined;
    const server = createServer(socket => { try { peer = readControllerSocketPeer(socket, helper); socket.end('ok'); } catch (error) { socket.destroy(error as Error); } });
    await new Promise<void>(resolve => server.listen(socketPath, resolve));
    try {
      await new Promise<void>((resolve, reject) => { const client = createConnection(socketPath); client.on('error', reject); client.on('data', () => {}); client.on('end', resolve); });
      expect(peer).toEqual({ uid: process.getuid!(), gid: process.getgid!() });
      expect(spawnSync(helper, [], { encoding: 'utf8' }).status).not.toBe(0);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
  });
});
