import { spawn } from 'node:child_process';
export function parseShellEscapeInput(input) {
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
function buildShellInvocation(command, options) {
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
export function runInteractiveShellCommand(command, options = {}) {
    return new Promise((resolve) => {
        const invocation = buildShellInvocation(command, options);
        const maxCapturedOutputBytes = 200_000;
        let capturedOutput = '';
        let settled = false;
        const appendOutput = (chunk, stream) => {
            const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
            capturedOutput += text;
            if (Buffer.byteLength(capturedOutput, 'utf8') > maxCapturedOutputBytes) {
                capturedOutput = Buffer.from(capturedOutput, 'utf8')
                    .subarray(-maxCapturedOutputBytes)
                    .toString('utf8');
            }
            stream.write(chunk);
        };
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            resolve({ ...result, output: capturedOutput });
        };
        const child = spawn(invocation.shell, invocation.args, {
            cwd: options.cwd ?? process.cwd(),
            env: options.env ?? process.env,
            stdio: ['inherit', 'pipe', 'pipe'],
        });
        child.stdout?.on('data', (chunk) => {
            appendOutput(chunk, process.stdout);
        });
        child.stderr?.on('data', (chunk) => {
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
