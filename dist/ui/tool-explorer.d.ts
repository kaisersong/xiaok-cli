import type { UiLocale } from './locale.js';
type ToolActivityFormatter = (toolName: string, input: Record<string, unknown>, maxWidth?: number, locale?: UiLocale) => string;
export declare class ToolExplorer {
    private readonly formatActivity;
    private activeGroup;
    constructor(formatActivity?: ToolActivityFormatter);
    record(name: string, input: Record<string, unknown>): string;
    reset(): void;
}
export {};
