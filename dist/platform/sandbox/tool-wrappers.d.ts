import type { Tool } from '../../types.js';
import type { createSandboxEnforcer } from './enforcer.js';
type SandboxEnforcer = ReturnType<typeof createSandboxEnforcer>;
export declare function applySandboxToTools(tools: Tool[], enforcer?: SandboxEnforcer): Tool[];
export {};
