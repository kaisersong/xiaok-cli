import { spawn } from 'child_process';
export function startMcpServerProcess(command, args = [], opts) {
    const child = spawn(command, args, {
        stdio: 'pipe',
        cwd: opts?.cwd,
        env: opts?.env ? { ...process.env, ...opts.env } : undefined,
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
        // NDJSON: split on newlines
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete last line in buffer
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            try {
                const message = JSON.parse(trimmed);
                if (typeof message.id === 'number' && pending.has(message.id)) {
                    const request = pending.get(message.id);
                    pending.delete(message.id);
                    request.resolve(message);
                }
            }
            catch {
                // Skip non-JSON lines (e.g. server logs)
            }
        }
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
                child.stdin.write(JSON.stringify(message) + '\n');
            });
        },
        notify(message) {
            child.stdin.write(JSON.stringify(message) + '\n');
        },
        dispose() {
            failPending(new Error('MCP server transport disposed before responding'));
            child.stdout.off('data', handleStdout);
            child.off('error', handleError);
            child.off('exit', handleExit);
        },
    };
}
