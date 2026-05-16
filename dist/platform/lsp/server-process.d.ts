import { type ChildProcessWithoutNullStreams } from 'child_process';
import { type LspTransport } from './client.js';
export interface LspServerProcess {
    child: ChildProcessWithoutNullStreams;
    dispose(): void;
}
export declare function buildLspServerSpawnOptions(command: string, options?: {
    platform?: NodeJS.Platform;
}): {
    stdio: 'pipe';
    windowsVerbatimArguments: boolean;
    windowsHide?: boolean;
};
export declare function startLspServerProcess(command: string, args?: string[]): LspServerProcess;
export declare function createStdioLspTransport(child: Pick<ChildProcessWithoutNullStreams, 'stdin' | 'stdout' | 'on' | 'off' | 'kill'>): LspTransport;
