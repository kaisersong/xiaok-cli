import type { Socket } from 'node:net';
/** Kernel facts from a service-owned accepted socket. The installed owner verifies
 * the helper's root-protected package before constructing the public listener. */
export declare function readControllerSocketPeer(socket: Socket, helperExecutable: string): Readonly<{
    uid: number;
    gid: number;
}>;
/** macOS session principal and process PID from LOCAL_PEERTOKEN, never request JSON.
 * PID is observational only: it is not a process-incarnation death/quiescence proof. */
export declare function readControllerSocketAuditPeer(socket: Socket, helperExecutable: string): Readonly<{
    uid: number;
    gid: number;
    auditSessionId: number;
    pid: number;
}>;
