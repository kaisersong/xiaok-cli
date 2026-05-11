export function createMcpRuntimeClient(transport) {
    let nextId = 1;
    async function request(method, params) {
        const response = await transport.send({
            jsonrpc: '2.0',
            id: nextId++,
            method,
            params,
        });
        if (response.error) {
            throw new Error(response.error.message);
        }
        return response.result;
    }
    return {
        async initialize() {
            const result = await request('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'xiaok-desktop', version: '1.0.0' },
            });
            transport.notify?.({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
            return result;
        },
        async listTools() {
            const result = await request('tools/list', {});
            return result.tools ?? [];
        },
        async callTool(name, input) {
            const result = await request('tools/call', { name, arguments: input });
            const text = result.content?.find((entry) => entry.type === 'text')?.text;
            return text ?? '';
        },
    };
}
