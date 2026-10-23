import type { Tool, ToolExecutionContext } from '../../types.js';
import type { createSandboxEnforcer } from './enforcer.js';
type SandboxEnforcer = ReturnType<typeof createSandboxEnforcer>;
export type SandboxDenialCallback = (deniedPath: string, toolName: string) => Promise<{
    shouldProceed: boolean;
}> | {
    shouldProceed: boolean;
};
export interface SandboxToolWrapperOptions {
    onSandboxDenied?: SandboxDenialCallback;
}
type CompoundSandboxPreparation = (input: Readonly<Record<string, unknown>>, context?: ToolExecutionContext) => Promise<string | undefined>;
/** Only first-party wrappers created below possess this port. A plugin property
 * named compoundPrepare is not consulted and cannot issue a preparation grant. */
export declare function getCompoundSandboxPreparation(tool: Tool): CompoundSandboxPreparation | undefined;
/** Registry's host-only clone preserves an existing authenticated binding; this
 * cannot create one from arbitrary function properties on an unbranded Tool. */
export declare function inheritCompoundSandboxPreparation(source: Tool, target: Tool): void;
export declare function applySandboxToTools(tools: Tool[], enforcer?: SandboxEnforcer, optionsOrCallback?: SandboxToolWrapperOptions | SandboxDenialCallback): Tool[];
export {};
