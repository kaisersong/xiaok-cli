export interface LspEnvelope {
    jsonrpc: '2.0';
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
    error?: {
        message: string;
    };
}
export interface LspTransport {
    send(message: LspEnvelope): Promise<LspEnvelope | void>;
    onMessage(handler: (message: LspEnvelope) => void): () => void;
    dispose?(): void;
}
export declare function encodeLspMessage(message: LspEnvelope): string;
export declare function decodeLspFrames(input: string): LspEnvelope[];
export interface LspManagerLike {
    applyMessage(message: LspEnvelope): void;
}
export declare function createLspClient(transport: LspTransport, manager: LspManagerLike): {
    initialize(rootUri: string): Promise<void>;
    didOpenDocument(document: {
        uri: string;
        languageId: string;
        version?: number;
        text: string;
    }): Promise<void>;
    goToDefinition(uri: string, line: number, character: number): Promise<unknown>;
    findReferences(uri: string, line: number, character: number, includeDeclaration?: boolean): Promise<unknown>;
    hover(uri: string, line: number, character: number): Promise<unknown>;
    documentSymbols(uri: string): Promise<unknown>;
    dispose(): void;
};
