export interface ValidationResult {
    valid: boolean;
    errors: string[];
}
export declare function validateToolInput(schema: Record<string, unknown>, input: Record<string, unknown>): ValidationResult;
