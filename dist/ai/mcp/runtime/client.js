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
        async callToolResult(name, input) {
            const result = await request('tools/call', { name, arguments: input });
            return normalizeMcpRuntimeToolResult(result);
        },
        async callTool(name, input) {
            const result = await request('tools/call', { name, arguments: input });
            return normalizeMcpRuntimeToolResult(result).text;
        },
    };
}
export function normalizeMcpRuntimeToolResult(result) {
    const value = isRecord(result) ? result : {};
    const content = Array.isArray(value.content) ? value.content : [];
    const textParts = [];
    const images = [];
    for (const entry of content) {
        if (!isRecord(entry))
            continue;
        if (entry.type === 'text' && typeof entry.text === 'string') {
            textParts.push(entry.text);
            continue;
        }
        if (entry.type === 'image') {
            const mimeType = typeof entry.mimeType === 'string'
                ? entry.mimeType
                : typeof entry.mime_type === 'string'
                    ? entry.mime_type
                    : 'image/png';
            images.push({
                mimeType,
                ...(typeof entry.data === 'string' ? { data: entry.data } : {}),
                ...(typeof entry.filePath === 'string' ? { filePath: entry.filePath } : {}),
                ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
            });
        }
    }
    const text = textParts.join('\n');
    return {
        text,
        images,
        ...(Object.prototype.hasOwnProperty.call(value, 'structuredContent')
            ? { structuredContent: value.structuredContent }
            : {}),
        isError: value.isError === true,
        summary: text || (images.length > 0 ? `[${images.length} image${images.length === 1 ? '' : 's'}]` : ''),
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
