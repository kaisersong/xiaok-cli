import { assembleSystemPrompt } from '../prompts/assembler.js';
/**
 * @deprecated Use assembleSystemPrompt from '../prompts/assembler.js' directly.
 * Kept for backward compatibility with existing callers.
 */
export async function renderPromptSections(opts) {
    const assembled = await assembleSystemPrompt(opts);
    return [assembled.staticText, assembled.dynamicText].filter(Boolean);
}
/**
 * @deprecated Use assembleSystemPrompt from '../prompts/assembler.js' directly.
 */
export async function buildSystemPrompt(opts) {
    const assembled = await assembleSystemPrompt(opts);
    return assembled.rendered;
}
