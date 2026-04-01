import { type LspEnvelope } from '../lsp/client.js';
import { type LoadedPlugin } from './loader.js';
export interface PlatformPluginRuntimeState {
    plugins: LoadedPlugin[];
    skillRoots: string[];
    agentDirs: string[];
    hookCommands: string[];
    commandDeclarations: string[];
    mcpServers: Array<{
        name: string;
        command: string;
    }>;
    lspServers: Array<{
        name: string;
        command: string;
    }>;
}
export declare function resolvePluginShellCommand(command: string, platform?: NodeJS.Platform): {
    command: string;
    args: string[];
};
export declare function loadPlatformPluginRuntime(cwd: string, builtinCommands: string[]): Promise<PlatformPluginRuntimeState>;
export declare function connectDeclaredMcpServer(declaration: {
    name: string;
    command: string;
}): Promise<{
    listTools: () => Promise<import("../../ai/mcp/client.js").McpToolSchema[]>;
    callTool: (name: string, input: Record<string, unknown>) => Promise<string>;
    dispose: () => void;
}>;
export declare function connectDeclaredLspServer(declaration: {
    name: string;
    command: string;
}, manager: {
    applyMessage(message: LspEnvelope): void;
}, rootUri: string): Promise<{
    didOpenDocument: (document: {
        uri: string;
        languageId: string;
        version?: number;
        text: string;
    }) => Promise<void>;
    dispose: () => void;
}>;
