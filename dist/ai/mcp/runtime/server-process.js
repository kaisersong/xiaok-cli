import { spawn } from 'child_process';
export function startMcpServerProcess(command, args = []) {
    const child = spawn(command, args, {
        stdio: 'pipe',
        windowsVerbatimArguments: process.platform === 'win32' && command.toLowerCase() === 'cmd.exe',
    });
    return {
        child,
        dispose() {
            child.kill();
        },
    };
}
export function encodeMcpMessage(message) {
    const payload = JSON.stringify(message);
    return `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;
}
export function decodeMcpFrames(input) {
    const messages = [];
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
        messages.push(JSON.parse(rest.slice(payloadStart, payloadEnd)));
        rest = rest.slice(payloadEnd);
    }
    return messages;
}
export function createStdioMcpTransport(child) {
    let buffer = '';
    const pending = new Map();
    const handleStdout = (chunk) => {
        buffer += chunk.toString();
        const messages = decodeMcpFrames(buffer);
        if (messages.length === 0) {
            return;
        }
        let consumed = 0;
        for (const message of messages) {
            consumed += Buffer.byteLength(encodeMcpMessage(message), 'utf8');
            if (typeof message.id === 'number' && pending.has(message.id)) {
                const request = pending.get(message.id);
                pending.delete(message.id);
                request.resolve(message);
            }
        }
        buffer = buffer.slice(consumed);
    };
    const failPending = (error) => {
        for (const request of pending.values()) {
            request.reject(error);
        }
        pending.clear();
    };
    const handleError = (error) => {
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
