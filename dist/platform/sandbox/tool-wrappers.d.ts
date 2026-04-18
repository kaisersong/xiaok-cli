import type { Tool } from '../../types.js';
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
export declare function applySandboxToTools(tools: Tool[], enforcer?: SandboxEnforcer, optionsOrCallback?: SandboxToolWrapperOptions | SandboxDenialCallback): Tool[];
export {};
