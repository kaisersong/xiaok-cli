import { type ChildProcessWithoutNullStreams } from 'child_process';
import type { McpRuntimeRequest, McpRuntimeResponse, McpRuntimeTransport } from './client.js';
export interface McpServerProcess {
    child: ChildProcessWithoutNullStreams;
    dispose(): void;
}
export declare function startMcpServerProcess(command: string, args?: string[]): McpServerProcess;
export declare function encodeMcpMessage(message: McpRuntimeRequest | McpRuntimeResponse): string;
export declare function decodeMcpFrames(input: string): McpRuntimeResponse[];
export declare function createStdioMcpTransport(child: Pick<ChildProcessWithoutNullStreams, 'stdin' | 'stdout' | 'on' | 'off'>): McpRuntimeTransport & {
    dispose(): void;
};
