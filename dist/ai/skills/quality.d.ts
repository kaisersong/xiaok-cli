import { type SkillLoadOptions } from './loader.js';
export type SkillIssueSeverity = 'error' | 'warning';
export interface SkillValidationIssue {
    severity: SkillIssueSeverity;
    code: string;
    message: string;
}
export interface SkillValidationResult {
    ok: boolean;
    path: string;
    skillName?: string;
    issues: SkillValidationIssue[];
    summary: {
        errors: number;
        warnings: number;
    };
}
export interface ValidateSkillFileOptions extends SkillLoadOptions {
    cwd?: string;
    xiaokConfigDir?: string;
}
export declare function validateSkillFile(filePath: string, options?: ValidateSkillFileOptions): Promise<SkillValidationResult>;
