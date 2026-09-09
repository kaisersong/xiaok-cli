import type { ToolExecutionContext } from '../types.js';
/** Cancellation requests do not settle this promise; the actual tool must exit. */
export declare function runMonitoredTool<T>(options: {
    name: string;
    context?: ToolExecutionContext;
    idleMs?: number;
    waitsForUser?: boolean;
    run(context?: ToolExecutionContext): Promise<T>;
}): Promise<T>;
