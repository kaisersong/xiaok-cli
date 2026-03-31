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

  return {
    applyMessage(message: LspPublishDiagnosticsMessage): void {
      if (message.method !== 'textDocument/publishDiagnostics') {
        return;
      }
      diagnostics.set(message.params.uri, message.params.diagnostics ?? []);
    },

    getDiagnostics(uri: string): LspDiagnostic[] {
      return diagnostics.get(uri) ?? [];
    },

    getSummary(): string {
      const lines: string[] = [];
      for (const [uri, entries] of diagnostics.entries()) {
        for (const entry of entries) {
          lines.push(`${uri}: ${entry.message}`);
        }
      }
      return lines.join('\n');
    },
  };
}
