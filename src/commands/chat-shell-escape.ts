import { spawn } from 'node:child_process';

export type ShellEscapeParseResult =
  | { kind: 'command'; command: string }
  | { kind: 'usage' };

export interface ShellCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  shell?: string;
  platform?: NodeJS.Platform;
}

export interface ShellCommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  error?: string;
  output?: string;
}

export interface ShellEscapeExecutorInput {
  command: string;
  cwd: string;
}

export type ShellEscapeExecutor = (input: ShellEscapeExecutorInput) => Promise<ShellCommandResult>;

export function parseShellEscapeInput(input: string): ShellEscapeParseResult | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('!')) {
    return null;
  }
  if (trimmed.startsWith('!/')) {
    return null;
  }

  const command = trimmed.slice(1).trim();
  if (!command) {
    return { kind: 'usage' };
  }

  return { kind: 'command', command };
}

function buildShellInvocation(
  command: string,
  options: ShellCommandOptions,
): { shell: string; args: string[] } {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    return {
      shell: options.shell ?? process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', command],
    };
  }

  return {
    shell: options.shell ?? process.env.SHELL ?? 'sh',
    args: ['-lc', command],
  };
}

export function runInteractiveShellCommand(
  command: string,
  options: ShellCommandOptions = {},
): Promise<ShellCommandResult> {
  return new Promise((resolve) => {
    const invocation = buildShellInvocation(command, options);
    const maxCapturedOutputBytes = 200_000;
    let capturedOutput = '';
    let settled = false;
    const appendOutput = (chunk: Buffer | string, stream: NodeJS.WriteStream): void => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      capturedOutput += text;
      if (Buffer.byteLength(capturedOutput, 'utf8') > maxCapturedOutputBytes) {
        capturedOutput = Buffer.from(capturedOutput, 'utf8')
          .subarray(-maxCapturedOutputBytes)
          .toString('utf8');
      }
      stream.write(chunk);
    };
    const finish = (result: ShellCommandResult): void => {
      if (settled) return;
      settled = true;
      resolve({ ...result, output: capturedOutput });
    };

    const child = spawn(invocation.shell, invocation.args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      appendOutput(chunk, process.stdout);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      appendOutput(chunk, process.stderr);
    });

    child.on('error', (error) => {
      finish({ exitCode: null, signal: null, error: error.message });
    });

    child.on('close', (exitCode, signal) => {
      finish({ exitCode, signal });
    });
  });
}
