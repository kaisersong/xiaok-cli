export declare const KIMI_REASONING_ADMISSION_CODE = "KIMI_REASONING_ADMISSION_REQUIRED";
/** Fixed, content-free protocol evidence. Outer recovery must not reset this retry budget. */
export declare function createKimiReasoningAdmissionError(facts: {
    sawContent: boolean;
    sawTools: boolean;
    terminal: 'finish' | 'eof';
}): Error & {
    code: string;
    retryable: false;
};
export declare function isKimiReasoningAdmissionError(error: unknown): boolean;
