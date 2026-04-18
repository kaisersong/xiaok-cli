function normalizeOptions(options) {
    if (typeof options === 'function') {
        return { onSandboxDenied: options };
    }
    return options ?? {};
}
function detectNetworkIntent(command) {
    return /(curl|wget|https?:\/\/|npm\s+install|pnpm\s+add|yarn\s+add|git\s+clone)/i.test(command);
}
export function applySandboxToTools(tools, enforcer, optionsOrCallback) {
    if (!enforcer) {
        return tools;
    }
    const options = normalizeOptions(optionsOrCallback);
    return tools.map((tool) => {
        if (tool.definition.name === 'bash') {
            return {
                ...tool,
                execute: async (input) => {
                    if (typeof input.workdir === 'string') {
                        const fileDecision = enforcer.enforceFile(input.workdir);
                        if (!fileDecision.allowed) {
                            const retry = await options.onSandboxDenied?.(input.workdir, tool.definition.name);
                            if (retry?.shouldProceed && enforcer.enforceFile(input.workdir).allowed) {
                                return tool.execute(input);
                            }
                            return `Error: sandbox denied bash workdir: ${fileDecision.reason}`;
                        }
                    }
                    if (typeof input.command === 'string' && detectNetworkIntent(input.command)) {
                        const networkDecision = enforcer.enforceNetwork();
                        if (!networkDecision.allowed) {
                            return `Error: sandbox denied network access: ${networkDecision.reason}`;
                        }
                    }
                    return tool.execute(input);
                },
            };
        }
        if (['read', 'write', 'edit'].includes(tool.definition.name)) {
            return {
                ...tool,
                execute: async (input) => {
                    if (typeof input.file_path === 'string') {
                        const decision = enforcer.enforceFile(input.file_path);
                        if (!decision.allowed) {
                            const retry = await options.onSandboxDenied?.(input.file_path, tool.definition.name);
                            if (retry?.shouldProceed && enforcer.enforceFile(input.file_path).allowed) {
                                return tool.execute(input);
                            }
                            return `Error: sandbox denied path: ${decision.reason}`;
                        }
                    }
                    return tool.execute(input);
                },
            };
        }
        return tool;
    });
}
