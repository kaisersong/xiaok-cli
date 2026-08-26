import { type UiLocale } from './locale.js';
type ToolActivityFormatter = (toolName: string, input: Record<string, unknown>, maxWidth?: number, locale?: UiLocale) => string;
export declare class ToolExplorer {
    private readonly formatActivity;
    private readonly locale;
    private activeGroup;
    private activeGroupEntryCount;
    private ranCollapseNoticeWritten;
    constructor(formatActivity?: ToolActivityFormatter, locale?: UiLocale);
    record(name: string, input: Record<string, unknown>): string;
    reset(): void;
}
export {};
