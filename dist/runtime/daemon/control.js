import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import { XIAOK_DAEMON_PROTOCOL_VERSION } from './protocol.js';
import { readXiaokVersion } from '../reminder/version.js';
export async function queryXiaokDaemonStatus(socketPath) {
    try {
        return await callXiaokDaemonControl(socketPath, 'status', {});
    }
    catch {
        return null;
    }
}
export async function stopXiaokDaemon(socketPath) {
    try {
        await callXiaokDaemonControl(socketPath, 'shutdown', {});
        return true;
    }
    catch {
        return false;
    }
}
async function callXiaokDaemonControl(socketPath, method, params) {
    const socket = await connectSocket(socketPath);
    let buffer = '';
    let helloAcked = false;
    return await new Promise((resolve, reject) => {
        const finish = (callback) => {
            socket.removeAllListeners();
            socket.destroy();
            callback();
        };
        socket.on('data', (chunk) => {
            buffer += chunk;
            let newlineIndex = buffer.indexOf('\n');
            while (newlineIndex >= 0) {
                const line = buffer.slice(0, newlineIndex).trim();
                buffer = buffer.slice(newlineIndex + 1);
                if (line) {
                    const message = JSON.parse(line);
                    if (message.type === 'hello_ack') {
                        helloAcked = true;
                        socket.write(`${JSON.stringify({
                            type: 'rpc',
                            id: 'control',
                            service: 'daemon',
                            method,
                            params,
                        })}\n`);
                    }
                    else if (message.type === 'rpc_result' && message.id === 'control') {
                        finish(() => resolve(message.result));
                        return;
                    }
                    else if (message.type === 'rpc_error' && (message.id === 'control' || message.id === 'hello')) {
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
async function connectSocket(socketPath) {
    const socket = createConnection(socketPath);
    socket.setEncoding('utf8');
    await new Promise((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('error', (error) => reject(error));
    });
    return socket;
}
