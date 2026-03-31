export function createLspManager() {
    const diagnostics = new Map();
    return {
        applyMessage(message) {
            if (message.method !== 'textDocument/publishDiagnostics') {
                return;
            }
            diagnostics.set(message.params.uri, message.params.diagnostics ?? []);
        },
        getDiagnostics(uri) {
            return diagnostics.get(uri) ?? [];
        },
        getSummary() {
            const lines = [];
            for (const [uri, entries] of diagnostics.entries()) {
                for (const entry of entries) {
                    lines.push(`${uri}: ${entry.message}`);
                }
            }
            return lines.join('\n');
        },
    };
}
