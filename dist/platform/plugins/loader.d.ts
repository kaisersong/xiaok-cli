import { type PluginManifest } from './manifest.js';
export interface LoadedPlugin extends PluginManifest {
    rootDir: string;
    collisions: string[];
}
export interface PluginLoaderOptions {
    builtinCommands?: string[];
}
export declare function loadPlugins(dirs: string[], options?: PluginLoaderOptions): Promise<LoadedPlugin[]>;
