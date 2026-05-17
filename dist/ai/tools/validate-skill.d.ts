import type { Tool } from '../../types.js';
export interface ValidateSkillToolOptions {
    cwd?: string;
    configDir?: string;
}
export declare function createValidateSkillTool(options?: ValidateSkillToolOptions): Tool;
export declare const validateSkillTool: Tool;
