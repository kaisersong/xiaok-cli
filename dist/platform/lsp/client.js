export function encodeLspMessage(message) {
    const payload = JSON.stringify(message);
    return `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;
}
export function decodeLspFrames(input) {
    const messages = [];
    let rest = input;
    while (rest.length > 0) {
        const headerEnd = rest.indexOf('\r\n\r\n');
        if (headerEnd === -1)
            break;
        const header = rest.slice(0, headerEnd);
        const match = /Content-Length:\s*(\d+)/i.exec(header);
        if (!match)
            break;
        const length = Number(match[1]);
        const payloadStart = headerEnd + 4;
        const payload = rest.slice(payloadStart, payloadStart + length);
        messages.push(JSON.parse(payload));
        rest = rest.slice(payloadStart + length);
    }
    return messages;
}
export function createLspClient(transport, manager) {
    let nextId = 1;
    const unsubscribe = transport.onMessage((message) => {
        if (message.method) {
            manager.applyMessage(message);
        }
    });
    async function request(method, params) {
        const response = await transport.send({
            jsonrpc: '2.0',
            id: nextId++,
            method,
            params,
        });
        if (!response) {
            return undefined;
        }
        if (response.error) {
            throw new Error(response.error.message);
        }
        return response.result;
    }
    async function notify(method, params) {
        await transport.send({
            jsonrpc: '2.0',
            method,
            params,
        });
    }
    return {
        async initialize(rootUri) {
            await request('initialize', {
                processId: process.pid,
                rootUri,
                capabilities: {},
            });
            await notify('initialized', {});
        },
        async didOpenDocument(document) {
            await notify('textDocument/didOpen', {
                textDocument: {
                    ...document,
                    version: document.version ?? 1,
                },
            });
        },
        dispose() {
            unsubscribe();
            transport.dispose?.();
        },
    };
}
