import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

export interface LspServerProcess {
  child: ChildProcessWithoutNullStreams;
  dispose(): void;
}

export function startLspServerProcess(command: string, args: string[] = []): LspServerProcess {
  const child = spawn(command, args, { stdio: 'pipe' });
  return {
    child,
    dispose() {
      child.kill();
    },
  };
}
