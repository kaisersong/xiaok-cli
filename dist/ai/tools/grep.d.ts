import type { Tool } from '../../types.js';
export declare function runFallbackGrepSearch(input: {
    pattern: string;
    path?: string;
    glob?: string;
    context?: number;
    output_mode?: string;
    type?: string;
}): Promise<string[]>;
export declare const grepTool: Tool;
