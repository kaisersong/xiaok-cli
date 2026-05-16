import { type ChildProcessWithoutNullStreams } from 'child_process';
import type { McpRuntimeRequest, McpRuntimeResponse, McpRuntimeTransport } from './client.js';
export interface McpServerProcess {
    child: ChildProcessWithoutNullStreams;
    dispose(): void;
}
export interface McpServerProcessOptions {
    cwd?: string;
    env?: Record<string, string>;
    platform?: NodeJS.Platform;
}
export declare function buildMcpServerSpawnOptions(command: string, opts?: McpServerProcessOptions): {
    stdio: 'pipe';
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    windowsVerbatimArguments: boolean;
    windowsHide?: boolean;
};
export declare function startMcpServerProcess(command: string, args?: string[], opts?: McpServerProcessOptions): McpServerProcess;
export declare function encodeMcpMessage(message: McpRuntimeRequest | McpRuntimeResponse): string;
export declare function decodeMcpFrames(input: string): McpRuntimeResponse[];
export declare function createStdioMcpTransport(child: Pick<ChildProcessWithoutNullStreams, 'stdin' | 'stdout' | 'on' | 'off'>): McpRuntimeTransport & {
    notify(message: {
        jsonrpc: '2.0';
        method: string;
        params?: Record<string, unknown>;
    }): void;
    dispose(): void;
};
