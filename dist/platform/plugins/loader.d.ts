import { type PluginManifest } from './manifest.js';
export interface LoadedPlugin extends PluginManifest {
    rootDir: string;
    collisions: string[];
}
export interface PluginLoaderOptions {
    builtinCommands?: string[];
    platform?: NodeJS.Platform;
    /** Trusted resource path supplied only by Desktop main, never a manifest or CLI setting. */
    desktopCuaBundleDir?: string;
}
export declare function loadPlugins(dirs: string[], options?: PluginLoaderOptions): Promise<LoadedPlugin[]>;
