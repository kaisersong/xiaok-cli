export function createLspManager() {
    const diagnostics = new Map();
    let latestUpdateAt;
    function formatAge(deltaMs) {
        if (deltaMs < 1000)
            return 'just now';
        const seconds = Math.floor(deltaMs / 1000);
        if (seconds < 60)
            return `${seconds}s ago`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60)
            return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        return `${hours}h ago`;
    }
    return {
        applyMessage(message) {
            if (message.method !== 'textDocument/publishDiagnostics') {
                return;
            }
            diagnostics.set(message.params.uri, message.params.diagnostics ?? []);
            latestUpdateAt = Date.now();
        },
        getDiagnostics(uri) {
            return diagnostics.get(uri) ?? [];
        },
        getSummary(now = Date.now()) {
            const lines = [];
            for (const [uri, entries] of diagnostics.entries()) {
                for (const entry of entries) {
                    lines.push(`${uri}: ${entry.message}`);
                }
            }
            if (lines.length === 0) {
                return '[LSP: no diagnostics yet]';
            }
            const age = latestUpdateAt === undefined ? 'unknown' : formatAge(Math.max(0, now - latestUpdateAt));
            lines.push(`[LSP last updated: ${age}]`);
            return lines.join('\n');
        },
    };
}
