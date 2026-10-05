import { inheritBuiltinToolIdentity } from '../../ai/tools/native-tool-identity.js';
function normalizeOptions(options) { return typeof options === 'function' ? { onSandboxDenied: options } : options ?? {}; }
function detectNetworkIntent(command) { return /(curl|wget|https?:\/\/|npm\s+install|pnpm\s+add|yarn\s+add|git\s+clone)/i.test(command); }
const compoundPreparations = new WeakMap();
/** Only first-party wrappers created below possess this port. A plugin property
 * named compoundPrepare is not consulted and cannot issue a preparation grant. */
export function getCompoundSandboxPreparation(tool) {
    const binding = compoundPreparations.get(tool);
    if (!binding)
        return undefined;
    if (tool.execute !== binding.execute)
        throw Error('compound_sandbox_wrapper_changed');
    return binding.prepare;
}
/** Registry's host-only clone preserves an existing authenticated binding; this
 * cannot create one from arbitrary function properties on an unbranded Tool. */
export function inheritCompoundSandboxPreparation(source, target) {
    const prepare = getCompoundSandboxPreparation(source);
    if (!prepare)
        return;
    if (target.execute !== source.execute || target.permission !== source.permission || target.definition.name !== source.definition.name)
        throw Error('compound_sandbox_clone_changed');
    compoundPreparations.set(target, { execute: target.execute, prepare });
}
export function applySandboxToTools(tools, enforcer, optionsOrCallback) {
    if (!enforcer)
        return tools;
    const options = normalizeOptions(optionsOrCallback);
    return tools.map(tool => {
        const name = tool.definition.name;
        if (!['bash', 'read', 'write', 'edit'].includes(name))
            return tool;
        const prepare = async (input, context, allowPrompt) => {
            context?.signal?.throwIfAborted();
            const path = name === 'bash' ? input.workdir : input.file_path;
            if (typeof path === 'string') {
                const decision = enforcer.enforceFile(path);
                if (!decision.allowed) {
                    const retry = allowPrompt ? await options.onSandboxDenied?.(path, name) : undefined;
                    context?.signal?.throwIfAborted();
                    if (!retry?.shouldProceed || !enforcer.enforceFile(path).allowed)
                        return name === 'bash' ? `Error: sandbox denied bash workdir: ${decision.reason}` : `Error: sandbox denied path: ${decision.reason}`;
                }
            }
            if (name === 'bash' && typeof input.command === 'string' && detectNetworkIntent(input.command)) {
                const decision = enforcer.enforceNetwork();
                if (!decision.allowed)
                    return `Error: sandbox denied network access: ${decision.reason}`;
            }
            return undefined;
        };
        const wrapped = { ...tool, execute: async (input, context) => {
                const denial = await prepare(input, context, !context?.compoundPhase);
                if (denial)
                    return denial;
                context?.signal?.throwIfAborted();
                context?.assertPermissionApproval?.();
                return tool.execute(input, context);
            } };
        inheritBuiltinToolIdentity(tool, wrapped);
        compoundPreparations.set(wrapped, { execute: wrapped.execute, prepare: (input, context) => prepare(input, context, true) });
        return wrapped;
    });
}
