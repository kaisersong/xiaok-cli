export const KIMI_REASONING_ADMISSION_CODE = 'KIMI_REASONING_ADMISSION_REQUIRED';

/** Fixed, content-free protocol evidence. Outer recovery must not reset this retry budget. */
export function createKimiReasoningAdmissionError(facts: { sawContent: boolean; sawTools: boolean; terminal: 'finish' | 'eof' }): Error & { code: string; retryable: false } {
  return Object.assign(new Error(KIMI_REASONING_ADMISSION_CODE), {
    name: 'KimiReasoningAdmissionError', code: KIMI_REASONING_ADMISSION_CODE, retryable: false as const,
    sawContent: facts.sawContent, sawTools: facts.sawTools, terminal: facts.terminal,
  });
}

export function isKimiReasoningAdmissionError(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === KIMI_REASONING_ADMISSION_CODE;
}
