import { type LspEnvelope } from '../lsp/client.js';
import { type LoadedPlugin } from './loader.js';
import type { HookConfigOrCommand } from '../../runtime/hooks-runner.js';
import type { PluginManifestMcpServer } from '../mcp/types.js';
export interface PlatformPluginRuntimeState {
    plugins: LoadedPlugin[];
    skillRoots: string[];
    agentDirs: string[];
    /** Structured hook configs (new) or legacy command strings */
    hookConfigs: HookConfigOrCommand[];
    /** @deprecated Use hookConfigs. Retained for backward compat. */
    hookCommands: string[];
    commandDeclarations: string[];
    mcpServers: PluginManifestMcpServer[];
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
    goToDefinition: (uri: string, line: number, character: number) => Promise<unknown>;
    findReferences: (uri: string, line: number, character: number) => Promise<unknown>;
    hover: (uri: string, line: number, character: number) => Promise<unknown>;
    documentSymbols: (uri: string) => Promise<unknown>;
    dispose: () => void;
}>;
