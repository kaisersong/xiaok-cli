import type { Tool } from '../../types.js';
import type { CapabilityRegistry } from '../../platform/runtime/capability-registry.js';
export interface UninstallSkillToolOptions {
    cwd?: string;
    configDir?: string;
    capabilityRegistry?: CapabilityRegistry;
    onUninstall?: (info: {
        name: string;
        path: string;
        scope: 'project' | 'global';
    }) => Promise<void> | void;
}
export declare function createUninstallSkillTool(options?: UninstallSkillToolOptions): Tool;
export declare const uninstallSkillTool: Tool;
