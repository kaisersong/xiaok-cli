import { createServer, createConnection } from 'node:net';
import { chmodSync, existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { VERIFICATION_BUDGET } from './protocol.js';
const maximumBytes = VERIFICATION_BUDGET.rpcBytes;
function endpoint(path) {
    if (typeof path !== 'string' || path.includes('\0') || !(isAbsolute(path) || (process.platform === 'win32' && /^\\\\\.\\pipe\\[A-Za-z0-9_.-]+$/.test(path))))
        throw Error('controller_ipc_endpoint');
}
function timeout(value) { if (!Number.isSafeInteger(value) || value < 1 || value > 900000)
    throw Error('controller_ipc_timeout_limit'); return value; }
function frame(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length > maximumBytes)
        throw Error('controller_ipc_frame_limit');
    const result = Buffer.allocUnsafe(4 + bytes.length);
    result.writeUInt32BE(bytes.length);
    bytes.copy(result, 4);
    return result;
}
/** Framing only: the protected daemon dispatcher must authenticate and authorize every operation. */
export async function startControllerIpc(options) {
    const { socketPath, requestTimeoutMs, publicPeerAuthenticated, acceptPeer, dispatch } = options;
    endpoint(socketPath);
    const deadlineMs = timeout(requestTimeoutMs ?? 15000);
    if (publicPeerAuthenticated && (process.platform === 'win32' || typeof acceptPeer !== 'function'))
        throw Error('controller_public_peer_unavailable');
    const socketMode = publicPeerAuthenticated ? 0o666 : 0o600;
    if (typeof dispatch !== 'function')
        throw Error('controller_ipc_dispatcher');
    if (process.platform !== 'win32' && existsSync(socketPath))
        throw Error('controller_ipc_endpoint_occupied');
    const sockets = new Set();
    const pending = new Set();
    let admitted = 0;
    const server = createServer(socket => {
        if (admitted >= 4) {
            socket.destroy();
            return;
        }
        let peer;
        try {
            peer = acceptPeer?.(socket);
            if (peer && typeof peer.then === 'function') {
                void Promise.resolve(peer).catch(() => { });
                throw Error('controller_peer_async');
            }
        }
        catch {
            socket.destroy();
            return;
        }
        admitted++;
        sockets.add(socket);
        const abort = new AbortController();
        const expiresAt = process.hrtime.bigint() + BigInt(deadlineMs) * 1000000n;
        let bytes = Buffer.alloc(0);
        let dispatched = false;
        let closed = false;
        let drained = true;
        let released = false;
        const release = () => { if (!released && closed && drained) {
            released = true;
            admitted--;
        } };
        const timer = setTimeout(() => socket.destroy(), deadlineMs);
        const destroy = () => { if (closed)
            return; closed = true; clearTimeout(timer); abort.abort(); sockets.delete(socket); bytes = Buffer.alloc(0); release(); };
        socket.on('error', () => socket.destroy());
        socket.on('close', destroy);
        socket.on('data', chunk => {
            if (closed || dispatched || process.hrtime.bigint() >= expiresAt || bytes.length + chunk.length > maximumBytes + 4) {
                socket.destroy();
                return;
            }
            bytes = Buffer.concat([bytes, chunk]);
            if (bytes.length < 4)
                return;
            const length = bytes.readUInt32BE(0);
            if (length > maximumBytes || bytes.length > length + 4) {
                socket.destroy();
                return;
            }
            if (bytes.length !== length + 4)
                return;
            dispatched = true;
            drained = false;
            const body = bytes.subarray(4);
            bytes = Buffer.alloc(0);
            // Assimilate both synchronous throws and rejected async work; disconnect never means rollback.
            const work = Promise.resolve().then(() => {
                if (abort.signal.aborted || process.hrtime.bigint() >= expiresAt)
                    throw Error('controller_ipc_timeout_unknown');
                return dispatch(body, abort.signal, peer);
            }).then(result => {
                if (closed || process.hrtime.bigint() >= expiresAt) {
                    socket.destroy();
                    return;
                }
                const response = frame(result);
                if (process.hrtime.bigint() >= expiresAt) {
                    socket.destroy();
                    return;
                }
                socket.end(response);
            }).catch(() => { socket.destroy(); });
            pending.add(work);
            void work.then(() => { pending.delete(work); drained = true; release(); });
        });
    });
    try {
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, () => { server.removeListener('error', reject); resolve(); }); });
        // Windows requires the installed service's named-pipe DACL; mode bits are not a Windows ACL proof.
        if (process.platform !== 'win32')
            chmodSync(socketPath, socketMode);
    }
    catch (error) {
        server.close();
        throw error;
    }
    server.on('error', () => { for (const socket of sockets)
        socket.destroy(); });
    let closing;
    return Object.freeze({ close() { return closing ??= new Promise(resolve => { for (const socket of sockets)
            socket.destroy(); server.close(() => { void Promise.allSettled([...pending]).then(() => resolve()); }); }); } });
}
export function callControllerIpc(socketPath, body, options = {}) {
    const { timeoutMs, signal, verifyServerPeer } = options;
    if (verifyServerPeer !== undefined && typeof verifyServerPeer !== 'function')
        throw Error('controller_server_peer_validator');
    endpoint(socketPath);
    const delay = timeout(timeoutMs ?? 15000);
    const request = frame(body);
    const expiresAt = process.hrtime.bigint() + BigInt(delay) * 1000000n;
    return new Promise((resolve, reject) => {
        let settled = false;
        let bytes = Buffer.alloc(0);
        const socket = createConnection(socketPath);
        const finish = (error, result) => {
            if (settled)
                return;
            if (!error && process.hrtime.bigint() >= expiresAt)
                error = Error('controller_ipc_timeout_unknown');
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            socket.destroy();
            bytes = Buffer.alloc(0);
            if (error)
                reject(error);
            else
                resolve(result);
        };
        const abort = () => finish(Error('controller_ipc_aborted_unknown'));
        const timer = setTimeout(() => finish(Error('controller_ipc_timeout_unknown')), delay);
        socket.on('error', error => finish(error));
        socket.on('close', () => finish(Error('controller_ipc_closed_unknown')));
        socket.on('connect', () => {
            if (settled)
                return;
            try {
                const result = verifyServerPeer?.(socket);
                if (result !== undefined) {
                    if (result && typeof result.then === 'function')
                        void Promise.resolve(result).catch(() => { });
                    throw Error('controller_server_peer_sync_void');
                }
                if (settled || signal?.aborted || process.hrtime.bigint() >= expiresAt)
                    throw Error('controller_ipc_timeout_unknown');
                socket.write(request);
            }
            catch (error) {
                finish(error instanceof Error ? error : Error('controller_server_peer_rejected'));
            }
        });
        socket.on('data', chunk => {
            if (settled)
                return;
            if (bytes.length + chunk.length > maximumBytes + 4) {
                finish(Error('controller_ipc_frame_limit'));
                return;
            }
            bytes = Buffer.concat([bytes, chunk]);
            if (bytes.length < 4)
                return;
            const size = bytes.readUInt32BE(0);
            if (size > maximumBytes || bytes.length > size + 4) {
                finish(Error('controller_ipc_frame_limit'));
                return;
            }
            if (bytes.length === size + 4)
                finish(undefined, bytes.subarray(4));
        });
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted)
            abort();
    });
}
