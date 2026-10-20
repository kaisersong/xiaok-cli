import type { ToolExecutionContext } from '../types.js';
/** Invalid async host checks still own their promise, including recorder failure. */
export declare function settleUnexpectedHostCheck(value: unknown, context?: ToolExecutionContext): Promise<never> | undefined;
/** Cancellation requests do not settle this promise; the actual tool must exit. */
export declare function runMonitoredTool<T>(options: {
    name: string;
    context?: ToolExecutionContext;
    idleMs?: number;
    waitsForUser?: boolean;
    /** Host-owned invocation admission, never carried by ToolExecutionContext. */
    admitEffect?(): void;
    run(context?: ToolExecutionContext): Promise<T>;
}): Promise<T>;
