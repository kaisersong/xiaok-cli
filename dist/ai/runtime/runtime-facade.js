import { normalizeRuntimeError } from './runtime-errors.js';
export class RuntimeFacade {
    options;
    // Tracks skill names already sent to the agent this session (mirrors CC's o17 Map).
    sentSkillNames = new Set();
    constructor(options) {
        this.options = options;
    }
    async runTurn(request, onChunk, signal) {
        try {
            const promptSnapshot = await this.options.promptBuilder.build({
                ...(await this.options.getPromptInput(request.cwd)),
                cwd: request.cwd,
                channel: request.source,
            });
            this.options.agent.getSessionState().attachPromptSnapshot(promptSnapshot.id, promptSnapshot.memoryRefs, promptSnapshot.cwd);
            this.options.agent.setPromptSnapshot(promptSnapshot);
            this.options.agent.setSystemPrompt(promptSnapshot.rendered);
            const input = this.buildInput(request.input);
            await this.options.agent.runTurn(input, onChunk, signal);
        }
        catch (error) {
            const normalized = normalizeRuntimeError(error);
            throw new Error(`${normalized.code}: ${normalized.message}`);
        }
    }
    /** Reset deduplication state (e.g. after skill install/uninstall). */
    resetSkillTracking() {
        this.sentSkillNames.clear();
    }
    buildInput(input) {
        // Compute new skills not yet seen by the agent (CC dedup: only send new ones).
        const allEntries = this.options.getSkillEntries?.() ?? [];
        const newEntries = allEntries.filter((e) => !this.sentSkillNames.has(e.name));
        if (newEntries.length === 0)
            return input;
        // Mark as sent before running (mirrors CC's O.add loop).
        for (const e of newEntries)
            this.sentSkillNames.add(e.name);
        const listing = newEntries.map((e) => e.listing).join('\n');
        const listingBlock = {
            type: 'text',
            text: `<system-reminder>\nThe following skills are available for use with the Skill tool:\n\n${listing}\n</system-reminder>`,
        };
        const inputBlocks = typeof input === 'string'
            ? [{ type: 'text', text: input }]
            : input;
        return [listingBlock, ...inputBlocks];
    }
}
