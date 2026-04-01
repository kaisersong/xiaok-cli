import type { Tool } from '../../types.js';
import type { CapabilityRegistry } from '../../platform/runtime/capability-registry.js';
export interface InstallSkillToolOptions {
    cwd?: string;
    configDir?: string;
    capabilityRegistry?: CapabilityRegistry;
    fetchFn?: typeof fetch;
    onInstall?: (info: {
        name: string;
        path: string;
        scope: 'project' | 'global';
    }) => Promise<void> | void;
}
export declare function createInstallSkillTool(options?: InstallSkillToolOptions): Tool;
export declare const installSkillTool: Tool;
