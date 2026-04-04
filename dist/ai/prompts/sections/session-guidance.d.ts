import type { MemoryRecord } from '../../memory/store.js';
/**
 * Dynamic: Session-specific guidance — injected based on current session state.
 */
export interface SessionGuidanceOptions {
    permissionMode?: 'default' | 'auto' | 'plan';
    allowedToolsActive?: string[];
    toolCount?: number;
    mcpInstructions?: string;
    memories?: MemoryRecord[];
    currentTokenUsage?: number;
    contextLimit?: number;
}
export declare function getSessionGuidanceSection(opts: SessionGuidanceOptions): string;
