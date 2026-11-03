export const KIMI_REASONING_ADMISSION_CODE = 'KIMI_REASONING_ADMISSION_REQUIRED';
/** Fixed, content-free protocol evidence. Outer recovery must not reset this retry budget. */
export function createKimiReasoningAdmissionError(facts) {
    return Object.assign(new Error(KIMI_REASONING_ADMISSION_CODE), {
        name: 'KimiReasoningAdmissionError', code: KIMI_REASONING_ADMISSION_CODE, retryable: false,
        sawContent: facts.sawContent, sawTools: facts.sawTools, terminal: facts.terminal,
    });
}
export function isKimiReasoningAdmissionError(error) {
    return error instanceof Error && error.code === KIMI_REASONING_ADMISSION_CODE;
}
