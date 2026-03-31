import { type ChildProcessWithoutNullStreams } from 'child_process';
export interface McpServerProcess {
    child: ChildProcessWithoutNullStreams;
    dispose(): void;
}
export declare function startMcpServerProcess(command: string, args?: string[]): McpServerProcess;
