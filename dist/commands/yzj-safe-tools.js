// Default safe tool subset for yzj webhook channel sessions.
// Only read-only and meta tools are exposed by default; write/edit/bash and
// other side-effecting tools must be explicitly opted in via
// `extra_allowed_tools` or by setting `disable_safe_default=true`.
const SAFE_DEFAULT_TOOLS = [
    'read',
    'glob',
    'grep',
    'web_search',
    'web_fetch',
    'skill',
    'tool_search',
    'install_skill',
    'uninstall_skill',
    'memory',
    'subagent',
];
export function getYzjSafeDefaultTools() {
    return [...SAFE_DEFAULT_TOOLS];
}
export function resolveYzjAllowedTools(input) {
    if (input.disableSafeDefault) {
        return undefined;
    }
    const merged = new Set(SAFE_DEFAULT_TOOLS);
    for (const name of input.extraAllowedTools ?? []) {
        if (typeof name === 'string' && name.length > 0) {
            merged.add(name);
        }
    }
    return [...merged];
}
