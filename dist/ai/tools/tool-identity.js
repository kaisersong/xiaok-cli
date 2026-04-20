const LEGACY_TOOL_ALIASES = {
    bash: 'bash',
    edit: 'edit',
    glob: 'glob',
    grep: 'grep',
    read: 'read',
    write: 'write',
    webfetch: 'web_fetch',
    'web-fetch': 'web_fetch',
    web_fetch: 'web_fetch',
    websearch: 'web_search',
    'web-search': 'web_search',
    web_search: 'web_search',
    toolsearch: 'tool_search',
    'tool-search': 'tool_search',
    tool_search: 'tool_search',
    installskill: 'install_skill',
    'install-skill': 'install_skill',
    install_skill: 'install_skill',
    uninstallskill: 'uninstall_skill',
    'uninstall-skill': 'uninstall_skill',
    uninstall_skill: 'uninstall_skill',
};
export function getCanonicalToolId(name) {
    const trimmed = name.trim();
    if (!trimmed) {
        return '';
    }
    const normalized = trimmed.toLowerCase();
    return LEGACY_TOOL_ALIASES[normalized] ?? normalized;
}
export function buildToolSearchEntry(definition) {
    return {
        canonicalId: getCanonicalToolId(definition.name),
        definition,
    };
}
export function buildCapabilityToolDefinition(record) {
    return {
        name: record.name,
        description: record.description,
        inputSchema: record.inputSchema ?? { type: 'object', properties: {} },
    };
}
export function dedupeToolSearchEntries(entries) {
    const merged = new Map();
    for (const entry of entries) {
        if (!merged.has(entry.canonicalId)) {
            merged.set(entry.canonicalId, entry.definition);
        }
    }
    return [...merged.values()];
}
export function selectToolEntries(entries, names) {
    const lookup = new Map(entries.map((entry) => [entry.canonicalId, entry.definition]));
    const selected = [];
    for (const name of names) {
        const definition = lookup.get(getCanonicalToolId(name));
        if (definition) {
            selected.push(definition);
        }
    }
    return selected;
}
