import { normalizeRuntimeError } from './runtime-errors.js';
export class RuntimeFacade {
    options;
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
            this.options.agent.getSessionState().attachPromptSnapshot(promptSnapshot.id, promptSnapshot.memoryRefs);
            this.options.agent.setPromptSnapshot(promptSnapshot);
            this.options.agent.setSystemPrompt(promptSnapshot.rendered);
            await this.options.agent.runTurn(request.input, onChunk, signal);
        }
        catch (error) {
            const normalized = normalizeRuntimeError(error);
            throw new Error(`${normalized.code}: ${normalized.message}`);
        }
    }
}
