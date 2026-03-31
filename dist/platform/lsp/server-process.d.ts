import { type ChildProcessWithoutNullStreams } from 'child_process';
export interface LspServerProcess {
    child: ChildProcessWithoutNullStreams;
    dispose(): void;
}
export declare function startLspServerProcess(command: string, args?: string[]): LspServerProcess;
