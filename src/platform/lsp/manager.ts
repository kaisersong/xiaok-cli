export interface LspDiagnostic {
  severity?: number;
  message: string;
}

export interface LspPublishDiagnosticsMessage {
  jsonrpc: '2.0';
  method: 'textDocument/publishDiagnostics';
  params: {
    uri: string;
    diagnostics: LspDiagnostic[];
  };
}

export function createLspManager() {
  const diagnostics = new Map<string, LspDiagnostic[]>();
  let latestUpdateAt: number | undefined;

  function formatAge(deltaMs: number): string {
    if (deltaMs < 1000) return 'just now';
    const seconds = Math.floor(deltaMs / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  }

  return {
    applyMessage(message: LspPublishDiagnosticsMessage): void {
      if (message.method !== 'textDocument/publishDiagnostics') {
        return;
      }
      diagnostics.set(message.params.uri, message.params.diagnostics ?? []);
      latestUpdateAt = Date.now();
    },

    getDiagnostics(uri: string): LspDiagnostic[] {
      return diagnostics.get(uri) ?? [];
    },

    getSummary(now: number = Date.now()): string {
      const lines: string[] = [];
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
