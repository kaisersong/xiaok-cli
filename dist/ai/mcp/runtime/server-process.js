import { spawn } from 'child_process';
export function startMcpServerProcess(command, args = []) {
    const child = spawn(command, args, { stdio: 'pipe' });
    return {
        child,
        dispose() {
            child.kill();
        },
    };
}
