import type { ToolExecutionContext } from '../../types.js';
/** Host dispatch narrows this invocation only; caller contexts are never marked. */
export declare function createNativeReadonlyExecutionContext(context?: ToolExecutionContext): ToolExecutionContext;
/** Neither descriptor fields nor model input can mint the private role brand. */
export declare function isNativeReadonlyExecutionContext(context: unknown): boolean;
/** Audited wrappers preserve the role on a fresh bound context, never on callers. */
export declare function inheritNativeReadonlyExecutionContext(source: unknown, derived: ToolExecutionContext | undefined): ToolExecutionContext | undefined;
