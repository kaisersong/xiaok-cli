function detectNetworkIntent(command) {
    return /(curl|wget|https?:\/\/|npm\s+install|pnpm\s+add|yarn\s+add|git\s+clone)/i.test(command);
}
export function applySandboxToTools(tools, enforcer) {
    if (!enforcer) {
        return tools;
    }
    return tools.map((tool) => {
        if (tool.definition.name === 'bash') {
            return {
                ...tool,
                execute: async (input) => {
                    if (typeof input.workdir === 'string') {
                        const fileDecision = enforcer.enforceFile(input.workdir);
                        if (!fileDecision.allowed) {
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
