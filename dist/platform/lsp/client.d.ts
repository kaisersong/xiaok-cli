export interface LspEnvelope {
    jsonrpc: '2.0';
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
}
export declare function encodeLspMessage(message: LspEnvelope): string;
export declare function decodeLspFrames(input: string): LspEnvelope[];
