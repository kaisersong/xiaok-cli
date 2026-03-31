import { exec } from 'child_process';
function matchesTool(filter, toolName) {
    if (!filter || filter.length === 0)
        return true;
    return filter.includes('*') || filter.includes(toolName);
}
function serializeHookContext(toolName, input) {
    return JSON.stringify({ toolName, input });
}
async function runCommand(command, timeoutMs, toolName, input) {
    await new Promise((resolve, reject) => {
        const child = exec(command, {
            env: {
                ...process.env,
                XIAOK_TOOL_NAME: toolName,
                XIAOK_TOOL_INPUT: serializeHookContext(toolName, input),
            },
        }, (error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error(`hook timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        if (typeof child.on === 'function') {
            child.on('exit', () => clearTimeout(timer));
            child.on('error', () => clearTimeout(timer));
        }
    });
}
export function createHooksRunner(config = {}) {
    const timeoutMs = config.timeoutMs ?? 5000;
    return {
        async runPreHooks(toolName, input) {
            for (const hook of config.pre ?? []) {
                if (!matchesTool(hook.tools, toolName))
                    continue;
                try {
                    await runCommand(hook.command, timeoutMs, toolName, input);
                }
                catch (error) {
                    return { ok: false, message: String(error) };
                }
            }
            return { ok: true };
        },
        async runPostHooks(toolName, input) {
            const warnings = [];
            for (const hook of config.post ?? []) {
                if (!matchesTool(hook.tools, toolName))
                    continue;
                try {
                    await runCommand(hook.command, timeoutMs, toolName, input);
                }
                catch (error) {
                    warnings.push(String(error));
                }
            }
            return warnings;
        },
    };
}
