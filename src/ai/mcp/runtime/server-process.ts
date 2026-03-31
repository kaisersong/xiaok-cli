import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

export interface McpServerProcess {
  child: ChildProcessWithoutNullStreams;
  dispose(): void;
}

export function startMcpServerProcess(command: string, args: string[] = []): McpServerProcess {
  const child = spawn(command, args, { stdio: 'pipe' });
  return {
    child,
    dispose() {
      child.kill();
    },
  };
}
