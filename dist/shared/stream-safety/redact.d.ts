export declare const MODEL_OUTPUT_CAP: number;
export declare const MODEL_OUTPUT_TRUNCATION_MARKER = "\n[\u2026\u8F93\u51FA\u5DF2\u622A\u65AD\uFF0C\u4EC5\u4FDD\u7559\u524D 256KB]";
export declare const SENSITIVE_FILE_REDACTION = "<file redacted: sensitive file type>";
export interface RedactionResult {
    text: string;
    redacted: boolean;
    warnings: string[];
}
export interface CappedResult {
    text: string;
    truncated: boolean;
}
export interface SanitizedToolOutput extends RedactionResult {
    truncated: boolean;
}
export declare function redactSecrets(input: string): RedactionResult;
export declare function capForModel(input: string, maxChars?: number): CappedResult;
export declare function sanitizeToolOutput(input: string, options?: {
    cap?: boolean;
    maxChars?: number;
}): SanitizedToolOutput;
export declare function isSensitiveFilePath(filePath: string): boolean;
