import type { Tool } from '../../types.js';
export interface InstallPluginToolOptions {
    cwd?: string;
    configDir?: string;
    fetchFn?: typeof fetch;
}
export declare function createInstallPluginTool(options?: InstallPluginToolOptions): Tool;
export declare const installPluginTool: Tool;
