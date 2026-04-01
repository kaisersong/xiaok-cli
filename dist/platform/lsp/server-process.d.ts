import { type ChildProcessWithoutNullStreams } from 'child_process';
import { type LspTransport } from './client.js';
export interface LspServerProcess {
    child: ChildProcessWithoutNullStreams;
    dispose(): void;
}
export declare function startLspServerProcess(command: string, args?: string[]): LspServerProcess;
export declare function createStdioLspTransport(child: Pick<ChildProcessWithoutNullStreams, 'stdin' | 'stdout' | 'on' | 'off' | 'kill'>): LspTransport;
