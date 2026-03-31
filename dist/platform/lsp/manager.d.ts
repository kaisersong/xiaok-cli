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
export declare function createLspManager(): {
    applyMessage(message: LspPublishDiagnosticsMessage): void;
    getDiagnostics(uri: string): LspDiagnostic[];
    getSummary(): string;
};
