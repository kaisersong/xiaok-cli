export function getSessionGuidanceSection(opts) {
    const parts = [];
    if (opts.permissionMode) {
        parts.push(`Current permission mode: ${opts.permissionMode}`);
    }
    if (opts.allowedToolsActive && opts.allowedToolsActive.length > 0) {
        parts.push(`Active tool restriction: only ${opts.allowedToolsActive.join(', ')} are allowed in current skill context.`);
    }
    if (opts.toolCount !== undefined) {
        parts.push(`${opts.toolCount} tools available in this session.`);
    }
    if (opts.mcpInstructions) {
        parts.push(`# MCP Server Instructions\n${opts.mcpInstructions}`);
    }
    if (opts.memories && opts.memories.length > 0) {
        const memLines = opts.memories.map((m) => `- ${m.title}: ${m.summary}`).join('\n');
        parts.push(`# Relevant Memory\n${memLines}`);
    }
    if (opts.currentTokenUsage !== undefined && opts.contextLimit !== undefined) {
        const remaining = opts.contextLimit - opts.currentTokenUsage;
        const pct = Math.round((opts.currentTokenUsage / opts.contextLimit) * 100);
        parts.push(`Context window: ${pct}% used (${remaining} tokens remaining). When remaining < 1000, simplify responses.`);
    }
    return parts.join('\n\n');
}
