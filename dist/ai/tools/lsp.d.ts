import type { Tool } from '../../types.js';
interface LspClient {
    didOpenDocument(document: {
        uri: string;
        languageId: string;
        version?: number;
        text: string;
    }): Promise<void>;
    goToDefinition(uri: string, line: number, character: number): Promise<unknown>;
    findReferences(uri: string, line: number, character: number): Promise<unknown>;
    hover(uri: string, line: number, character: number): Promise<unknown>;
    documentSymbols(uri: string): Promise<unknown>;
}
export interface LspToolOptions {
    getLspClient(): LspClient | undefined;
    cwd?: string;
}
export declare function createLspTool(options: LspToolOptions): Tool;
export {};
