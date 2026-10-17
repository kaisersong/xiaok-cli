import { spawnSync } from 'node:child_process';
import type { Socket } from 'node:net';
import { isAbsolute } from 'node:path';

/** Node's inherited stdio setup can change shared socket file status flags.
 * Restore nonblocking I/O even when the helper fails, before any JS write/read.
 * This narrow native handle use is pinned to the installed Node ABI. */
function withNonblockingSocket<T>(socket:Socket,work:()=>T):T{
  const handle=(socket as unknown as {_handle?:{setBlocking?:(enabled:boolean)=>number}})._handle;
  if(!handle||typeof handle.setBlocking!=='function'){socket.destroy();throw Error('controller_peer_nonblocking');}
  let settledBodyResult!: T;
  let settledBodyFailure: {
      error: unknown;
  } | undefined;
  try {
      {
          settledBodyResult = work();
      }
  }
  catch (error) {
      settledBodyFailure = { error };
  }
  {
      try {
          if (socket.destroyed || handle.setBlocking(false) !== 0)
              throw Error('controller_peer_nonblocking');
      }
      catch (error) {
          socket.destroy();
          throw error;
      }
  }
  if (settledBodyFailure)
      throw settledBodyFailure.error;
  return settledBodyResult;
}

/** Kernel facts from a service-owned accepted socket. The installed owner verifies
 * the helper's root-protected package before constructing the public listener. */
export function readControllerSocketPeer(socket: Socket, helperExecutable: string): Readonly<{ uid: number; gid: number }> {
  if (!['darwin', 'linux'].includes(process.platform)) throw Error('controller_peer_platform');
  if (!isAbsolute(helperExecutable) || helperExecutable.includes('\0') || socket.destroyed) throw Error('controller_peer_socket');
  // Bound to the frozen Node ABI and exercised with real sockets; no public input selects this fd.
  const fd = (socket as unknown as { _handle?: { fd?: number } })._handle?.fd;
  if (!Number.isSafeInteger(fd) || fd! < 0) throw Error('controller_peer_socket');
  const result = withNonblockingSocket(socket,()=>spawnSync(helperExecutable, [], { env: { PATH: '/usr/bin:/bin' }, timeout: 5000, maxBuffer: 4096, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe', fd!] }));
  if (result.error || result.status !== 0 || result.signal) throw Error('controller_peer_unknown');
  const peer = JSON.parse(result.stdout);
  if (!peer || Object.keys(peer).sort().join(',') !== 'gid,uid' || !Number.isSafeInteger(peer.uid) || peer.uid < 0 || !Number.isSafeInteger(peer.gid) || peer.gid < 0) throw Error('controller_peer_unknown');
  return Object.freeze({ uid: peer.uid, gid: peer.gid });
}

/** macOS session principal and process PID from LOCAL_PEERTOKEN, never request JSON.
 * PID is observational only: it is not a process-incarnation death/quiescence proof. */
export function readControllerSocketAuditPeer(socket: Socket, helperExecutable: string): Readonly<{ uid: number; gid: number; auditSessionId: number; pid: number }> {
  if (process.platform !== 'darwin') throw Error('controller_audit_peer_platform');
  if (!isAbsolute(helperExecutable) || helperExecutable.includes('\0') || socket.destroyed) throw Error('controller_peer_socket');
  const fd=(socket as unknown as {_handle?:{fd?:number}})._handle?.fd;
  if(!Number.isSafeInteger(fd)||fd!<0)throw Error('controller_peer_socket');
  const result=withNonblockingSocket(socket,()=>spawnSync(helperExecutable,[],{env:{PATH:'/usr/bin:/bin'},timeout:5000,maxBuffer:4096,encoding:'utf8',stdio:['ignore','pipe','pipe',fd!]}));
  if(result.error||result.status!==0||result.signal)throw Error('controller_peer_unknown');
  const peer=JSON.parse(result.stdout);
  if(!peer||Object.keys(peer).sort().join(',')!=='auditSessionId,gid,pid,uid'||!Number.isSafeInteger(peer.uid)||peer.uid<0||!Number.isSafeInteger(peer.gid)||peer.gid<0||!Number.isSafeInteger(peer.auditSessionId)||peer.auditSessionId<1||!Number.isSafeInteger(peer.pid)||peer.pid<1)throw Error('controller_peer_unknown');
  return Object.freeze({uid:peer.uid,gid:peer.gid,auditSessionId:peer.auditSessionId,pid:peer.pid});
}
