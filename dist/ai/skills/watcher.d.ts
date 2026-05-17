import { type SkillLoadOptions } from './loader.js';
export interface SkillCatalogWatcherOptions {
    cwd?: string;
    xiaokConfigDir?: string;
    options?: SkillLoadOptions;
    pollMs?: number;
    onChange: () => Promise<void> | void;
}
export interface SkillCatalogWatcher {
    close(): void;
}
export declare function createSkillCatalogWatcher(options: SkillCatalogWatcherOptions): SkillCatalogWatcher;
